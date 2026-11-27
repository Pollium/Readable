import 'reflect-metadata';
import BaseGateway, { Channel, Connection, OnConnect, OnMessage, Payload } from '../lib/gateway/Gateway';
import { configure } from '../lib/app/config';
import { closeServed, nextFrame, opened, serve, silentPeer } from './support/live';
import { Socket } from 'node:net';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEST_REDIS } from './env';

configure({ name: 'readable', jwtSecret: null, redis: TEST_REDIS, storage: null });

const MESSAGE_TOO_BIG = 1009;
const TWO_MB = 2 * 1024 * 1024;
const FLOOD_BYTES = 32 * 1024 * 1024;

interface Flood{
    before: number;
    after: number;
    drained: boolean;
}

const flood: Flood = { before: -1, after: -1, drained: false };

@Channel('/small')
class SmallGateway extends BaseGateway{
    @OnMessage('size')
    size(@Payload() payload: { blob: string }){
        return payload.blob.length;
    }
}

@Channel('/big', { maxPayload: 4 * 1024 * 1024 })
class BigGateway extends BaseGateway{
    @OnMessage('size')
    size(@Payload() payload: { blob: string }){
        return payload.blob.length;
    }
}

@Channel('/zipped', { compression: { threshold: 0 } })
class ZippedGateway extends BaseGateway{
    @OnMessage('echo')
    echo(@Payload() payload: { text: string }){
        return payload.text;
    }
}

@Channel('/plain')
class PlainGateway extends BaseGateway{}

@Channel('/alive', { pingIntervalMs: 50 })
class AliveGateway extends BaseGateway{}

@Channel('/flood')
class FloodGateway extends BaseGateway{
    @OnConnect()
    async connected(@Connection() connection: Connection){
        connection.send('flood', null, new Uint8Array(FLOOD_BYTES));
        flood.before = connection.bufferedAmount;
        await connection.drained();
        flood.drained = true;
        flood.after = connection.bufferedAmount;
    }
}

const closedIn = (socket: Socket) => new Promise<void>((resolve) => socket.once('close', () => resolve()));

const blob = (length: number) => JSON.stringify({ type: 'size', id: 1, blob: 'x'.repeat(length) });

beforeEach(() => {
    Object.assign(flood, { before: -1, after: -1, drained: false });
});

afterEach(closeServed);

describe('a channel option', () => {
    it('maxPayload lets one channel take larger frames than the others', async () => {
        const { url } = await serve([SmallGateway, BigGateway]);
        const big = await opened(url('/big'));
        const small = await opened(url('/small'));

        big.socket.send(blob(TWO_MB));
        small.socket.send(blob(TWO_MB));

        expect(await nextFrame(big)).toEqual({ type: 'size', re: 1, data: TWO_MB });
        expect((await small.closed).code).toBe(MESSAGE_TOO_BIG);
    });

    it('compression is offered on its channel only', async () => {
        const { url } = await serve([ZippedGateway, PlainGateway]);
        const zipped = await opened(url('/zipped'));
        const plain = await opened(url('/plain'));

        zipped.send({ type: 'echo', id: 1, text: 'a'.repeat(4096) });

        expect(zipped.socket.extensions).toBe('permessage-deflate');
        expect(plain.socket.extensions).toBe('');
        expect(await nextFrame(zipped)).toEqual({ type: 'echo', re: 1, data: 'a'.repeat(4096) });
    });

    it('pingIntervalMs ends a socket that stops answering pings', async () => {
        const { port } = await serve([AliveGateway]);
        const silent = await silentPeer(port, '/alive');

        await expect(closedIn(silent)).resolves.toBeUndefined();
    });

    it('pingIntervalMs keeps a socket that answers them', async () => {
        const { url } = await serve([AliveGateway]);
        const client = await opened(url('/alive'));

        await new Promise((resolve) => setTimeout(resolve, 300));

        expect(client.socket.readyState).toBe(WebSocket.OPEN);
    });
});

describe('a connection under backpressure', () => {
    it('counts what it has not sent yet, and drains once the peer reads', async () => {
        const { port } = await serve([FloodGateway]);
        const slow = await silentPeer(port, '/flood');
        slow.pause();

        await expect.poll(() => flood.before).toBeGreaterThan(0);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(flood.drained).toBe(false);

        slow.resume();

        await expect.poll(() => flood.drained, { timeout: 5000 }).toBe(true);
        expect(flood.after).toBe(0);
    });
});
