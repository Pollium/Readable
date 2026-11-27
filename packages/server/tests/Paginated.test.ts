import BaseController, { Route } from '../lib/http/Controller';
import { Paginated } from '../lib/http/responses';
import { PageMeta, PageOf } from '@pollium/readable-contracts/http';
import Fastify from 'fastify';
import { describe, expect, expectTypeOf, it } from 'vitest';

const PAGE = { limit: 2, offset: 4 };

class TrajectoryController extends BaseController{
    @Route('/plain')
    plain(){
        return new Paginated(['a', 'b'], PAGE, 9);
    }

    @Route('/columns')
    columns(){
        return new Paginated(['a', 'b'], PAGE, 9, { columns: ['name', 'frames'] });
    }

    @Route('/clash')
    clash(){
        return new Paginated(['a'], PAGE, 9, { total: 1000, offset: -1, columns: [] });
    }
}

const answer = async (url: string) => {
    const app = Fastify();
    await new TrajectoryController().register(app, '');
    const res = await app.inject({ method: 'GET', url });
    await app.close();

    return res.json();
};

describe('Paginated', () => {
    it('answers the items and a meta of total, limit and offset', async () => {
        expect(await answer('/plain')).toEqual({ data: ['a', 'b'], meta: { total: 9, limit: 2, offset: 4 } });
    });

    it('carries an app\'s own fields in the meta beside them', async () => {
        expect(await answer('/columns')).toEqual({
            data: ['a', 'b'],
            meta: { total: 9, limit: 2, offset: 4, columns: ['name', 'frames'] }
        });
    });

    it('keeps total, limit and offset over extra fields of the same name', async () => {
        expect((await answer('/clash')).meta).toEqual({ total: 9, limit: 2, offset: 4, columns: [] });
    });

    it('types the meta with the extra fields, and without them as before', () => {
        expectTypeOf(new Paginated(['a'], PAGE, 1).meta).toEqualTypeOf<PageMeta>();
        expectTypeOf(new Paginated(['a'], PAGE, 1, { columns: ['name'] }).meta.columns).toEqualTypeOf<string[]>();
        expectTypeOf<PageOf<string>['meta']>().toMatchObjectType<{ total: number; limit: number; offset: number }>();
    });
});
