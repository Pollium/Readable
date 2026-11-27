import Application from '../lib/app/Application';
import { ModuleDiscovery } from '../lib/app/discovery';
import { configure } from '../lib/app/config';
import { afterAll, describe, expect, it } from 'vitest';
import { TEST_REDIS } from './env';

configure({ name: 'readable', jwtSecret: null, redis: TEST_REDIS, storage: null });

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
