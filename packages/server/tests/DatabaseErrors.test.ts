import 'reflect-metadata';
import Application from '../lib/app/Application';
import { ModuleDiscovery } from '../lib/app/discovery';
import { RuntimeError } from '../lib/app/errors';
import { configure } from '../lib/app/config';
import { databaseErrorOf } from '../lib/app/error-answers';
import { Column, DataSource, Entity, EntityManager, ManyToOne, PrimaryColumn, PrimaryGeneratedColumn } from 'typeorm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEST_DATABASE_URL, TEST_REDIS } from './env';

@Entity()
class Team{
    @PrimaryGeneratedColumn()
    id!: number;

    @Column({ unique: true })
    slug!: string;
}

@Entity()
class Tag{
    @PrimaryColumn()
    name!: string;
}

@Entity()
class Member{
    @PrimaryGeneratedColumn()
    id!: number;

    @Column()
    name!: string;

    @ManyToOne(() => Team, { nullable: false })
    team!: Team;
}

const SCHEMA = `database_errors_${process.env.VITEST_POOL_ID ?? '0'}`;

const failureOf = async (work: () => Promise<unknown>): Promise<unknown> => {
    try{
        await work();
    }catch(error){
        return error;
    }
    throw new Error('the query was expected to fail');
};

const violations = (manager: EntityManager) => ({
    unique: async () => {
        await manager.insert(Team, { slug: 'volt' });
        return failureOf(() => manager.insert(Team, { slug: 'volt' }));
    },
    primaryKey: async () => {
        await manager.insert(Tag, { name: 'md' });
        return failureOf(() => manager.insert(Tag, { name: 'md' }));
    },
    foreignKey: () => failureOf(() => manager.insert(Member, { name: 'ada', team: { id: 999_999 } })),
    notNull: async () => {
        const { identifiers } = await manager.insert(Team, { slug: 'not-null' });
        return failureOf(() => manager.insert(Member, { name: null as unknown as string, team: { id: identifiers[0]!.id as number } }));
    }
});

const expectConstraintCodes = async (manager: EntityManager) => {
    const happen = violations(manager);

    expect(databaseErrorOf(await happen.unique())).toMatchObject({ message: 'Database::UniqueViolation', statusCode: 409 });
    expect(databaseErrorOf(await happen.primaryKey())).toMatchObject({ message: 'Database::UniqueViolation', statusCode: 409 });
    expect(databaseErrorOf(await happen.foreignKey())).toMatchObject({ message: 'Database::ForeignKeyViolation', statusCode: 409 });
    expect(databaseErrorOf(await happen.notNull())).toMatchObject({ message: 'Database::NotNullViolation', statusCode: 400 });
};

describe('database constraint errors on Postgres', () => {
    let dataSource: DataSource;

    beforeAll(async () => {
        const admin = new DataSource({ type: 'postgres', url: TEST_DATABASE_URL });
        await admin.initialize();
        await admin.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        await admin.query(`CREATE SCHEMA "${SCHEMA}"`);
        await admin.destroy();

        dataSource = new DataSource({ type: 'postgres', url: TEST_DATABASE_URL, schema: SCHEMA, synchronize: true, entities: [Team, Tag, Member] });
        await dataSource.initialize();
    });

    afterAll(async () => {
        await dataSource.query(`DROP SCHEMA IF EXISTS "${SCHEMA}" CASCADE`);
        await dataSource.destroy();
    });

    it('recognises a unique, primary key, foreign key and not null violation', async () => {
        await expectConstraintCodes(dataSource.manager);
    });

    it('leaves any other failed query alone', async () => {
        const syntax = await failureOf(() => dataSource.query('SELEC 1'));

        expect(databaseErrorOf(syntax)).toBeUndefined();
        expect(databaseErrorOf(new Error('connect ECONNREFUSED'))).toBeUndefined();
    });
});

describe('database constraint errors on SQLite', () => {
    let dataSource: DataSource;

    beforeAll(async () => {
        dataSource = new DataSource({ type: 'better-sqlite3', database: ':memory:', synchronize: true, entities: [Team, Tag, Member] });
        await dataSource.initialize();
    });

    afterAll(() => dataSource.destroy());

    it('recognises the same four violations', async () => {
        await expectConstraintCodes(dataSource.manager);
    });
});

describe('an app answering errors that are not RuntimeErrors', () => {
    class StorageFailure extends Error{}

    let sqlite: DataSource;
    let application: Application | undefined;

    beforeAll(async () => {
        configure({ name: 'readable', jwtSecret: null, redis: TEST_REDIS, storage: null });
        sqlite = new DataSource({ type: 'better-sqlite3', database: ':memory:', synchronize: true, entities: [Team, Tag, Member] });
        await sqlite.initialize();
    });

    afterAll(async () => {
        await application?.stop();
        await sqlite.destroy();
    });

    const build = async (mapError?: (error: unknown) => RuntimeError | undefined) => {
        await application?.stop();
        application = new Application({
            port: 0,
            corsOrigins: [],
            log: { level: 'silent', pretty: false },
            mapError,
            discover: async () => ModuleDiscovery.merge([])
        });
        const app = await application.build({ queues: false });
        app.get('/duplicate', async () => {
            await sqlite.manager.insert(Team, { slug: 'taken' }).catch(() => undefined);
            await sqlite.manager.insert(Team, { slug: 'taken' });
        });
        app.get('/storage', async () => {
            throw new StorageFailure('bucket gone');
        });

        return app;
    };

    it('answers a constraint violation with its Database code by default', async () => {
        const app = await build();

        const res = await app.inject({ method: 'GET', url: '/duplicate' });

        expect(res.statusCode).toBe(409);
        expect(res.json()).toEqual({ error: 'Database::UniqueViolation' });
    });

    it('lets mapError answer first, and falls back to the database codes and then 500', async () => {
        const app = await build((error) => {
            if(error instanceof StorageFailure) return new RuntimeError('Storage::Unavailable', 503);
            return undefined;
        });

        const storage = await app.inject({ method: 'GET', url: '/storage' });
        const duplicate = await app.inject({ method: 'GET', url: '/duplicate' });

        expect(storage.statusCode).toBe(503);
        expect(storage.json()).toEqual({ error: 'Storage::Unavailable' });
        expect(duplicate.json()).toEqual({ error: 'Database::UniqueViolation' });
    });

    it('lets mapError answer a database error its own way', async () => {
        const app = await build((error) => databaseErrorOf(error) === undefined ? undefined : new RuntimeError('Team::SlugTaken', 409));

        expect((await app.inject({ method: 'GET', url: '/duplicate' })).json()).toEqual({ error: 'Team::SlugTaken' });
    });

    it('still answers anything unmapped with 500 Server::Internal', async () => {
        const app = await build(() => undefined);

        const res = await app.inject({ method: 'GET', url: '/storage' });

        expect(res.statusCode).toBe(500);
        expect(res.json()).toEqual({ error: 'Server::Internal' });
    });
});
