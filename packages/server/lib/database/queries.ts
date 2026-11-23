import { RuntimeError } from '../app/errors';
import {
    EntityManager,
    EntityTarget,
    ObjectLiteral,
    BaseEntity,
    FindOptionsWhere,
    QueryFailedError
} from 'typeorm';

export interface TableRef{
    table: string;
    primaryKey: string;
    column(property: string): string;
}

export interface DayCount{
    date: string;
    count: number;
}

interface DayCountRow{
    date: string;
    count: string;
}

type Positioned = BaseEntity & { position: number };

export const tableRef = (manager: EntityManager, target: EntityTarget<ObjectLiteral>): TableRef => {
    const metadata = manager.connection.getMetadata(target);

    return {
        table: metadata.tablePath.split('.').map((part) => `"${part}"`).join('.'),
        primaryKey: metadata.primaryColumns[0]!.databaseName,
        column: (property) => metadata.findColumnWithPropertyPathStrict(property)!.databaseName
    };
};

export const findOrThrow = async <T extends BaseEntity>(
    model: { new (): T } & typeof BaseEntity,
    where: FindOptionsWhere<T>,
    missing: () => RuntimeError
): Promise<T> => {
    const found = await model.getRepository<T>().findOneBy(where);
    if(!found) throw missing();

    return found;
};

export const isUniqueViolation = (error: unknown): error is QueryFailedError => {
    return (error instanceof QueryFailedError && error.driverError.code === '23505');
};

export const nextPosition = async <T extends Positioned>(
    model: { new (): T } & typeof BaseEntity,
    scope: FindOptionsWhere<T>
): Promise<number> => {
    const last = await model.getRepository<T>()
        .createQueryBuilder('entity')
        .where(scope)
        .orderBy('entity.position', 'DESC')
        .limit(1)
        .getOne();

    return last ? last.position + 1 : 0;
};

export const advisoryLock = async (manager: EntityManager, namespace: number, key: string) => {
    await manager.query('SELECT pg_advisory_xact_lock(hashtextextended($1, $2))', [key, namespace]);
};

const SERIES = `
    generate_series(
        CURRENT_DATE - make_interval(days => $1::int),
        CURRENT_DATE,
        INTERVAL '1 day'
    ) AS series(day)`;

export const recentDates = async (manager: EntityManager, days: number): Promise<string[]> => {
    const rows = await manager.query<{ date: string }[]>(`
        SELECT to_char(series.day, 'YYYY-MM-DD') AS date
        FROM ${SERIES}
        ORDER BY series.day ASC
    `, [days - 1]);

    return rows.map((row) => row.date);
};

export const countPerDay = async (
    target: typeof BaseEntity & EntityTarget<ObjectLiteral>,
    property: string,
    days: number
): Promise<DayCount[]> => {
    const manager = target.getRepository().manager;
    const ref = tableRef(manager, target);
    const stamp = ref.column(property);

    const rows = await manager.query<DayCountRow[]>(`
        SELECT to_char(series.day, 'YYYY-MM-DD') AS date, COUNT(entry."${ref.primaryKey}") AS count
        FROM ${SERIES}
        LEFT JOIN ${ref.table} AS entry
            ON entry."${stamp}" >= series.day
            AND entry."${stamp}" < series.day + INTERVAL '1 day'
        GROUP BY series.day
        ORDER BY series.day ASC
    `, [days - 1]);

    return rows.map((row) => ({ date: row.date, count: Number(row.count) }));
};
