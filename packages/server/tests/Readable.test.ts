import 'reflect-metadata';
import Application from '../lib/app/Application';
import { readable } from '../lib/app/readable';
import { readableConfig } from '../lib/app/config';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, TEST_REDIS } from './env';

const root = join(import.meta.dirname, 'fixtures/notes');
const env = {
    PORT: '0',
    DATABASE_URL: TEST_DATABASE_URL,
    DATABASE_SYNCHRONIZE: 'false',
    REDIS_HOST: TEST_REDIS.host,
    REDIS_PORT: String(TEST_REDIS.port),
    LOG_LEVEL: 'silent'
};
const saved = { ...process.env };

let application: Application;

beforeAll(() => {
    Object.assign(process.env, env);
    application = readable({ root, timestamptz: true, database: { applicationName: 'notes-api' } });
});

afterAll(async () => {
    await application.stop();
    process.env = saved;
});

describe('readable', () => {
    it('names the app after the scope of its package', () => {
        expect(readableConfig()).toMatchObject({ name: 'notes', jwtSecret: null, storage: null, redis: TEST_REDIS });
    });

    it('mounts what it finds under src/modules, with the database the environment names', async () => {
        const app = await application.build({ queues: false });

        const res = await app.inject({ method: 'GET', url: '/notes/latest' });

        expect(res.json()).toEqual({ data: 'first' });
        expect(application.dataSource?.entityMetadatas.map((entity) => entity.name)).toEqual(['Note']);
        expect(application.dataSource?.getMetadata('Note').findColumnWithPropertyName('createdAt')?.type).toBe('timestamptz');
    });

    it('opens the database with the TypeORM options the app adds', () => {
        expect(application.dataSource?.options).toMatchObject({ type: 'postgres', applicationName: 'notes-api' });
    });
});
