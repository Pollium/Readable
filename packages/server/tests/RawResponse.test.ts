import BaseController, { Route } from '../lib/http/Controller';
import { RawResponse } from '../lib/http/responses';
import { contentDisposition, download } from '../lib/http/download';
import Fastify from 'fastify';
import { Readable } from 'node:stream';
import { describe, expect, it } from 'vitest';

const ATOMS = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);

class TrajectoryController extends BaseController{
    @Route('/atoms')
    atoms(){
        return new RawResponse(ATOMS, 'application/octet-stream', 200, {
            'x-atom-total': 2,
            'cache-control': 'public, max-age=31536000',
            vary: 'Accept'
        });
    }

    @Route('/typed')
    typed(){
        return new RawResponse(new Uint8Array(new Float32Array([1.5, -2]).buffer), 'application/octet-stream');
    }

    @Route('/dump')
    dump(){
        return new RawResponse(Readable.from(['frame 1\n', 'frame 2\n']), 'text/plain', 200, { 'x-volt-resource-encoding': 'identity' });
    }

    @Route('/broken')
    broken(){
        const stream = new Readable({
            read(){
                this.destroy(new Error('disk gone'));
            }
        });
        return new RawResponse(stream, 'application/octet-stream');
    }

    @Route('/export')
    export(){
        return download(Readable.from(['a,b\n1,2\n']), { filename: 'résumé de análisis.csv', contentType: 'text/csv', cache: 'no-cache' });
    }

    @Route('/archive')
    archive(){
        return download(ATOMS, { filename: 'frames.zip', contentType: 'application/zip', headers: { etag: '"abc"' } });
    }

    @Route('/preview')
    preview(){
        return download('<svg/>', { contentType: 'image/svg+xml', disposition: 'inline' });
    }
}

const get = async (url: string) => {
    const app = Fastify();
    app.addHook('onRequest', async (_req, reply) => {
        reply.header('vary', 'Origin');
    });
    await new TrajectoryController().register(app, '');
    const res = await app.inject({ method: 'GET', url });
    await app.close();

    return res;
};

describe('RawResponse', () => {
    it('sends its bytes with the headers it carries, adding to Vary', async () => {
        const res = await get('/atoms');

        expect(res.rawPayload).toEqual(ATOMS);
        expect(res.headers).toMatchObject({
            'content-type': 'application/octet-stream',
            'x-atom-total': '2',
            'cache-control': 'public, max-age=31536000',
            vary: 'Origin, Accept'
        });
    });

    it('sends a Uint8Array as its bytes', async () => {
        const res = await get('/typed');

        expect(new Float32Array(new Uint8Array(res.rawPayload).buffer)).toEqual(new Float32Array([1.5, -2]));
    });

    it('streams a Readable as it comes', async () => {
        const res = await get('/dump');

        expect(res.body).toBe('frame 1\nframe 2\n');
        expect(res.headers['x-volt-resource-encoding']).toBe('identity');
    });

    it('answers a stream that fails before its first byte as an error', async () => {
        const res = await get('/broken');

        expect(res.statusCode).toBe(500);
    });
});

describe('download', () => {
    it('names the file for any client, refuses sniffing and leaves an unknown length out', async () => {
        const res = await get('/export');

        expect(res.body).toBe('a,b\n1,2\n');
        expect(res.headers).toMatchObject({
            'content-type': 'text/csv',
            'content-disposition': 'attachment; filename="r_sum_ de an_lisis.csv"; filename*=UTF-8\'\'r%C3%A9sum%C3%A9%20de%20an%C3%A1lisis.csv',
            'x-content-type-options': 'nosniff',
            'cache-control': 'no-cache'
        });
        expect(res.headers['content-length']).toBeUndefined();
    });

    it('gives the length of a body it holds, and keeps the headers it is handed', async () => {
        const res = await get('/archive');

        expect(res.headers).toMatchObject({
            'content-disposition': 'attachment; filename="frames.zip"',
            'content-length': String(ATOMS.length),
            etag: '"abc"'
        });
    });

    it('shows a file inline when asked, with no name', async () => {
        const res = await get('/preview');

        expect(res.headers['content-disposition']).toBe('inline');
        expect(res.headers['content-length']).toBe('6');
    });
});

describe('contentDisposition', () => {
    it('quotes a plain name and nothing more', () => {
        expect(contentDisposition('attachment', 'report 2026.csv')).toBe('attachment; filename="report 2026.csv"');
    });

    it('keeps quotes, backslashes and line breaks out of the header', () => {
        const header = contentDisposition('attachment', 'a"b\\c\r\nSet-Cookie: x=1.txt');

        expect(header).toBe('attachment; filename="a_b_c__Set-Cookie: x=1.txt"; filename*=UTF-8\'\'a%22b%5Cc%0D%0ASet-Cookie%3A%20x%3D1.txt');
        expect(header).not.toMatch(/[\r\n]/);
    });

    it('encodes every character RFC 5987 leaves out', () => {
        expect(contentDisposition('inline', "日本 (it's)*100%.zip")).toBe(
            'inline; filename="__ (it\'s)*100%.zip"; filename*=UTF-8\'\'%E6%97%A5%E6%9C%AC%20%28it%27s%29%2A100%25.zip'
        );
    });
});
