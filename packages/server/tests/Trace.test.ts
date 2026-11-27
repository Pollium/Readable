import Application from '../lib/app/Application';
import BaseController, { Route } from '../lib/http/Controller';
import { ModuleDiscovery } from '../lib/app/discovery';
import { RuntimeError } from '../lib/app/errors';
import { configure } from '../lib/app/config';
import { logger } from '../lib/app/logger';
import { traceId } from '../lib/app/trace';
import { Middleware } from '../lib/http/middleware';
import { Body } from '../lib/http/params';
import { Writable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { afterAll, describe, expect, it } from 'vitest';
import { TEST_REDIS } from './env';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let seenByGuard: string | undefined;

@Middleware(async () => {
    await sleep(1);
    seenByGuard = traceId();
})
class TraceController extends BaseController{
    @Route('/notes', 'POST')
    async create(@Body() body: { title: string }){
        await sleep(1);
        logger.info('note created', { title: body.title });
        return { traceId: traceId() };
    }

    @Route('/failing')
    failing(){
        throw new RuntimeError('Note::Locked', 409);
    }
}

configure({ name: 'readable', jwtSecret: null, redis: TEST_REDIS, storage: null });

const application = new Application({
    port: 0,
    corsOrigins: ['https://app.example'],
    log: { level: 'silent', pretty: false },
    discover: async () => ModuleDiscovery.merge([{
        controllers: [{ prefix: '', Controller: TraceController }],
        entities: [], events: [], queues: [], gateways: [], tools: []
    }])
});

const app = await application.build({ queues: false });

afterAll(() => application.stop());

const lines: string[] = [];
const capture = new Writable({
    write(chunk: Buffer, _encoding, done){
        lines.push(chunk.toString());
        done();
    }
});

describe('x-trace-id', () => {
    it('makes one up for a request that brings none, and answers with it', async () => {
        const res = await app.inject({ method: 'POST', url: '/notes', payload: { title: 'a' } });

        expect(res.headers['x-trace-id']).toMatch(UUID);
        expect(res.json()).toEqual({ data: { traceId: res.headers['x-trace-id'] } });
    });

    it('keeps the one a caller sends, through guards, the body and every await', async () => {
        const res = await app.inject({ method: 'POST', url: '/notes', headers: { 'x-trace-id': 'web-7f3a' }, payload: { title: 'a' } });

        expect(res.headers['x-trace-id']).toBe('web-7f3a');
        expect(res.json()).toEqual({ data: { traceId: 'web-7f3a' } });
        expect(seenByGuard).toBe('web-7f3a');
    });

    it('keeps it once a body has come in over a real socket, chunk by chunk', async () => {
        const address = await app.listen({ port: 0, host: '127.0.0.1' });
        const body = new ReadableStream({
            async start(controller){
                controller.enqueue(new TextEncoder().encode('{"title":'));
                await sleep(20);
                controller.enqueue(new TextEncoder().encode('"slow"}'));
                controller.close();
            }
        });

        const res = await fetch(`${address}/notes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-trace-id': 'socket-1' },
            body,
            duplex: 'half'
        } as RequestInit);

        expect(await res.json()).toEqual({ data: { traceId: 'socket-1' } });
        expect(seenByGuard).toBe('socket-1');
    });

    it('replaces an id that is too long or not one token', async () => {
        const long = await app.inject({ method: 'GET', url: '/health', headers: { 'x-trace-id': 'x'.repeat(200) } });
        const spaced = await app.inject({ method: 'GET', url: '/health', headers: { 'x-trace-id': 'a b' } });

        expect(long.headers['x-trace-id']).toMatch(UUID);
        expect(spaced.headers['x-trace-id']).toMatch(UUID);
    });

    it('is on every answer: errors, unknown routes and preflights', async () => {
        const failing = await app.inject({ method: 'GET', url: '/failing', headers: { 'x-trace-id': 't-1' } });
        const missing = await app.inject({ method: 'GET', url: '/nowhere', headers: { 'x-trace-id': 't-2' } });
        const preflight = await app.inject({
            method: 'OPTIONS',
            url: '/notes',
            headers: { 'x-trace-id': 't-3', origin: 'https://app.example', 'access-control-request-method': 'POST' }
        });

        expect(failing.statusCode).toBe(409);
        expect(failing.headers['x-trace-id']).toBe('t-1');
        expect(missing.statusCode).toBe(404);
        expect(missing.headers['x-trace-id']).toBe('t-2');
        expect(preflight.headers['x-trace-id']).toBe('t-3');
    });

    it('is on every line the logger writes while the request runs, and on none outside it', async () => {
        logger.configure({ level: 'info', pretty: false, destination: capture });

        await app.inject({ method: 'POST', url: '/notes', headers: { 'x-trace-id': 'logged-1' }, payload: { title: 'b' } });
        logger.info('between requests');
        logger.configure({ level: 'silent', pretty: false });

        const [during, between] = lines.map((line) => JSON.parse(line) as Record<string, unknown>);
        expect(during).toMatchObject({ msg: 'note created', title: 'b', traceId: 'logged-1' });
        expect(between).toMatchObject({ msg: 'between requests' });
        expect(between).not.toHaveProperty('traceId');
        expect(traceId()).toBeUndefined();
    });
});
