import 'reflect-metadata';
import Application from '../lib/app/Application';
import { readable } from '../lib/app/readable';
import { readableConfig, redisFromEnv } from '../lib/app/config';
import { redisOptions } from '../lib/app/redis';
import { memoryRateLimitStore } from '../lib/testing/rate-limit';
import { FastifyInstance } from 'fastify';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

const root = join(import.meta.dirname, 'fixtures/notes');

let application: Application;
let app: FastifyInstance;

beforeAll(async () => {
    vi.stubEnv('PORT', '0');
    vi.stubEnv('DATABASE_URL', 'sqlite::memory:');
    vi.stubEnv('REDIS_HOST', '');
    vi.stubEnv('REDIS_PORT', '');
    vi.stubEnv('LOG_LEVEL', 'silent');
    application = readable({ root });
    app = await application.build({ queues: false });
    app.get('/limited', { config: { rateLimit: { max: 1, timeWindow: 60_000 } } }, async () => ({ ok: true }));
});

afterAll(async () => {
    await application.stop();
    vi.unstubAllEnvs();
});

describe('readable without Redis', () => {
    it('boots on SQLite with no REDIS_HOST or REDIS_PORT', async () => {
        const res = await app.inject({ method: 'GET', url: '/notes/latest' });

        expect(readableConfig().redis).toBeNull();
        expect(res.json()).toEqual({ data: 'first' });
        expect(application.dataSource?.options.type).toBe('better-sqlite3');
    });

    it('counts rate limits in memory', async () => {
        const first = await app.inject({ method: 'GET', url: '/limited' });
        const second = await app.inject({ method: 'GET', url: '/limited' });

        expect(first.statusCode).toBe(200);
        expect(second.statusCode).toBe(429);
        expect(second.json()).toEqual({ error: 'RateLimit::TooManyRequests' });
    });

    it('counts in the store memoryRateLimitStore lets a test spy on', async () => {
        const incr = vi.spyOn(memoryRateLimitStore, 'incr').mockImplementation((_key, done) => done(null, { current: 1, ttl: 60_000 }));

        const res = await app.inject({ method: 'GET', url: '/limited' });

        expect(res.statusCode).toBe(200);
        expect(incr).toHaveBeenCalled();
        incr.mockRestore();
    });

    it('names REDIS_HOST to whatever needs a connection anyway', () => {
        expect(() => redisOptions()).toThrow('Config::MissingEnv:REDIS_HOST');
    });
});

describe('redisFromEnv', () => {
    it('reads REDIS_PORT as 6379 when only REDIS_HOST is set', () => {
        vi.stubEnv('REDIS_HOST', 'cache');
        vi.stubEnv('REDIS_PORT', '');

        expect(redisFromEnv()).toEqual({ host: 'cache', port: 6379 });
    });
});
