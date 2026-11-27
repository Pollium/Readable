import BaseQueue from '../queues/BaseQueue';
import { ConfigError } from '../app/errors';
import { eventBus } from '../events/EventBus';
import { onSqlite } from '../database/dialect';
import { DataSource } from 'typeorm';
import { FastifyInstance } from 'fastify';
import { afterAll, afterEach, beforeAll, beforeEach, vi } from 'vitest';

export interface TestApp{
    app: FastifyInstance;
    dataSource: DataSource;
    resetDb: () => Promise<void>;
    close: () => Promise<void>;
}

export interface HarnessOptions{
    createApp: () => { build: (options?: { queues?: boolean }) => Promise<FastifyInstance>; dataSource?: DataSource; stop: () => Promise<void> };
    schema?: string;
    onReset?: (dataSource: DataSource) => Promise<void> | void;
    onBeforeAll?: () => Promise<void> | void;
    onBeforeEach?: () => Promise<void> | void;
}

export const requireTestSchema = (schema: string | undefined): string => {
    if(!schema || schema === 'public') throw ConfigError.MissingEnv('DATABASE_SCHEMA');
    return schema;
};

export const truncateSchema = async (dataSource: DataSource, schema: string) => {
    const rows: Array<{ tablename: string }> = await dataSource.query(
        'SELECT tablename FROM pg_tables WHERE schemaname = $1',
        [schema]
    );
    if(rows.length === 0) return;

    const tables = rows.map((row) => `"${schema}"."${row.tablename}"`).join(', ');
    await dataSource.query(`TRUNCATE ${tables} RESTART IDENTITY CASCADE`);
};

// SQLite has no TRUNCATE and no schemas: every table but SQLite's own is emptied, with foreign keys off so
// the order does not matter.
export const clearSqlite = async (dataSource: DataSource) => {
    const rows: Array<{ name: string }> = await dataSource.query(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`
    );

    await dataSource.query('PRAGMA foreign_keys = OFF');
    try{
        for(const { name } of rows){
            await dataSource.query(`DELETE FROM "${name.replaceAll('"', '""')}"`);
        }
    }finally{
        await dataSource.query('PRAGMA foreign_keys = ON');
    }
};

const resetterOf = (dataSource: DataSource, schema: string | undefined): (() => Promise<void>) => {
    if(onSqlite(dataSource)) return () => clearSqlite(dataSource);

    const required = requireTestSchema(schema);
    return () => truncateSchema(dataSource, required);
};

export const createTestApp = async (options: HarnessOptions): Promise<TestApp> => {
    const application = options.createApp();
    const app = await application.build({ queues: false });
    const dataSource = application.dataSource!;
    const reset = resetterOf(dataSource, options.schema);

    return {
        app,
        dataSource,
        resetDb: async () => {
            await reset();
            await options.onReset?.(dataSource);
        },
        close: () => application.stop()
    };
};

export const useApp = (options: HarnessOptions): TestApp => {
    const ctx = {} as TestApp;

    beforeAll(async () => {
        await options.onBeforeAll?.();
        Object.assign(ctx, await createTestApp(options));
    });
    afterAll(() => ctx.close());
    beforeEach(async () => {
        vi.spyOn(BaseQueue.prototype, 'add').mockResolvedValue();
        await options.onBeforeEach?.();
        await ctx.resetDb();
    });
    afterEach(() => eventBus.settled());

    return ctx;
};
