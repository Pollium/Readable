import 'reflect-metadata';
import { createDataSource } from '../lib/database/data-source';
import { BaseModel } from '../lib/database/models';
import { Client } from 'pg';
import { Column, Entity } from 'typeorm';
import { PostgresDriver } from 'typeorm/driver/postgres/PostgresDriver.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL } from './env';

const schema = 'readable_database_options';

@Entity()
class OptionEntry extends BaseModel{
    @Column({ type: 'varchar', nullable: true })
    title!: string | null;
}

const onSchema = async (sql: string) => {
    const client = new Client({ connectionString: TEST_DATABASE_URL });
    await client.connect();
    await client.query(sql);
    await client.end();
};

beforeAll(() => onSchema(`DROP SCHEMA IF EXISTS "${schema}" CASCADE; CREATE SCHEMA "${schema}"`));

afterAll(() => onSchema(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`));

describe('database options on Postgres', () => {
    it('passes what the app adds to TypeORM, and keeps what Readable decides', async () => {
        const dataSource = createDataSource({ url: TEST_DATABASE_URL, schema, synchronize: true }, [OptionEntry], undefined, {
            applicationName: 'readable-options-test',
            poolSize: 3,
            logging: false,
            invalidWhereValuesBehavior: { null: 'ignore', undefined: 'ignore' },
            prepareDatabase: () => {
                throw new Error('SQLite only');
            },
            ...{ type: 'better-sqlite3', url: 'postgres://nobody@nowhere/none', schema: 'public', synchronize: false, entities: [] } as object
        });

        expect(dataSource.options).toMatchObject({
            type: 'postgres',
            url: TEST_DATABASE_URL,
            schema,
            synchronize: true,
            entities: [OptionEntry],
            applicationName: 'readable-options-test',
            poolSize: 3,
            logging: false
        });
        expect(dataSource.options).not.toHaveProperty('prepareDatabase');

        await dataSource.initialize();
        const entries = dataSource.getRepository(OptionEntry);
        await entries.save([entries.create({ title: 'a' }), entries.create({ title: 'b' })]);
        const [{ name }] = await dataSource.query<Array<{ name: string }>>(`SELECT current_setting('application_name') AS name`);

        expect(name).toBe('readable-options-test');
        expect((dataSource.driver as PostgresDriver).master.options.max).toBe(3);
        await expect(entries.findBy({ title: undefined })).resolves.toHaveLength(2);
        await dataSource.destroy();
    });
});
