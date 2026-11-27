import { DatabaseError, RequestProtocolError, RuntimeError, ServerError } from './errors';

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

const UNREADABLE = new Map<number, () => RuntimeError>([
    [400, RequestProtocolError.Malformed],
    [413, RequestProtocolError.BodyTooLarge],
    [415, RequestProtocolError.UnsupportedMediaType]
]);

// Fastify and its plugins refuse a request they cannot read (bad JSON, a body over its limit, a
// content type with no parser) with FST_ errors that carry the status the client earned.
export const requestErrorOf = (error: unknown): RuntimeError | undefined => {
    if(!(error instanceof Error)) return undefined;

    const { code, statusCode } = error as { code?: unknown; statusCode?: unknown };
    if(typeof code !== 'string' || !code.startsWith('FST_') || typeof statusCode !== 'number') return undefined;
    return UNREADABLE.get(statusCode)?.();
};

export const answerOf = (error: unknown, mapError?: ErrorMapper): RuntimeError => {
    if(error instanceof RuntimeError) return error;

    return mapError?.(error) ?? databaseErrorOf(error) ?? requestErrorOf(error) ?? ServerError.Internal();
};
