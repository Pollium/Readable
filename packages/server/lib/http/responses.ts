import { PageMeta } from '@pollium/readable-contracts/http';
import { Page } from './params';
import { Readable } from 'node:stream';

export type RawBody = string | Buffer | Uint8Array | Readable;
export type RawHeaders = Record<string, string | number | string[]>;

export class Paginated<T, Extra extends object = Record<never, never>>{
    constructor(
        readonly items: T[],
        readonly page: Page,
        readonly total: number,
        readonly extra?: Extra
    ){}

    get meta(): PageMeta<Extra>{
        return {
            ...this.extra,
            total: this.total,
            limit: this.page.limit,
            offset: this.page.offset
        } as PageMeta<Extra>;
    }
}

export class RawResponse{
    constructor(
        readonly body: RawBody,
        readonly contentType: string,
        readonly status: number = 200,
        readonly headers: RawHeaders = {}
    ){}
}

export class RedirectResponse{
    constructor(
        readonly url: string,
        readonly status: number = 302
    ){}
}
