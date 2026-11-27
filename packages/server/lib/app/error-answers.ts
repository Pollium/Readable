import { DatabaseError, RuntimeError, ServerError } from './errors';

export type ErrorMapper = (error: unknown) => RuntimeError | undefined;

const CONSTRAINTS = new Map<string, () => RuntimeError>([
    ['23505', DatabaseError.UniqueViolation],
    ['23503', DatabaseError.ForeignKeyViolation],
    ['23502', DatabaseError.NotNullViolation],
    ['SQLITE_CONSTRAINT_UNIQUE', DatabaseError.UniqueViolation],
    ['SQLITE_CONSTRAINT_PRIMARYKEY', DatabaseError.UniqueViolation],
    ['SQLITE_CONSTRAINT_FOREIGNKEY', DatabaseError.ForeignKeyViolation],
    ['SQLITE_CONSTRAINT_NOTNULL', DatabaseError.NotNullViolation]
]);

// Read by name rather than instanceof, so Application does not load TypeORM to answer an error and
// a second copy of TypeORM in node_modules is still recognised.
export const databaseErrorOf = (error: unknown): RuntimeError | undefined => {
    if(!(error instanceof Error) || error.name !== 'QueryFailedError') return undefined;

    const code = (error as { driverError?: { code?: unknown } }).driverError?.code;
    return typeof code === 'string' ? CONSTRAINTS.get(code)?.() : undefined;
};

export const answerOf = (error: unknown, mapError?: ErrorMapper): RuntimeError => {
    if(error instanceof RuntimeError) return error;

    return mapError?.(error) ?? databaseErrorOf(error) ?? ServerError.Internal();
};
