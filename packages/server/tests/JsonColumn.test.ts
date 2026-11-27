import 'reflect-metadata';
import { BaseModel, JsonColumn } from '../lib/database/models';
import { Entity, getMetadataArgsStorage } from 'typeorm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { openSqlite } from './sqlite';

afterEach(() => {
    vi.unstubAllEnvs();
});

describe('JsonColumn', () => {
    const jsonModel = () => {
        @Entity()
        class LiteDocument extends BaseModel{
            @JsonColumn({ nullable: true })
            body!: { blocks: string[] } | null;
        }

        return LiteDocument;
    };

    const typeUnder = (url: string) => {
        vi.stubEnv('DATABASE_URL', url);
        const Model = jsonModel();
        return getMetadataArgsStorage().columns.find((column) => column.target === Model)?.options;
    };

    it('is jsonb on Postgres and simple-json on SQLite, read from DATABASE_URL when the model is declared', () => {
        expect(typeUnder('postgres://localhost/app')).toMatchObject({ type: 'jsonb', nullable: true });
        expect(typeUnder('sqlite::memory:')).toMatchObject({ type: 'simple-json', nullable: true });
    });

    it('stores and reads a value on SQLite', async () => {
        vi.stubEnv('DATABASE_URL', 'sqlite::memory:');
        const Document = jsonModel();
        const dataSource = await openSqlite([Document]);
        const documents = dataSource.getRepository(Document);

        const saved = await documents.save(documents.create({ body: { blocks: ['a', 'b'] } }));

        await expect(documents.findOneByOrFail({ id: saved.id })).resolves.toMatchObject({ body: { blocks: ['a', 'b'] } });
        await dataSource.destroy();
    });
});
