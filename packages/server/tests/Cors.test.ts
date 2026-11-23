import Application from '../lib/app/Application';
import { ModuleDiscovery } from '../lib/app/discovery';
import { configure } from '../lib/app/config';
import { afterAll, describe, expect, it } from 'vitest';

configure({ name: 'readable', jwtSecret: null, redis: { host: 'localhost', port: 6379 }, storage: null });

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
