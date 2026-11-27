import { createDataSource } from '../lib/database/data-source';
import { DataSource } from 'typeorm';

export const UUID_V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export const MEMORY = { url: 'sqlite::memory:', schema: undefined, synchronize: true };

export const openSqlite = async (entities: Function[], url = MEMORY.url): Promise<DataSource> => {
    const dataSource = createDataSource({ ...MEMORY, url }, entities);
    await dataSource.initialize();
    return dataSource;
};
