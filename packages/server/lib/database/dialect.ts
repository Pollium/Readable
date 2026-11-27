import { DataSource, EntityManager } from 'typeorm';

export type DatabaseDialect = 'postgres' | 'sqlite';

export const SQLITE_URL_SCHEME = 'sqlite:';

export const dialectOf = (url: string | undefined): DatabaseDialect => {
    return url?.startsWith(SQLITE_URL_SCHEME) ? 'sqlite' : 'postgres';
};

// `sqlite:<path>` names a file, and `sqlite::memory:` a database that lives as long as its connection.
export const sqlitePath = (url: string): string => url.slice(SQLITE_URL_SCHEME.length);

export const onSqlite = (target: DataSource | EntityManager): boolean => {
    const dataSource = target instanceof DataSource ? target : target.connection;
    return dataSource.options.type === 'better-sqlite3';
};
