import BaseController, { Route } from '../lib/http/Controller';
import { Page, Pagination, parsePagination } from '../lib/http/params';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

class ListingController extends BaseController{
    @Route('/trajectories')
    list(@Pagination({ defaultLimit: 20, maxLimit: 500 }) page: Page){
        return page;
    }
}

const pageOf = async (search: string) => {
    const app = Fastify();
    await new ListingController().register(app, '');
    const res = await app.inject({ method: 'GET', url: `/trajectories${search}` });
    await app.close();

    return res;
};

describe('Pagination', () => {
    it('keeps limit and offset, with their defaults and the maximum', () => {
        expect(parsePagination({})).toEqual({ limit: 50, offset: 0 });
        expect(parsePagination({ limit: '10', offset: '20' })).toEqual({ limit: 10, offset: 20 });
        expect(parsePagination({ limit: '500' })).toEqual({ limit: 100, offset: 0 });
    });

    it('turns a 1-based page into the offset of that page', () => {
        expect(parsePagination({ page: '1', limit: '25' })).toEqual({ limit: 25, offset: 0 });
        expect(parsePagination({ page: '3', limit: '25' })).toEqual({ limit: 25, offset: 50 });
        expect(parsePagination({ page: '2' }, { defaultLimit: 20 })).toEqual({ limit: 20, offset: 20 });
    });

    it('counts pages in the limit that was granted, not the one asked for', () => {
        expect(parsePagination({ page: '2', limit: '900' }, { maxLimit: 500 })).toEqual({ limit: 500, offset: 500 });
    });

    it.each([
        { page: '0' },
        { page: '-1' },
        { page: '1.5' },
        { page: 'two' },
        { page: '2', offset: '0' },
        { page: String(Number.MAX_SAFE_INTEGER), limit: '100' }
    ])('refuses %o', (query) => {
        expect(() => parsePagination(query)).toThrow('Request::InvalidPagination');
    });

    it('hands a route the page it was asked for', async () => {
        const res = await pageOf('?page=4&limit=50');

        expect(res.json()).toEqual({ data: { limit: 50, offset: 150 } });
    });

    it('answers a bad page with 400', async () => {
        const res = await pageOf('?page=0');

        expect(res.statusCode).toBe(400);
        expect(res.json()).toMatchObject({ message: 'Request::InvalidPagination' });
    });
});
