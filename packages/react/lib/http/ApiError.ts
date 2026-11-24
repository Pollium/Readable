import { baseCodeOf } from '@pollium/readable-contracts/errors';
import { ApiError as ErrorBody } from '@pollium/readable-contracts/http';

export class ApiError extends Error{
    readonly status: number;
    readonly body: unknown;

    constructor(status: number, message: string, body?: unknown, options?: ErrorOptions){
        super(message, options);
        this.name = 'ApiError';
        this.status = status;
        this.body = body;
    }

    get code(): string{
        return baseCodeOf(this.message);
    }

    get fields(): Readonly<Record<string, string>>{
        const errors = (this.body as ErrorBody | undefined)?.errors;
        return errors !== null && typeof errors === 'object' ? errors : {};
    }

    get isNetworkError(): boolean{
        return this.status === 0;
    }
}
