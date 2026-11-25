import { settings } from '../app/config';
import { FieldCopy } from '../forms/messages';
import { ApiError } from '../http/ApiError';
import {
    AuthErrors,
    baseCodeOf,
    ErrorCode,
    ErrorTable,
    RateLimitErrors,
    RequestErrors,
    ServerErrors
} from '@pollium/readable-contracts/errors';

export type Copy = string | (() => string);

export type CopyOf<T extends ErrorTable> = {
    readonly [Cause in keyof T['causes']]: Copy;
};

export type ReadableErrorCode =
    | ErrorCode<typeof AuthErrors>
    | ErrorCode<typeof RateLimitErrors>
    | ErrorCode<typeof RequestErrors>
    | ErrorCode<typeof ServerErrors>;

type Codes = Readonly<Partial<Record<string, Copy>>>;

export interface AppCopy{
    offline: Copy;
    unknown: string | ((code: string) => string);
    codes: Readonly<Record<ReadableErrorCode, Copy>> & Codes;
    fields?: Partial<FieldCopy>;
}

export interface ErrorCopy{
    (error: Error | null | undefined): string | null;
    readonly codes: Codes;
    with: (...others: ErrorCopy[]) => ErrorCopy;
}

const textOf = (copy: Copy): string => typeof copy === 'function' ? copy() : copy;

const describing = (codes: Codes): ErrorCopy => {
    const describe = (error: Error | null | undefined): string | null => {
        if(error === null || error === undefined) return null;

        const app = settings().copy;
        if(error instanceof ApiError && error.isNetworkError) return app === null ? error.message : textOf(app.offline);

        const code = baseCodeOf(error.message);
        const copy = codes[code] ?? app?.codes[code];
        if(copy !== undefined) return textOf(copy);
        if(app === null) return error.message;
        return typeof app.unknown === 'function' ? app.unknown(code) : app.unknown;
    };

    return Object.assign(describe, {
        codes,
        with: (...others: ErrorCopy[]) => describing(Object.assign({}, codes, ...others.map((other) => other.codes)))
    });
};

export const copyFor = <const T extends ErrorTable>(table: T, copy: CopyOf<T>): ErrorCopy =>
    describing(Object.fromEntries(Object.entries(copy).map(([cause, text]) => [`${table.domain}::${cause}`, text])));

export const describeError: ErrorCopy = describing({});
