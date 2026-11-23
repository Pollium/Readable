import BaseQueue from '../queues/BaseQueue';
import { ConfigError } from '../app/errors';
import { eventBus } from '../events/EventBus';
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
    schema: string | undefined;
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

export const createTestApp = async (options: HarnessOptions): Promise<TestApp> => {
    const application = options.createApp();
    const app = await application.build({ queues: false });
    const dataSource = application.dataSource!;
    const schema = requireTestSchema(options.schema);

    return {
        app,
        dataSource,
        resetDb: async () => {
            await truncateSchema(dataSource, schema);
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
