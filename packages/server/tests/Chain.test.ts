import BaseController, { Route } from '../lib/http/Controller';
import { Middleware, MiddlewareFn, chain } from '../lib/http/middleware';
import { RuntimeError } from '../lib/app/errors';
import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';

const signedIn = new WeakSet<object>();
const visited: string[] = [];

const signIn: MiddlewareFn = async (req) => {
    await new Promise((resolve) => setTimeout(resolve, 5));
    signedIn.add(req);
};

const onlySignedIn: MiddlewareFn = (req) => {
    visited.push('onlySignedIn');
    if(!signedIn.has(req)) throw new RuntimeError('Auth::Unauthorized', 401);
};

const refuse: MiddlewareFn = () => {
    throw new RuntimeError('Auth::Forbidden', 403);
};

class GuardedController extends BaseController{
    @Route('/members')
    @Middleware(chain(signIn, onlySignedIn))
    members(){
        return 'welcome';
    }

    @Route('/closed')
    @Middleware(chain(refuse, onlySignedIn))
    closed(){
        return 'never';
    }
}

const mounted = async () => {
    const app = Fastify();
    await new GuardedController().register(app, '');

    return app;
};

describe('chain', () => {
    it('waits for each guard before the next one reads what it left', async () => {
        const app = await mounted();

        const res = await app.inject({ method: 'GET', url: '/members' });

        expect(res.json()).toEqual({ data: 'welcome' });
        await app.close();
    });

    it('stops at the first guard that refuses', async () => {
        const app = await mounted();
        visited.length = 0;

        const res = await app.inject({ method: 'GET', url: '/closed' });

        expect(res.statusCode).toBe(403);
        expect(visited).toEqual([]);
        await app.close();
    });
});
