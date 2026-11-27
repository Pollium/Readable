import Application from '../lib/app/Application';
import { ModuleDiscovery } from '../lib/app/discovery';
import { RuntimeError } from '../lib/app/errors';
import { createDataSource } from '../lib/database/data-source';
import { configure } from '../lib/app/config';
import { afterAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, TEST_REDIS } from './env';

interface ClientAddress{
    ip: string;
}

const DATABASE_URL = TEST_DATABASE_URL;
const VISITOR = '203.0.113.7';
const FORGED = '192.0.2.1';
const NGINX = '172.18.0.4';
const INGRESS = '10.0.3.2';
const DIRECT_CLIENT = '198.51.100.9';
const REDIS = TEST_REDIS;

configure({ name: 'readable', jwtSecret: null, redis: REDIS, storage: null });

const application = new Application({
    port: 0,
    corsOrigins: [],
    log: { level: 'silent', pretty: false },
    discover: async () => ModuleDiscovery.merge([]),
    createDataSource: (entities) => createDataSource({ url: DATABASE_URL, schema: undefined, synchronize: false }, entities)
});

const app = await application.build({ queues: false });
app.get('/client', (req) => ({ ip: req.ip }));
app.get('/broken', async () => {
    throw new Error('connect ECONNREFUSED 127.0.0.1:5432');
});
app.get('/refused', async () => {
    throw new RuntimeError('Probe::Refused', 502);
});
app.post('/notes', { bodyLimit: 32 }, async (req) => req.body);

const clientOf = async (remoteAddress: string, forwardedFor: string): Promise<string> => {
    const res = await app.inject({
        method: 'GET',
        url: '/client',
        remoteAddress,
        headers: { 'x-forwarded-for': forwardedFor }
    });

    return res.json<ClientAddress>().ip;
};

afterAll(() => application.stop());

describe('Application client address', () => {
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

describe('Application errors', () => {
    it('answers an unexpected failure without its text', async () => {
        const res = await app.inject({ method: 'GET', url: '/broken' });

        expect(res.statusCode).toBe(500);
        expect(res.json()).toEqual({ error: 'Server::Internal' });
    });

    it('answers a domain failure with its code', async () => {
        const res = await app.inject({ method: 'GET', url: '/refused' });

        expect(res.statusCode).toBe(502);
        expect(res.json()).toEqual({ error: 'Probe::Refused' });
    });
});

describe('Application answering a request it cannot read', () => {
    const post = (payload: string, contentType = 'application/json') =>
        app.inject({ method: 'POST', url: '/notes', headers: { 'content-type': contentType }, payload });

    it('answers malformed JSON with 400 instead of a server failure', async () => {
        const res = await post('{"title":');

        expect(res.statusCode).toBe(400);
        expect(res.json()).toEqual({ error: 'Request::Malformed' });
    });

    it('answers a body over the route limit with 413', async () => {
        const res = await post(JSON.stringify({ title: 'x'.repeat(64) }));

        expect(res.statusCode).toBe(413);
        expect(res.json()).toEqual({ error: 'Request::BodyTooLarge' });
    });

    it('answers a content type with no parser with 415', async () => {
        const res = await post('bytes', 'application/octet-stream');

        expect(res.statusCode).toBe(415);
        expect(res.json()).toEqual({ error: 'Request::UnsupportedMediaType' });
    });

    it('still reads a body it can', async () => {
        expect((await post('{"title":"a"}')).json()).toEqual({ title: 'a' });
    });
});
