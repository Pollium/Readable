import 'reflect-metadata';
import { BaseModel } from '../lib/database/models';
import { advisoryLock, countPerDay, isUniqueViolation, recentDates } from '../lib/database/queries';
import { Column, Entity } from 'typeorm';
import { describe, expect, it } from 'vitest';
import { openSqlite } from './sqlite';

@Entity()
class LiteNote extends BaseModel{
    @Column({ unique: true })
    title!: string;
}

const dayBefore = (days: number): string => new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

const open = () => openSqlite([LiteNote]);

describe('query helpers on SQLite', () => {
    it('recognises a unique violation, on a column and on the id', async () => {
        const dataSource = await open();
        const notes = dataSource.getRepository(LiteNote);
        const first = await notes.save(notes.create({ title: 'same' }));

        const column = await notes.insert(notes.create({ title: 'same' })).catch((error: unknown) => error);
        const id = await notes.insert(notes.create({ id: first.id, title: 'other' })).catch((error: unknown) => error);
        const other = await dataSource.query('SELECT * FROM missing').catch((error: unknown) => error);

        expect(isUniqueViolation(column)).toBe(true);
        expect(isUniqueViolation(id)).toBe(true);
        expect(isUniqueViolation(other)).toBe(false);
        await dataSource.destroy();
    });

    it('takes an advisory lock as given, since transactions already run one at a time', async () => {
        const dataSource = await open();

        await expect(dataSource.transaction((manager) => advisoryLock(manager, 1, 'key'))).resolves.toBeUndefined();
        await dataSource.destroy();
    });

    it('lists the recent days and counts the rows of each, today last', async () => {
        const dataSource = await open();
        const stamp = (title: string, days: number) => dataSource.query(
            `INSERT INTO "lite_note" ("id", "title", "createdAt") VALUES (?, ?, ?)`,
            [crypto.randomUUID(), title, `${dayBefore(days)} 12:00:00.000`]
        );
        await stamp('today', 0);
        await stamp('yesterday', 1);
        await stamp('yesterday too', 1);
        await stamp('too old', 5);

        await expect(recentDates(dataSource.manager, 3)).resolves.toEqual([dayBefore(2), dayBefore(1), dayBefore(0)]);
        await expect(countPerDay(LiteNote, 'createdAt', 3)).resolves.toEqual([
            { date: dayBefore(2), count: 0 },
            { date: dayBefore(1), count: 2 },
            { date: dayBefore(0), count: 1 }
        ]);
        await dataSource.destroy();
    });
});
