import 'reflect-metadata';
import { createDataSource } from '../lib/database/data-source';
import { BaseModel } from '../lib/database/models';
import { Column, Entity } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { MEMORY, UUID_V7, openSqlite } from './sqlite';

describe('database options on SQLite', () => {
    @Entity()
    class LiteEntry extends BaseModel{
        @Column({ type: 'varchar', nullable: true })
        title!: string | null;
    }

    it('passes what the app adds to TypeORM, and keeps what Readable decides', async () => {
        const dataSource = createDataSource(MEMORY, [LiteEntry], undefined, {
            logging: false,
            invalidWhereValuesBehavior: { null: 'ignore', undefined: 'ignore' },
            ...{ type: 'postgres', database: '/tmp/ignored.db', synchronize: false, entities: [] } as object
        });

        expect(dataSource.options).toMatchObject({
            type: 'better-sqlite3',
            database: ':memory:',
            synchronize: true,
            entities: [LiteEntry],
            logging: false,
            invalidWhereValuesBehavior: { null: 'ignore', undefined: 'ignore' }
        });

        await dataSource.initialize();
        const entries = dataSource.getRepository(LiteEntry);
        await entries.save([entries.create({ title: 'a' }), entries.create({ title: 'b' })]);

        await expect(dataSource.getRepository(LiteEntry).findBy({ title: undefined })).resolves.toHaveLength(2);
        await dataSource.destroy();
    });

    it('refuses an undefined where value by default, as TypeORM 1 does', async () => {
        const dataSource = await openSqlite([LiteEntry]);

        await expect(dataSource.getRepository(LiteEntry).findBy({ title: undefined })).rejects.toThrow();
        await dataSource.destroy();
    });

    it('runs the app prepareDatabase after registering uuidv7', async () => {
        const seen: string[] = [];
        const dataSource = createDataSource(MEMORY, [LiteEntry], undefined, {
            prepareDatabase: (db: { prepare(sql: string): { get(): { id: string } }; function(name: string, fn: () => string): void }) => {
                seen.push(db.prepare('SELECT uuidv7() AS id').get().id);
                db.function('greeting', () => 'hello');
            }
        });
        await dataSource.initialize();

        const [row] = await dataSource.query<Array<{ greeting: string }>>('SELECT greeting() AS greeting');

        expect(seen[0]).toMatch(UUID_V7);
        expect(row.greeting).toBe('hello');
        await dataSource.destroy();
    });
});
