import BaseController, { Route } from '../lib/http/Controller';
import { get } from '@pollium/readable-contracts/routing';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

const noteRoutes = {
    list: get<string[]>('/tower/notes')
};

class NoteController extends BaseController{
    @Route(noteRoutes.list)
    list(){
        return ['first'];
    }

    @Route('/latest')
    latest(){
        return 'first';
    }
}

const mounted = async () => {
    const app = Fastify();
    await new NoteController().register(app, '/notes');

    return app;
};

describe('Route paths', () => {
    it('mounts an endpoint at the path its contract names, under any module prefix', async () => {
        const app = await mounted();

        const res = await app.inject({ method: 'GET', url: '/tower/notes' });

        expect(res.json()).toEqual({ data: ['first'] });
        await app.close();
    });

    it('mounts a path the controller writes itself under the module prefix', async () => {
        const app = await mounted();

        const res = await app.inject({ method: 'GET', url: '/notes/latest' });

        expect(res.json()).toEqual({ data: 'first' });
        await app.close();
    });
});
