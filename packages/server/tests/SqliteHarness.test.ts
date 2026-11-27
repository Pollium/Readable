import 'reflect-metadata';
import Application from '../lib/app/Application';
import { ModuleDiscovery } from '../lib/app/discovery';
import { configure } from '../lib/app/config';
import { createDataSource } from '../lib/database/data-source';
import { BaseModel, Fk } from '../lib/database/models';
import { createTestApp } from '../lib/testing/harness';
import { Entity } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { TEST_REDIS } from './env';
import { MEMORY } from './sqlite';

describe('the test harness on SQLite', () => {
    @Entity()
    class HarnessParent extends BaseModel{}

    @Entity()
    class HarnessChild extends BaseModel{
        @Fk('HarnessParent')
        parentId!: string;
    }

    configure({ name: 'readable', jwtSecret: null, redis: TEST_REDIS, storage: null });

    it('empties every table before each test, without a schema', async () => {
        const ctx = await createTestApp({
            createApp: () => new Application({
                port: 0,
                corsOrigins: [],
                log: { level: 'silent', pretty: false },
                discover: async () => ({ ...ModuleDiscovery.merge([]), entities: [HarnessParent, HarnessChild] }),
                createDataSource: (entities) => createDataSource(MEMORY, entities)
            })
        });
        const parent = await HarnessParent.create().save();
        await HarnessChild.create({ parentId: parent.id }).save();

        await ctx.resetDb();

        await expect(HarnessParent.count()).resolves.toBe(0);
        await expect(HarnessChild.count()).resolves.toBe(0);
        await ctx.close();
    });
});
