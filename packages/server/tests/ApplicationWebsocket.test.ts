import 'reflect-metadata';
import Application, { ApplicationOptions } from '../lib/app/Application';
import BaseGateway, { Channel, OnMessage, Payload, websocketOptions } from '../lib/gateway/Gateway';
import { ModuleDiscovery } from '../lib/app/discovery';
import { configure } from '../lib/app/config';
import websocket from '@fastify/websocket';
import { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_REDIS } from './env';

configure({ name: 'readable', jwtSecret: null, redis: TEST_REDIS, storage: null });

@Channel('/echo')
class EchoGateway extends BaseGateway{
    @OnMessage('echo')
    echo(@Payload() payload: { text: string }){
        return { text: payload.text };
    }
}

const applications: Application[] = [];

const built = (plugins?: ApplicationOptions['plugins']) => {
    const application = new Application({
        port: 0,
        corsOrigins: [],
        log: { level: 'silent', pretty: false },
        discover: async () => ({ ...ModuleDiscovery.merge([]), gateways: [EchoGateway] }),
        plugins
    });
    applications.push(application);

    return application.build({ queues: false });
};

const echoed = async (app: FastifyInstance) => {
    await app.ready();
    const replies: unknown[] = [];
    const socket = await app.injectWS('/echo', {}, {
        onInit: (ws) => ws.on('message', (raw) => replies.push(JSON.parse(String(raw))))
    });
    socket.send(JSON.stringify({ type: 'echo', text: 'hola' }));
    await expect.poll(() => replies.length).toBe(1);
    socket.terminate();

    return replies[0];
};

afterEach(async () => {
    await Promise.all(applications.splice(0).map((application) => application.stop()));
});

describe('Application websocket', () => {
    it('opens the websocket itself when the app has a gateway', async () => {
        const app = await built();

        await expect(echoed(app)).resolves.toEqual({ type: 'echo', data: { text: 'hola' } });
    });

    it('keeps the websocket an app registered on its own', async () => {
        const app = await built(async (app) => {
            await app.register(websocket, websocketOptions);
        });

        await expect(echoed(app)).resolves.toEqual({ type: 'echo', data: { text: 'hola' } });
    });
});
