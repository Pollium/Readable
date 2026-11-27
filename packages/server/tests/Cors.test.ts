import Application from '../lib/app/Application';
import { ModuleDiscovery } from '../lib/app/discovery';
import { configure } from '../lib/app/config';
import { afterAll, describe, expect, it } from 'vitest';
import { TEST_REDIS } from './env';

configure({ name: 'readable', jwtSecret: null, redis: TEST_REDIS, storage: null });

const application = new Application({
    port: 0,
    corsOrigins: ['https://app.example'],
    publicPaths: ['/i/'],
    log: { level: 'silent', pretty: false },
    discover: async () => ModuleDiscovery.merge([])
});

const app = await application.build({ queues: false });
app.get('/i/collect', async () => ({ ok: true }));
app.get('/private', async () => ({ ok: true }));

const corsOf = async (url: string, origin: string) => {
    const res = await app.inject({ method: 'GET', url, headers: { origin } });

    return {
        origin: res.headers['access-control-allow-origin'],
        credentials: res.headers['access-control-allow-credentials']
    };
};

afterAll(() => application.stop());

describe('Application CORS', () => {
    it('opens a public path to any site, without credentials', async () => {
        await expect(corsOf('/i/collect', 'https://customer.example')).resolves.toEqual({
            origin: 'https://customer.example',
            credentials: undefined
        });
    });

    it('keeps every other path to its own origins, with credentials', async () => {
        expect((await corsOf('/private', 'https://customer.example')).origin).toBeUndefined();
        await expect(corsOf('/private', 'https://app.example')).resolves.toEqual({
            origin: 'https://app.example',
            credentials: 'true'
        });
    });
});

describe('Application CORS with CORS_ORIGIN=*', () => {
    const anyOrigin = new Application({
        port: 0,
        corsOrigins: ['*'],
        exposedHeaders: ['ETag', 'Content-Length'],
        log: { level: 'silent', pretty: false },
        discover: async () => ModuleDiscovery.merge([])
    });

    afterAll(() => anyOrigin.stop());

    it('reflects any origin, with credentials, and exposes the headers it was given', async () => {
        const reflecting = await anyOrigin.build({ queues: false });
        reflecting.get('/trajectories', async () => ({ ok: true }));

        const res = await reflecting.inject({ method: 'GET', url: '/trajectories', headers: { origin: 'http://localhost:5173' } });
        const preflight = await reflecting.inject({
            method: 'OPTIONS',
            url: '/trajectories',
            headers: { origin: 'https://desktop.volt', 'access-control-request-method': 'PUT' }
        });

        expect(res.headers).toMatchObject({
            'access-control-allow-origin': 'http://localhost:5173',
            'access-control-allow-credentials': 'true',
            'access-control-expose-headers': 'ETag, Content-Length'
        });
        expect(preflight.headers['access-control-allow-origin']).toBe('https://desktop.volt');
    });
});

describe('Application CORS without exposed headers', () => {
    it('exposes none, as before', async () => {
        const res = await app.inject({ method: 'GET', url: '/private', headers: { origin: 'https://app.example' } });

        expect(res.headers['access-control-expose-headers']).toBeUndefined();
    });
});
