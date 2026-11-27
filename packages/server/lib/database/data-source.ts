import { ReadableDatabaseConfig } from '../app/config';
import { dialectOf, sqlitePath } from './dialect';
import { DataSource, EntityManager } from 'typeorm';
import { v7 as uuidv7 } from 'uuid';

export interface MigrationSource{
    migrations: Function[];
    tableName: string;
}

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
const registerUuidv7 = (db: SqliteConnection) => {
    db.function('uuidv7', () => uuidv7());
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

export const createDataSource = (
    database: ReadableDatabaseConfig,
    entities: Function[],
    migrations?: MigrationSource
): DataSource => {
    if(dialectOf(database.url) === 'sqlite'){
        const dataSource = new DataSource({
            type: 'better-sqlite3',
            database: sqlitePath(database.url),
            synchronize: database.synchronize,
            entities,
            prepareDatabase: registerUuidv7,
            ...migrationOptions(migrations)
        });
        serializeTransactions(dataSource);
        return dataSource;
    }

    const dataSource = new DataSource({
        type: 'postgres',
        url: database.url,
        schema: database.schema,
        synchronize: database.synchronize,
        entities,
        ...migrationOptions(migrations)
    });
    if(database.timestamptz){
        Object.assign(dataSource.driver.mappedDataTypes, { createDate: 'timestamptz', updateDate: 'timestamptz' });
    }
    return dataSource;
};
