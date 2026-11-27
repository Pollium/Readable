import 'reflect-metadata';
import BaseGateway, { Channel, closeGateways, OnDisconnect, OnMessage, OnShutdown, websocketOptions } from '../lib/gateway/Gateway';
import { configure } from '../lib/app/config';
import { closeServed, nextFrame, opened, serve } from './support/live';
import { SocketClose } from '@pollium/readable-contracts/gateway';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEST_REDIS } from './env';

configure({ name: 'readable', jwtSecret: null, redis: TEST_REDIS, storage: null });

const order: string[] = [];

@Channel('/stage')
class StageGateway extends BaseGateway{
    @OnMessage('hello')
    hello(){
        return 'hi';
    }

    @OnShutdown()
    async closing(){
        await new Promise((resolve) => setTimeout(resolve, 20));
        order.push('shutdown');
        this.connections.broadcast({ type: 'stage.closing', data: null });
    }

    @OnDisconnect()
    left(){
        order.push('disconnect');
    }
}

beforeEach(() => {
    order.splice(0);
});

afterEach(closeServed);

describe('a gateway when the app stops', () => {
    it('runs @OnShutdown() first, then closes every socket with 1001', async () => {
        const { url, application } = await serve([StageGateway]);
        const clients = await Promise.all([opened(url('/stage')), opened(url('/stage'))]);

        await application.stop();

        for(const client of clients){
            expect(client.frames()).toEqual([{ type: 'stage.closing', data: null }]);
            await expect(client.closed).resolves.toEqual({ code: SocketClose.ShuttingDown, reason: 'shutting down' });
        }
        expect(order).toEqual(['shutdown', 'disconnect', 'disconnect']);
    });

    it('does the same for an app that drives Fastify itself, through closeGateways', async () => {
        const app = Fastify();
        await app.register(websocket, websocketOptions);
        new StageGateway().register(app);
        await app.listen({ port: 0, host: '127.0.0.1' });
        const { port } = app.server.address() as { port: number };

        try{
            const client = await opened(`ws://127.0.0.1:${port}/stage`);
            client.send({ type: 'hello', id: 1 });
            await nextFrame(client);

            await closeGateways(app);

            await expect(client.closed).resolves.toMatchObject({ code: SocketClose.ShuttingDown });
            expect(order).toEqual(['shutdown', 'disconnect']);
        }finally{
            await app.close();
        }
    });
});
