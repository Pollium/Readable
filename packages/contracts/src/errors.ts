const BASE_CODE = /^([^:]+::[^:]+)/;

export const baseCodeOf = (code: string): string => BASE_CODE.exec(code)?.[1] ?? code;

export interface ErrorTable{
    readonly domain: string;
    readonly causes: Readonly<Record<string, number>>;
}

export type ErrorCode<T extends ErrorTable> =
    `${T['domain']}::${Extract<keyof T['causes'], string>}`;

export type ErrorFactories<T extends ErrorTable> = {
    readonly [Cause in keyof T['causes']]: (detail?: string) => RuntimeError;
};

export class RuntimeError extends Error{
    constructor(message: string, public statusCode: number){
        super(message);
    }
}

export const defineErrors = <const T extends ErrorTable>(table: T): T & ErrorFactories<T> => {
    const factories: Record<string, (detail?: string) => RuntimeError> = {};
    for(const [cause, status] of Object.entries(table.causes)){
        factories[cause] = (detail?: string) => {
            const code = detail === undefined ? `${table.domain}::${cause}` : `${table.domain}::${cause}:${detail}`;
            return new RuntimeError(code, status);
        };
    }
    return { ...table, ...factories } as T & ErrorFactories<T>;
};

export const GatewayErrors = {
    domain: 'Gateway',
    causes: {
        MissingChannel: 500,
        MalformedFrame: 400,
        UnknownMessageType: 400,
        Internal: 500
    }
} as const satisfies ErrorTable;

export type GatewayErrorCode = ErrorCode<typeof GatewayErrors>;

export const RateLimitErrors = {
    domain: 'RateLimit',
    causes: {
        TooManyRequests: 429
    }
} as const satisfies ErrorTable;

export type RateLimitErrorCode = ErrorCode<typeof RateLimitErrors>;

export const RequestErrors = {
    domain: 'Request',
    causes: {
        InvalidId: 400,
        InvalidPagination: 400,
        FileMissing: 400,
        FileTooLarge: 413,
        ValidationFailed: 400
    }
} as const satisfies ErrorTable;

export type RequestErrorCode = ErrorCode<typeof RequestErrors>;

export const AuthErrors = {
    domain: 'Auth',
    causes: {
        Unauthorized: 401,
        InvalidToken: 401
    }
} as const satisfies ErrorTable;

export type AuthErrorCode = ErrorCode<typeof AuthErrors>;

export const DatabaseErrors = {
    domain: 'Database',
    causes: {
        UniqueViolation: 409,
        ForeignKeyViolation: 409,
        NotNullViolation: 400
    }
} as const satisfies ErrorTable;

export type DatabaseErrorCode = ErrorCode<typeof DatabaseErrors>;

export const ServerErrors = {
    domain: 'Server',
    causes: {
        Internal: 500
    }
} as const satisfies ErrorTable;

export type ServerErrorCode = ErrorCode<typeof ServerErrors>;
