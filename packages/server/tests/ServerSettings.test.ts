import 'reflect-metadata';
import Application, { ApplicationOptions } from '../lib/app/Application';
import { ModuleDiscovery } from '../lib/app/discovery';
import { configure, serviceConfig } from '../lib/app/config';
import { readable } from '../lib/app/readable';
import { AddressInfo } from 'node:net';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_DATABASE_URL, TEST_REDIS } from './env';

const saved = { ...process.env };
const running: Application[] = [];

const application = (options: Partial<ApplicationOptions> = {}) => {
    configure({ name: 'readable', jwtSecret: null, redis: TEST_REDIS, storage: null });
    const app = new Application({
        port: 0,
        corsOrigins: [],
        log: { level: 'silent', pretty: false },
        discover: async () => ModuleDiscovery.merge([]),
        ...options
    });
    running.push(app);

    return app;
};

afterEach(async () => {
    await Promise.all(running.splice(0).map((app) => app.stop()));
    process.env = { ...saved };
});

describe('the listen host', () => {
    it('is HOST, or every interface when unset', () => {
        Object.assign(process.env, { PORT: '8100', DATABASE_URL: TEST_DATABASE_URL });
        delete process.env.HOST;
        expect(serviceConfig('').host).toBe('0.0.0.0');

        process.env.HOST = '127.0.0.1';
        expect(serviceConfig('').host).toBe('127.0.0.1');
    });

    it('is where readable() listens', async () => {
        Object.assign(process.env, {
            PORT: '0',
            HOST: '127.0.0.1',
            DATABASE_URL: TEST_DATABASE_URL,
            DATABASE_SYNCHRONIZE: 'false',
            REDIS_HOST: TEST_REDIS.host,
            REDIS_PORT: String(TEST_REDIS.port),
            LOG_LEVEL: 'silent'
        });
        const app = readable({ root: join(import.meta.dirname, 'fixtures/notes') });
        running.push(app);
        const build = vi.spyOn(app, 'build');

        await app.start();

        const address = (await build.mock.results[0]!.value).server.address() as AddressInfo;
        const res = await fetch(`http://127.0.0.1:${address.port}/notes/latest`);
        expect(address.address).toBe('127.0.0.1');
        expect(await res.json()).toEqual({ data: 'first' });
    });
});

describe('fastify options', () => {
    it('reach the server: timeouts, trustProxy and the body limit', async () => {
        const app = await application({
            fastify: {
                keepAliveTimeout: 1_800_000,
                requestTimeout: 0,
                http: { headersTimeout: 1_810_000, requestTimeout: 0 },
                trustProxy: (_address, hop) => hop < 1,
                bodyLimit: 16
            }
        }).build({ queues: false });
        app.get('/client', (req) => ({ ip: req.ip }));
        app.post('/notes', async (req) => req.body);
        await app.ready();

        const client = await app.inject({ method: 'GET', url: '/client', remoteAddress: '203.0.113.9', headers: { 'x-forwarded-for': '198.51.100.1, 192.0.2.4' } });
        const tooLarge = await app.inject({ method: 'POST', url: '/notes', payload: { text: 'more than sixteen bytes' } });

        expect(app.server.keepAliveTimeout).toBe(1_800_000);
        expect(app.server.requestTimeout).toBe(0);
        expect(app.server.headersTimeout).toBe(1_810_000);
        expect(client.json()).toEqual({ ip: '192.0.2.4' });
        expect(tooLarge.statusCode).toBe(413);
    });

    it('leave the private-network proxies trusted when trustProxy is not given', async () => {
        const app = await application().build({ queues: false });
        app.get('/client', (req) => ({ ip: req.ip }));

        const res = await app.inject({ method: 'GET', url: '/client', remoteAddress: '10.0.0.2', headers: { 'x-forwarded-for': '203.0.113.7' } });

        expect(res.json()).toEqual({ ip: '203.0.113.7' });
    });
});
