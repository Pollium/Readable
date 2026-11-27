import Application from '../lib/app/Application';
import { ModuleDiscovery } from '../lib/app/discovery';
import { createDataSource } from '../lib/database/data-source';
import { configure } from '../lib/app/config';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { afterAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, TEST_REDIS } from './env';

const DATABASE_URL = TEST_DATABASE_URL;
const REDIS = TEST_REDIS;
const COURSES = Array.from({ length: 200 }, (_, index) => ({ id: index, name: `Course ${index}`, subject: 'math' }));

configure({ name: 'readable', jwtSecret: null, redis: REDIS, storage: null });

const application = new Application({
    port: 0,
    corsOrigins: ['https://learn.example'],
    log: { level: 'silent', pretty: false },
    discover: async () => ModuleDiscovery.merge([]),
    createDataSource: (entities) => createDataSource({ url: DATABASE_URL, schema: undefined, synchronize: false }, entities)
});

const app = await application.build({ queues: false });
app.get('/courses', () => ({ data: COURSES }));
app.get('/tiny', () => ({ ok: true }));
app.get('/pdf', (_, reply) => reply.type('application/pdf').send(Buffer.alloc(4096, 1)));

const get = (url: string, encoding?: string) => app.inject({
    method: 'GET',
    url,
    headers: { origin: 'https://learn.example', ...(encoding === undefined ? {} : { 'accept-encoding': encoding }) }
});

describe('Application response compression', () => {
    afterAll(() => application.stop());

    it('answers JSON with brotli when the client accepts it', async () => {
        const res = await get('/courses', 'gzip, deflate, br, zstd');

        expect(res.headers['content-encoding']).toBe('br');
        expect(res.rawPayload.length).toBeLessThan(JSON.stringify({ data: COURSES }).length / 4);
        expect(JSON.parse(brotliDecompressSync(res.rawPayload).toString())).toEqual({ data: COURSES });
    });

    it('falls back to gzip, and keeps the CORS vary alongside its own', async () => {
        const res = await get('/courses', 'gzip');

        expect(res.headers['content-encoding']).toBe('gzip');
        expect(String(res.headers.vary)).toMatch(/Origin/);
        expect(String(res.headers.vary)).toMatch(/Accept-Encoding/);
        expect(JSON.parse(gunzipSync(res.rawPayload).toString())).toEqual({ data: COURSES });
    });

    it('sends plain bytes to a client that accepts no encoding, a small body, or a binary one', async () => {
        const plain = await get('/courses');
        const tiny = await get('/tiny', 'br');
        const pdf = await get('/pdf', 'br');

        expect(plain.headers['content-encoding']).toBeUndefined();
        expect(plain.json()).toEqual({ data: COURSES });
        expect(tiny.headers['content-encoding']).toBeUndefined();
        expect(pdf.headers['content-encoding']).toBeUndefined();
        expect(pdf.rawPayload.length).toBe(4096);
    });
});
