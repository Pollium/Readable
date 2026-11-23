import BaseController, { Route } from '../lib/http/Controller';
import { Reply, Req } from '../lib/http/params';
import Fastify, { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

class EchoController extends BaseController{
    @Route('/echo')
    echo(@Req() req: FastifyRequest, @Reply() reply: FastifyReply){
        reply.header('x-echo', String(req.headers['x-probe']));
        return { url: req.url };
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
