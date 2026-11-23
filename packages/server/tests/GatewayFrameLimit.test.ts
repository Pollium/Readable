import 'reflect-metadata';
import BaseGateway, { MAX_FRAME_BYTES, websocketOptions, Channel } from '../lib/gateway/Gateway';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

const CHANNEL = '/probe';
const MESSAGE_TOO_BIG = 1009;

@Channel(CHANNEL)
class ProbeGateway extends BaseGateway{}

describe('a live socket', () => {
    it('closes on a frame larger than any message a client sends', async () => {
        const app = Fastify();
        await app.register(websocket, websocketOptions);
        new ProbeGateway().register(app);
        await app.ready();

        try{
            const socket = await app.injectWS(CHANNEL);
            const closed = new Promise<number>((resolve) => socket.on('close', (code) => resolve(code)));

            socket.send('x'.repeat(MAX_FRAME_BYTES + 1));

            await expect(closed).resolves.toBe(MESSAGE_TOO_BIG);
        }finally{
            await app.close();
        }
    });
});
