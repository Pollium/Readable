import 'reflect-metadata';
import BaseGateway, { Bytes, Channel, Connection, OnMessage, Payload } from '../lib/gateway/Gateway';
import { GatewayClient } from '../lib/gateway/client';
import { RuntimeError } from '../lib/app/errors';
import { configure } from '../lib/app/config';
import { CurrentUser } from '../lib/auth/params';
import { Middleware, MiddlewareFn } from '../lib/http/middleware';
import { AuthError } from '../lib/app/errors';
import { binary, Binary } from '@pollium/readable-contracts/gateway';
import { closeServed, serve } from './support/live';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEST_REDIS } from './env';

configure({ name: 'readable', jwtSecret: null, redis: TEST_REDIS, storage: null });

const log: string[] = [];
const asked: Array<Promise<unknown>> = [];
const clients: GatewayClient[] = [];

// Lets a daemon in by the key it sends as its first subprotocol; a socket without one is a guest.
const Keyed: MiddlewareFn = async (req) => {
    const key = req.headers['sec-websocket-protocol']?.split(',')[0]?.trim();
    if(key === 'bad') throw AuthError.Unauthorized();
    if(key !== undefined) req.principal = { userId: key };
};

@Channel('/daemon', { refusal: 'close' })
@Middleware(Keyed)
class DaemonGateway extends BaseGateway{
    @OnMessage('echo')
    echo(@Payload() payload: { text: string }){
        return { text: payload.text };
    }

    @OnMessage('refuse')
    refuse(){
        throw new RuntimeError('Daemon::Refused', 409);
    }

    @OnMessage('stall')
    stall(){
        return new Promise(() => undefined);
    }

    @OnMessage('register')
    enroll(@Payload() payload: { clusterId: string }){
        log.push(`register:${payload.clusterId}`);
    }

    @OnMessage('note')
    note(@Payload() payload: { text: string }){
        log.push(`note:${payload.text}`);
    }

    @OnMessage('upload')
    upload(@Payload() payload: { name: string }, @Bytes() bytes: Uint8Array){
        return binary({ name: payload.name }, Uint8Array.from(bytes).reverse());
    }

    @OnMessage('kick')
    kick(@Connection() connection: Connection){
        connection.close(1011, 'kicked');
    }

    @OnMessage('ask')
    ask(@Connection() connection: Connection, @Payload() payload: { kind: string }){
        const question = connection.request(payload.kind, { path: '/cells' }, { timeoutMs: 1000 });
        question.catch(() => undefined);
        asked.push(question);
    }

    @OnMessage('push')
    push(@Connection() connection: Connection){
        connection.send('chunk', { op: 3 }, new Uint8Array([1, 2]));
    }

    @OnMessage('who')
    who(@CurrentUser() userId: string, @Connection() connection: Connection){
        return { userId, header: connection.req.headers['x-cluster'] };
    }
}

const client = (url: string, options?: ConstructorParameters<typeof GatewayClient>[1]): GatewayClient => {
    const opened = new GatewayClient(url, options);
    clients.push(opened);
    return opened;
};

const statusOf = (link: GatewayClient) => {
    const statuses: string[] = [];
    link.onStatus((status) => statuses.push(status));
    return statuses;
};

beforeEach(() => {
    log.splice(0);
});

afterEach(async () => {
    asked.splice(0).forEach((question) => question.catch(() => undefined));
    clients.splice(0).forEach((opened) => opened.close());
    await closeServed();
});

