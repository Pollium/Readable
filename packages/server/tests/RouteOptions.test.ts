import BaseController, { Route } from '../lib/http/Controller';
import Fastify, { RouteOptions } from 'fastify';
import { describe, expect, it } from 'vitest';

class UploadController extends BaseController{
    @Route('/small', { method: 'POST', bodyLimit: 10 })
    small(){
        return { ok: true };
    }

    @Route('/patched', 'PATCH')
    patched(){
        return { ok: true };
    }
}

const mounted = async () => {
    const app = Fastify();
    const routes: RouteOptions[] = [];
    app.addHook('onRoute', (route) => {
        routes.push(route);
    });
    await new UploadController().register(app, '');
    await app.ready();

    return { app, routes };
};

describe('Route options', () => {
    it('gives the route the body limit it asks for', async () => {
        const { app, routes } = await mounted();

        expect(routes.find((route) => route.url === '/small')).toMatchObject({ method: 'POST', bodyLimit: 10 });
        await app.close();
    });

    it('refuses a body over that limit and takes one under the default elsewhere', async () => {
        const { app } = await mounted();
        const body = { text: 'more than ten bytes' };

        const refused = await app.inject({ method: 'POST', url: '/small', payload: body });
        const taken = await app.inject({ method: 'PATCH', url: '/patched', payload: body });

        expect(refused.statusCode).toBe(413);
        expect(taken.statusCode).toBe(200);
        await app.close();
    });

    it('still takes a method on its own and leaves the default body limit', async () => {
        const { app, routes } = await mounted();
        const patched = routes.find((route) => route.url === '/patched');

        expect(patched?.method).toBe('PATCH');
        expect(patched?.bodyLimit).toBeUndefined();
        await app.close();
    });
});
