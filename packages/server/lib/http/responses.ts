import { PageMeta } from '@pollium/readable-contracts/http';
import { Page } from './params';

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
        readonly body: string | Buffer,
        readonly contentType: string,
        readonly status: number = 200
    ){}
}

export class RedirectResponse{
    constructor(
        readonly url: string,
        readonly status: number = 302
    ){}
}
