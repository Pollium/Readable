import { PageMeta } from '@pollium/readable-contracts/http';
import { Page } from './params';

export class Paginated<T>{
    constructor(
        readonly items: T[],
        readonly page: Page,
        readonly total: number
    ){}

    get meta(): PageMeta{
        return {
            total: this.total,
            limit: this.page.limit,
            offset: this.page.offset
        };
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
