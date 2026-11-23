import 'reflect-metadata';
import BaseGateway, {
    Channel,
    OnConnect,
    OnDisconnect,
    OnMessage,
    Payload,
    Socket
} from '../lib/gateway/Gateway';
import { RuntimeError } from '../lib/app/errors';
import websocket, { WebSocket } from '@fastify/websocket';
import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

const seen: string[] = [];

@Channel('/echo')
class EchoGateway extends BaseGateway{
    @OnMessage('echo')
    echo(@Payload() payload: { text: string }){
        return { text: payload.text };
    }

    @OnMessage('refuse')
    refuse(){
        throw new RuntimeError('Echo::Refused', 409);
    }

    @OnMessage('crash')
    crash(){
        throw new Error('database password is hunter2');
    }
}

@Channel('/lifecycle')
class LifecycleGateway extends BaseGateway{
    @OnConnect()
    connect(@Socket() socket: WebSocket){
        seen.push(typeof socket.send === 'function' ? 'connect' : 'connect without a socket');
    }

    @OnDisconnect()
    disconnect(){
        seen.push('disconnect');
    }
}

const apps: FastifyInstance[] = [];

const open = async (Gateway: new () => BaseGateway, path: string) => {
    const app = Fastify();
    apps.push(app);
    await app.register(websocket);
    new Gateway().register(app);
    await app.ready();

    const replies: unknown[] = [];
    const socket = await app.injectWS(path, {}, {
        onInit: (ws) => ws.on('message', (raw) => replies.push(JSON.parse(String(raw))))
    });

    return { socket, replies };
};

const ask = async (frame: string) => {
    const { socket, replies } = await open(EchoGateway, '/echo');
    socket.send(frame);
    await expect.poll(() => replies.length).toBe(1);

    return replies[0];
};

afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('a gateway message', () => {
    it('is answered with what its handler returns for the payload', async () => {
        await expect(ask(JSON.stringify({ type: 'echo', text: 'hola' }))).resolves.toEqual({ type: 'echo', data: { text: 'hola' } });
    });

    it('that is not json is answered as malformed', async () => {
        await expect(ask('not json')).resolves.toEqual({ error: 'Gateway::MalformedFrame' });
    });

    it('of a type no handler takes is refused, echoing its session', async () => {
        await expect(ask(JSON.stringify({ type: 'nope', sessionId: 's-1' }))).resolves.toEqual({
            error: 'Gateway::UnknownMessageType',
            sessionId: 's-1'
        });
    });

    it('whose handler fails in its domain is answered with that code', async () => {
        await expect(ask(JSON.stringify({ type: 'refuse' }))).resolves.toEqual({ error: 'Echo::Refused' });
    });

    it('whose handler fails unexpectedly is answered without the failure text', async () => {
        await expect(ask(JSON.stringify({ type: 'crash' }))).resolves.toEqual({ error: 'Gateway::Internal' });
    });
});

describe('a gateway connection', () => {
    it('runs its connect handler with the socket and its disconnect handler on close', async () => {
        const { socket } = await open(LifecycleGateway, '/lifecycle');
        await expect.poll(() => seen).toEqual(['connect']);

        socket.terminate();

        await expect.poll(() => seen).toEqual(['connect', 'disconnect']);
    });
});
