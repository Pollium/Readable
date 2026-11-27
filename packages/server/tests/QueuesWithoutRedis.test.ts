import Application from '../lib/app/Application';
import BaseQueue from '../lib/queues/BaseQueue';
import { ModuleDiscovery } from '../lib/app/discovery';
import { configure } from '../lib/app/config';
import { describe, expect, it } from 'vitest';

class DigestQueue extends BaseQueue<{ userId: string }>{
    readonly name = 'digest';

    async process(){}
}

const withQueue = () => new Application({
    port: 0,
    corsOrigins: [],
    log: { level: 'silent', pretty: false },
    discover: async () => ({ ...ModuleDiscovery.merge([]), queues: [DigestQueue] })
});

describe('an app with a queue and no Redis', () => {
    configure({ name: 'readable', jwtSecret: null, redis: null, storage: null });

    it('stops the boot and names REDIS_HOST', async () => {
        const application = withQueue();

        await expect(application.build()).rejects.toThrow('Config::MissingEnv:REDIS_HOST');
        await application.stop();
    });

    it('builds for tests that leave the queues stopped', async () => {
        const application = withQueue();

        await expect(application.build({ queues: false })).resolves.toBeDefined();
        await application.stop();
    });

    it('refuses to enqueue without Redis, naming REDIS_HOST', async () => {
        await expect(new DigestQueue().add({ userId: 'u' })).rejects.toThrow('Config::MissingEnv:REDIS_HOST');
    });
});
