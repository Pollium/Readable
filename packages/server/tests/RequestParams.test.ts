import BaseController, { Route } from '../lib/http/Controller';
import { Query, Reply, Req } from '../lib/http/params';
import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

class EchoController extends BaseController{
    @Route('/echo')
    echo(@Req() req: FastifyRequest, @Reply() reply: FastifyReply){
        reply.header('x-echo', String(req.headers['x-probe']));
        return { url: req.url };
    }

    @Route('/search')
    search(@Query() query: Record<string, string>, @Query('page') page: string){
        return { query, page };
    }
}

describe('Req and Reply', () => {
    it('hand a handler the request and the reply it answers with', async () => {
        const app = Fastify();
        await new EchoController().register(app, '');

        const res = await app.inject({ method: 'GET', url: '/echo', headers: { 'x-probe': 'seen' } });

        expect(res.headers['x-echo']).toBe('seen');
        expect(res.json()).toEqual({ data: { url: '/echo' } });
        await app.close();
    });
});

describe('Query', () => {
    it('hands a handler the whole query, or one value of it by name', async () => {
        const app = Fastify();
        await new EchoController().register(app, '');

        const res = await app.inject({ method: 'GET', url: '/search?term=condor&page=2' });

        expect(res.json()).toEqual({ data: { query: { term: 'condor', page: '2' }, page: '2' } });
        await app.close();
    });
});