describe('GatewayClient', () => {
    it('asks and is answered, with the code of a refusal', async () => {
        const { url } = await serve([DaemonGateway]);
        const daemon = client(url('/daemon'), { token: 'cluster-1' });

        await expect(daemon.request('echo', { text: 'hola' })).resolves.toEqual({ text: 'hola' });
        await expect(daemon.request('refuse')).rejects.toMatchObject({ message: 'Daemon::Refused', statusCode: 502 });
        await expect(daemon.request('nope')).rejects.toMatchObject({ message: 'Gateway::UnknownMessageType' });
        await expect(daemon.request('stall', {}, { timeoutMs: 50 })).rejects.toMatchObject({ message: 'Gateway::Timeout' });
    });

    it('signs in with its token and headers', async () => {
        const { url } = await serve([DaemonGateway]);
        const daemon = client(url('/daemon'), { token: 'cluster-1', headers: { 'x-cluster': 'c1' } });

        await expect(daemon.request('who')).resolves.toEqual({ userId: 'cluster-1', header: 'c1' });
    });

    it('sends and receives bytes', async () => {
        const { url } = await serve([DaemonGateway]);
        const daemon = client(url('/daemon'));
        const chunks: Array<[unknown, number[]]> = [];
        daemon.on('chunk', (data, bytes) => chunks.push([data, Array.from(bytes ?? [])]));

        const answer = await daemon.request<Binary<{ name: string }>>('upload', { name: 'frame.0' }, { bytes: new Uint8Array([1, 2, 3]) });
        daemon.send('push');

        expect(answer.data).toEqual({ name: 'frame.0' });
        expect(Array.from(answer.bytes)).toEqual([3, 2, 1]);
        await expect.poll(() => chunks).toEqual([[{ op: 3 }, [1, 2]]]);
    });

    it('answers what the server asks with its handler\'s return value, bytes included', async () => {
        const { url } = await serve([DaemonGateway]);
        const daemon = client(url('/daemon'));
        daemon.answer('list', (data) => ({ listed: (data as { path: string }).path }));
        daemon.answer('read', () => binary({ status: 200 }, new Uint8Array([7])));
        daemon.answer('fail', () => {
            throw new RuntimeError('Cell::Missing', 404);
        });

        for(const kind of ['list', 'read', 'fail', 'unknown']) daemon.send('ask', { kind });

        await expect.poll(() => asked.length).toBe(4);
        await expect(asked[0]).resolves.toEqual({ listed: '/cells' });
        await expect(asked[1]).resolves.toMatchObject({ data: { status: 200 }, bytes: new Uint8Array([7]) });
        await expect(asked[2]).rejects.toMatchObject({ message: 'Cell::Missing' });
        await expect(asked[3]).rejects.toMatchObject({ message: 'Gateway::UnknownMessageType' });
    });

    it('queues while it connects, and sends its joins before what it queued', async () => {
        const { url } = await serve([DaemonGateway]);
        const daemon = client(url('/daemon'));

        expect(daemon.status).toBe('connecting');
        expect(daemon.send('note', { text: 'first' })).toBe(true);
        const echoed = daemon.request('echo', { text: 'queued' });
        daemon.join('register', { clusterId: 'c1' });

        await expect(echoed).resolves.toEqual({ text: 'queued' });
        expect(log).toEqual(['register:c1', 'note:first']);
    });

    it('holds only so much while it cannot connect', async () => {
        const daemon = client('ws://127.0.0.1:9/daemon', { queueLimit: 2 });

        expect([daemon.send('note'), daemon.send('note'), daemon.send('note')]).toEqual([true, true, false]);
        await expect(daemon.request('echo')).rejects.toMatchObject({ message: 'Gateway::QueueFull' });
        expect(daemon.send('note', {}, { queue: false })).toBe(false);
    });

    it('reconnects with a backoff when the server drops it, and joins again', async () => {
        const { url } = await serve([DaemonGateway]);
        const daemon = client(url('/daemon'));
        const statuses = statusOf(daemon);
        daemon.join('register', { clusterId: 'c1' });
        await expect.poll(() => log).toEqual(['register:c1']);

        daemon.send('kick');

        await expect.poll(() => log).toEqual(['register:c1', 'register:c1']);
        expect(statuses).toEqual(['connecting', 'open', 'reconnecting', 'open']);
    });

    it('stays closed when the gateway refuses who it is, and says why', async () => {
        const { url } = await serve([DaemonGateway]);
        const daemon = client(url('/daemon'), { token: 'bad' });
        const errors: string[] = [];
        daemon.onError((error) => errors.push(error));
        const asking = daemon.request('echo', { text: 'hola' });

        await expect(asking).rejects.toMatchObject({ message: 'Auth::Unauthorized', statusCode: 401 });
        expect(daemon.status).toBe('closed');
        expect(errors).toEqual(['Auth::Unauthorized']);
    });

    it('turns down what it is asked once closed', async () => {
        const { url } = await serve([DaemonGateway]);
        const daemon = client(url('/daemon'));
        const asking = daemon.request('stall');

        daemon.close();

        await expect(asking).rejects.toMatchObject({ message: 'Gateway::Closed' });
        expect(daemon.send('note')).toBe(false);
        await expect(daemon.request('echo')).rejects.toMatchObject({ message: 'Gateway::Closed' });
    });
});
