import { ReadableDatabaseConfig } from '../app/config';
import { DataSource } from 'typeorm';

export interface MigrationSource{
    migrations: Function[];
    tableName: string;
}

export const createDataSource = (
    database: ReadableDatabaseConfig,
    entities: Function[],
    migrations?: MigrationSource
): DataSource => {
    const dataSource = new DataSource({
        type: 'postgres',
        url: database.url,
        schema: database.schema,
        synchronize: database.synchronize,
        entities,
        migrations: migrations?.migrations ?? [],
        ...(migrations === undefined ? {} : {
            migrationsTableName: migrations.tableName,
            migrationsTransactionMode: 'all' as const
        })
    });
    if(database.timestamptz){
        Object.assign(dataSource.driver.mappedDataTypes, { createDate: 'timestamptz', updateDate: 'timestamptz' });
    }
    return dataSource;
};
