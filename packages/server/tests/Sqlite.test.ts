import 'reflect-metadata';
import { createDataSource } from '../lib/database/data-source';
import { BaseModel } from '../lib/database/models';
import { Column, DataSource, Entity } from 'typeorm';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MEMORY, UUID_V7, openSqlite } from './sqlite';

@Entity()
class LiteNote extends BaseModel{
    @Column({ unique: true })
    title!: string;
}

const open = (entities: Function[] = [LiteNote], url = MEMORY.url): Promise<DataSource> => openSqlite(entities, url);

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

let dir: string;

beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'readable-sqlite-'));
});

afterAll(() => rm(dir, { recursive: true, force: true }));

describe('createDataSource on SQLite', () => {
    it('opens better-sqlite3 for a sqlite: url, and a row that leaves its id out gets a UUIDv7', async () => {
        const dataSource = await open();

        await dataSource.query(`INSERT INTO "lite_note" ("title") VALUES ('first')`);
        const [row] = await dataSource.query<Array<{ id: string }>>('SELECT id FROM "lite_note"');

        expect(dataSource.options.type).toBe('better-sqlite3');
        expect(row.id).toMatch(UUID_V7);
        await dataSource.destroy();
    });

    it('opens a file at the path after sqlite:', async () => {
        const path = join(dir, 'notes.db');
        const dataSource = await open([LiteNote], `sqlite:${path}`);

        expect(dataSource.options).toMatchObject({ type: 'better-sqlite3', database: path });
        await dataSource.destroy();
    });

    it('runs transactions started together one after the other, so neither finds the other open', async () => {
        const dataSource = await open();
        const steps: string[] = [];
        const write = (title: string) => dataSource.transaction(async (manager) => {
            steps.push(`${title}:begin`);
            await manager.insert(LiteNote, manager.create(LiteNote, { title }));
            await tick();
            steps.push(`${title}:commit`);
        });

        await Promise.all([write('a'), write('b')]);

        expect(steps).toEqual(['a:begin', 'a:commit', 'b:begin', 'b:commit']);
        await expect(dataSource.getRepository(LiteNote).count()).resolves.toBe(2);
        await dataSource.destroy();
    });

    it('keeps going after a transaction that failed', async () => {
        const dataSource = await open();

        const failed = dataSource.transaction(async () => {
            throw new Error('refused');
        });
        const next = dataSource.transaction((manager) => manager.insert(LiteNote, manager.create(LiteNote, { title: 'after' })));

        await expect(failed).rejects.toThrow('refused');
        await expect(next).resolves.toBeDefined();
        await dataSource.destroy();
    });

    it('opens a transaction inside another through its manager as a savepoint', async () => {
        const dataSource = await open();

        await dataSource.transaction(async (manager) => {
            await manager.insert(LiteNote, manager.create(LiteNote, { title: 'kept' }));
            await manager.transaction(async (inner) => {
                await inner.insert(LiteNote, inner.create(LiteNote, { title: 'undone' }));
                throw new Error('inner');
            }).catch(() => undefined);
        });

        const titles = (await dataSource.getRepository(LiteNote).find()).map((note) => note.title);
        expect(titles).toEqual(['kept']);
        await dataSource.destroy();
    });

    it('leaves timestamptz and the schema to Postgres', async () => {
        const dataSource = createDataSource({ ...MEMORY, schema: 'tenant', timestamptz: true }, [LiteNote]);
        await dataSource.initialize();

        const stamps = dataSource.getMetadata(LiteNote).columns.filter((column) => column.isCreateDate || column.isUpdateDate);

        expect(stamps.map((column) => column.type)).toEqual(['datetime', 'datetime']);
        expect(dataSource.getMetadata(LiteNote).tablePath).toBe('lite_note');
        await dataSource.destroy();
    });

    it('finds nothing to change when it synchronizes a database it made', async () => {
        const url = `sqlite:${join(dir, 'synced.db')}`;
        await (await open([LiteNote], url)).destroy();

        const dataSource = createDataSource({ url, schema: undefined, synchronize: false }, [LiteNote]);
        await dataSource.initialize();
        const pending = await dataSource.driver.createSchemaBuilder().log();

        expect(pending.upQueries).toEqual([]);
        await dataSource.destroy();
    });
});
