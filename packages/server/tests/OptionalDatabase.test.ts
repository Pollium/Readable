import Application from '../lib/http/Application';
import ModuleDiscovery from '../lib/services/ModuleDiscovery';
import { configure } from '../lib/config';
import { afterAll, describe, expect, it } from 'vitest';

configure({ name: 'readable', jwtSecret: null, redis: { host: 'localhost', port: 6379 }, storage: null });

const application = new Application({
    port: 0,
    corsOrigins: [],
    log: { level: 'silent', pretty: false },
    discover: async () => ModuleDiscovery.merge([])
});

describe('Application without a database', () => {
    afterAll(() => application.stop());

    it('answers without opening one', async () => {
        const app = await application.build({ queues: false });
        const res = await app.inject({ method: 'GET', url: '/health' });

        expect(res.statusCode).toBe(200);
        expect(application.dataSource).toBeUndefined();
    });
});
