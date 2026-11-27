import BaseController, { Route } from '../lib/http/Controller';
import { Header, Ip, Query, Reply, Req, UserAgent } from '../lib/http/params';
import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

class EchoController extends BaseController{
    @Route('/echo')
    echo(@Req() req: FastifyRequest, @Reply() reply: FastifyReply){
        reply.header('x-echo', String(req.headers['x-probe']));
        return { url: req.url };
    }

    @Route('/client')
    client(@Header('If-None-Match') etag: string | undefined, @Header('x-missing') missing: string | undefined, @Ip() ip: string, @UserAgent() agent: string | undefined){
        return { etag: etag ?? null, missing: missing ?? null, ip, agent: agent ?? null };
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

describe('Header, Ip and UserAgent', () => {
    it('hand a handler one request header by any case of its name, the client address and its agent', async () => {
        const app = Fastify({ trustProxy: true });
        await new EchoController().register(app, '');

        const res = await app.inject({
            method: 'GET',
            url: '/client',
            remoteAddress: '10.0.0.2',
            headers: { 'if-none-match': '"v1"', 'user-agent': 'voltsdk/1.0', 'x-forwarded-for': '203.0.113.7' }
        });

        expect(res.json()).toEqual({ data: { etag: '"v1"', missing: null, ip: '203.0.113.7', agent: 'voltsdk/1.0' } });
        await app.close();
    });
});
