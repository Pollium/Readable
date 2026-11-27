import 'reflect-metadata';
import BaseGateway, { Bytes, Channel, Connection, OnMessage, Payload } from '../lib/gateway/Gateway';
import { configure } from '../lib/app/config';
import { binary, Binary } from '@pollium/readable-contracts/gateway';
import { closeServed, nextFrame, opened, serve } from './support/live';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_REDIS } from './env';

configure({ name: 'readable', jwtSecret: null, redis: TEST_REDIS, storage: null });

const fetched: Array<Promise<unknown>> = [];

@Channel('/bytes')
class BytesGateway extends BaseGateway{
    @OnMessage('upload')
    upload(@Payload() payload: { name: string }, @Bytes() bytes: Uint8Array | undefined){
        return { name: payload.name, size: bytes?.length ?? null, sum: [...bytes ?? []].reduce((sum, byte) => sum + byte, 0) };
    }

    @OnMessage('download')
    download(@Payload() payload: { size: number }){
        return binary({ size: payload.size }, new Uint8Array(payload.size).fill(7));
    }

    @OnMessage('push')
    push(@Connection() connection: Connection){
        connection.send('chunk', { op: 1 }, new Uint8Array([4, 5, 6]));
    }

    @OnMessage('fetch')
    fetch(@Connection() connection: Connection){
        fetched.push(connection.request('read', { path: '/a' }));
    }
}

afterEach(async () => {
    fetched.splice(0).forEach((question) => question.catch(() => undefined));
    await closeServed();
});

describe('a binary frame', () => {
    it('hands its header to @Payload() and its bytes to @Bytes()', async () => {
        const { url } = await serve([BytesGateway]);
        const client = await opened(url('/bytes'));

        client.send({ type: 'upload', id: 1, name: 'cell.dump' }, new Uint8Array([1, 2, 3, 250]));

        expect(await nextFrame(client)).toEqual({ type: 'upload', re: 1, data: { name: 'cell.dump', size: 4, sum: 256 } });
    });

    it('is answered with bytes when its handler returns binary(data, bytes)', async () => {
        const { url } = await serve([BytesGateway]);
        const client = await opened(url('/bytes'));

        client.send({ type: 'download', size: 2 * 1024 * 1024 });
        await nextFrame(client);

        const [{ frame, bytes }] = client.received;
        expect(frame).toEqual({ type: 'download', data: { size: 2 * 1024 * 1024 } });
        expect(bytes?.length).toBe(2 * 1024 * 1024);
        expect(bytes?.every((byte) => byte === 7)).toBe(true);
    });

    it('goes out when a connection sends bytes', async () => {
        const { url } = await serve([BytesGateway]);
        const client = await opened(url('/bytes'));

        client.send({ type: 'push' });
        await nextFrame(client);

        expect(client.received[0].frame).toEqual({ type: 'chunk', data: { op: 1 } });
        expect(Array.from(client.received[0].bytes ?? [])).toEqual([4, 5, 6]);
    });

    it('that answers a server request resolves with its data and bytes', async () => {
        const { url } = await serve([BytesGateway]);
        const client = await opened(url('/bytes'));

        client.send({ type: 'fetch' });
        const question = await nextFrame(client);
        client.send({ type: 'read', re: question.id, data: { status: 200 } }, new Uint8Array([8, 9]));

        const answer = await fetched[0] as Binary<{ status: number }>;
        expect(answer).toBeInstanceOf(Binary);
        expect(answer.data).toEqual({ status: 200 });
        expect(Array.from(answer.bytes)).toEqual([8, 9]);
    });

    it('that only holds JSON text is read as a text frame, as before', async () => {
        const { url } = await serve([BytesGateway]);
        const client = await opened(url('/bytes'));

        client.socket.send(new TextEncoder().encode(JSON.stringify({ type: 'upload', name: 'old' })));

        expect(await nextFrame(client)).toEqual({ type: 'upload', data: { name: 'old', size: null, sum: 0 } });
    });
});
