import Application from '../lib/http/Application';
import ModuleDiscovery from '../lib/services/ModuleDiscovery';
import { createDataSource } from '../lib/http/data-source';
import { configure } from '../lib/config';
import { afterAll, describe, expect, it } from 'vitest';

interface ClientAddress{
    ip: string;
}

const DATABASE_URL = 'postgres://pollium:pollium@localhost:5432/pollium';
const VISITOR = '203.0.113.7';
const FORGED = '192.0.2.1';
const NGINX = '172.18.0.4';
const INGRESS = '10.0.3.2';
const DIRECT_CLIENT = '198.51.100.9';
const REDIS = { host: 'localhost', port: 6379 };

configure({ jwtSecret: null, redis: REDIS, storage: null });

const application = new Application({
    port: 0,
    corsOrigins: [],
    log: { level: 'silent', pretty: false },
    discover: async () => ModuleDiscovery.merge([]),
    createDataSource: (entities) => createDataSource({ url: DATABASE_URL, schema: undefined, synchronize: false }, entities)
});

const app = await application.build({ queues: false });
app.get('/client', (req) => ({ ip: req.ip }));

const clientOf = async (remoteAddress: string, forwardedFor: string): Promise<string> => {
    const res = await app.inject({
        method: 'GET',
        url: '/client',
        remoteAddress,
        headers: { 'x-forwarded-for': forwardedFor }
    });

    return res.json<ClientAddress>().ip;
};

describe('Application client address', () => {
    afterAll(() => application.stop());

    it('reads the visitor a proxy on the private network forwarded', async () => {
        await expect(clientOf(NGINX, VISITOR)).resolves.toBe(VISITOR);
    });

    it('walks back through every private hop and stops at the first public one', async () => {
        await expect(clientOf(NGINX, `${FORGED}, ${VISITOR}, ${INGRESS}`)).resolves.toBe(VISITOR);
    });

    it('ignores the forwarded address of a client that connects directly', async () => {
        await expect(clientOf(DIRECT_CLIENT, VISITOR)).resolves.toBe(DIRECT_CLIENT);
    });
});
