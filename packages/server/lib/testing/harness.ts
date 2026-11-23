import BaseQueue from '../queues/BaseQueue';
import { eventBus } from '../events/EventBus';
import { requireTestSchema, truncateSchema } from './postgres';
import { FastifyInstance } from 'fastify';
import { DataSource } from 'typeorm';
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
