import { ReadableDatabaseConfig } from '../app/config';
import { dialectOf, sqlitePath } from './dialect';
import { DataSource, DataSourceOptions, EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

export interface MigrationSource{
    migrations: Function[];
    tableName: string;
}

// What Readable decides itself from the environment and discovery; an app's options never replace these.
type ReadableKeys = 'type' | 'url' | 'database' | 'entities' | 'migrations' | 'migrationsTableName'
    | 'migrationsTransactionMode' | 'synchronize' | 'schema' | 'prepareDatabase';

type PostgresDataSourceOptions = Extract<DataSourceOptions, { type: 'postgres' }>;
type BetterSqlite3DataSourceOptions = Extract<DataSourceOptions, { type: 'better-sqlite3' }>;
type PrepareDatabase = NonNullable<BetterSqlite3DataSourceOptions['prepareDatabase']>;

// One set of options serves whichever dialect DATABASE_URL picks, so a key both drivers know is typed as
// Postgres types it: better-sqlite3 types poolSize as never, and ignores it.
export type DatabaseOptions = Partial<Omit<PostgresDataSourceOptions, ReadableKeys>>
    & Partial<Omit<BetterSqlite3DataSourceOptions, ReadableKeys | keyof PostgresDataSourceOptions>>
    & { prepareDatabase?: PrepareDatabase };

interface SqliteConnection{
    function(name: string, fn: () => string): unknown;
}

type Transaction = (...args: unknown[]) => Promise<unknown>;

const migrationOptions = (migrations?: MigrationSource) => ({
    migrations: migrations?.migrations ?? [],
    ...(migrations === undefined ? {} : {
        migrationsTableName: migrations.tableName,
        migrationsTransactionMode: 'all' as const
    })
});

// SQLite has no uuidv7(), which BaseModel names as its id's default. Registering it on the connection lets
// SQL that leaves the id out work as it does on Postgres 18.
const registerUuidv7 = (then?: PrepareDatabase): PrepareDatabase => async (db: SqliteConnection) => {
    db.function('uuidv7', () => uuidv7());
    await then?.(db);
};

// better-sqlite3 has one connection, which TypeORM hands to every transaction. Two that start together
// both find none open and both send BEGIN, and the second fails with "cannot start a transaction within a
// transaction". The root manager's transactions therefore wait for each other. One opened through the
// manager a transaction hands its callback is a savepoint, as before.
export const serializeTransactions = (dataSource: DataSource) => {
    const manager = dataSource.manager;
    const transaction = manager.transaction.bind(manager) as Transaction;
    let tail: Promise<unknown> = Promise.resolve();

    manager.transaction = ((...args: unknown[]) => {
        const run = tail.then(() => transaction(...args));
        tail = run.catch(() => undefined);
        return run;
    }) as EntityManager['transaction'];
};

const sqliteOptions = (
    database: ReadableDatabaseConfig,
    entities: Function[],
    migrations: MigrationSource | undefined,
    { prepareDatabase, ...options }: DatabaseOptions
): DataSourceOptions => ({
    ...options as Partial<BetterSqlite3DataSourceOptions>,
    type: 'better-sqlite3',
    database: sqlitePath(database.url),
    synchronize: database.synchronize,
    entities,
    prepareDatabase: registerUuidv7(prepareDatabase),
    ...migrationOptions(migrations)
});

const postgresOptions = (
    database: ReadableDatabaseConfig,
    entities: Function[],
    migrations: MigrationSource | undefined,
    options: DatabaseOptions
): DataSourceOptions => ({
    ...Object.fromEntries(Object.entries(options).filter(([key]) => key !== 'prepareDatabase')),
    type: 'postgres',
    url: database.url,
    schema: database.schema,
    synchronize: database.synchronize,
    entities,
    ...migrationOptions(migrations)
});

export const createDataSource = (
    database: ReadableDatabaseConfig,
    entities: Function[],
    migrations?: MigrationSource,
    options: DatabaseOptions = {}
): DataSource => {
    if(dialectOf(database.url) === 'sqlite'){
        const dataSource = new DataSource(sqliteOptions(database, entities, migrations, options));
        serializeTransactions(dataSource);
        return dataSource;
    }

    const dataSource = new DataSource(postgresOptions(database, entities, migrations, options));
    if(database.timestamptz){
        Object.assign(dataSource.driver.mappedDataTypes, { createDate: 'timestamptz', updateDate: 'timestamptz' });
    }
    return dataSource;
};
