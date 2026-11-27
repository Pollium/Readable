import BaseController, { Route } from '../lib/http/Controller';
import { Body } from '../lib/http/params';
import { put } from '@pollium/readable-contracts/routing';
import Fastify from 'fastify';
import { IValidation } from 'typia';
import { PassThrough, Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

interface Received{
    streamed: boolean;
    text: string;
}

const objectRoutes = {
    upload: put<never, Received>('/cluster-objects/:token')
};

const refuseEverything = (input: unknown): IValidation<unknown> => ({
    success: false,
    data: input,
    errors: [{ path: '$input', expected: 'never', value: input }]
} as IValidation<unknown>);

let firstChunk: () => void = () => {};

const read = async (stream: Readable): Promise<string> => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream){
        chunks.push(Buffer.from(chunk as Buffer));
        if(chunks.length === 1) firstChunk();
    }

    return Buffer.concat(chunks).toString();
};

class ClusterObjectController extends BaseController{
    @Route(objectRoutes.upload, { body: 'stream' })
    async upload(@Body(refuseEverything) body: Readable){
        return { streamed: body instanceof Readable, text: await read(body) };
    }

    @Route('/parts', { method: 'PUT', body: 'stream' })
    async part(@Body() body: Readable){
        return { streamed: body instanceof Readable, text: await read(body) };
    }

    @Route('/notes', 'POST')
    note(@Body() body: unknown){
        return { streamed: body instanceof Readable, body };
    }
}

const mounted = async () => {
    const app = Fastify({ bodyLimit: 16 });
    await new ClusterObjectController().register(app, '/objects');

    return app;
};

const BIG = 'x'.repeat(4096);

describe('a route that takes its body as a stream', () => {
    it('hands @Body() the request stream unread, whatever its type, past the body limit', async () => {
        const app = await mounted();

        const binary = await app.inject({ method: 'PUT', url: '/cluster-objects/t1', headers: { 'content-type': 'application/octet-stream' }, payload: BIG });
        const json = await app.inject({ method: 'PUT', url: '/cluster-objects/t1', headers: { 'content-type': 'application/json' }, payload: '{"not":"parsed"}' });
        const untyped = await app.inject({ method: 'PUT', url: '/objects/parts', payload: Buffer.from('raw bytes') });

        expect(binary.json()).toEqual({ data: { streamed: true, text: BIG } });
        expect(json.json()).toEqual({ data: { streamed: true, text: '{"not":"parsed"}' } });
        expect(untyped.json()).toEqual({ data: { streamed: true, text: 'raw bytes' } });
        await app.close();
    });

    it('reads as an empty stream when nothing was sent', async () => {
        const app = await mounted();

        const res = await app.inject({ method: 'PUT', url: '/objects/parts' });

        expect(res.json()).toEqual({ data: { streamed: true, text: '' } });
        await app.close();
    });

    it('reaches the handler before the body has all arrived', async () => {
        const app = await mounted();
        const upload = new PassThrough();
        const seen = new Promise<void>((resolve) => {
            firstChunk = resolve;
        });

        const pending = app.inject({ method: 'PUT', url: '/cluster-objects/t2', headers: { 'content-type': 'application/octet-stream' }, payload: upload });
        upload.write('first ');
        await seen;
        upload.end('last');

        expect((await pending).json()).toEqual({ data: { streamed: true, text: 'first last' } });
        await app.close();
    });

    it('leaves every other route parsing and limiting bodies as before', async () => {
        const app = await mounted();

        const parsed = await app.inject({ method: 'POST', url: '/objects/notes', payload: { a: 1 } });
        const refused = await app.inject({ method: 'POST', url: '/objects/notes', headers: { 'content-type': 'application/octet-stream' }, payload: 'bytes' });
        const tooLarge = await app.inject({ method: 'POST', url: '/objects/notes', payload: { text: BIG } });

        expect(parsed.json()).toEqual({ data: { streamed: false, body: { a: 1 } } });
        expect(refused.statusCode).toBe(415);
        expect(tooLarge.statusCode).toBe(413);
        await app.close();
    });
});
