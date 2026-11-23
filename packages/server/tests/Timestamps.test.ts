import { createDataSource } from '../lib/database/data-source';
import { BaseModel } from '../lib/database/models';
import { Entity } from 'typeorm';
import { describe, expect, it } from 'vitest';

@Entity()
class Stamp extends BaseModel{}

const typesOf = async (timestamptz?: boolean) => {
    const dataSource = createDataSource({
        url: 'postgres://pollium:pollium@localhost:5432/pollium',
        schema: undefined,
        synchronize: false,
        timestamptz
    }, [Stamp]);
    await dataSource.initialize();
    const stamps = dataSource.getMetadata(Stamp).columns.filter((column) => column.isCreateDate || column.isUpdateDate);
    await dataSource.destroy();
    return Object.fromEntries(stamps.map((column) => [column.propertyName, column.type]));
};

describe('BaseModel timestamps', () => {
    it('stores created and updated times without a time zone by default', async () => {
        await expect(typesOf()).resolves.toEqual({ createdAt: 'timestamp', updatedAt: 'timestamp' });
    });

    it('stores them with a time zone when the app asks for it', async () => {
        await expect(typesOf(true)).resolves.toEqual({ createdAt: 'timestamptz', updatedAt: 'timestamptz' });
    });
});
