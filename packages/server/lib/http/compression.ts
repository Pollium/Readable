import { FastifyInstance, FastifyReply } from 'fastify';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

const MIN_BYTES = 1024;
const BROTLI_QUALITY = 4;
const COMPRESSIBLE = /^(application\/(json|xml|javascript)|text\/|image\/svg\+xml)/;

const brotli = promisify(brotliCompress);
const gzipped = promisify(gzip);

type Encoding = 'br' | 'gzip';

const encodingFor = (accepted: string | undefined): Encoding | null => {
    const offered = (accepted ?? '').split(',').map((part) => part.trim().split(';')[0]);
    if(offered.includes('br')) return 'br';

    return offered.includes('gzip') ? 'gzip' : null;
};

const isCompressible = (reply: FastifyReply): boolean =>
    !reply.hasHeader('content-encoding') && COMPRESSIBLE.test(String(reply.getHeader('content-type') ?? ''));

const varyOnEncoding = (reply: FastifyReply) => {
    const vary = reply.getHeader('vary');
    reply.header('vary', vary === undefined ? 'Accept-Encoding' : `${String(vary)}, Accept-Encoding`);
};

export const registerCompression = (app: FastifyInstance) => {
    app.addHook('onSend', async (request, reply, payload) => {
        if(typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
        if(!isCompressible(reply)) return payload;

        const body = Buffer.from(payload);
        const encoding = encodingFor(request.headers['accept-encoding']);
        if(body.length < MIN_BYTES || encoding === null) return payload;

        const compressed = encoding === 'br'
            ? await brotli(body, { params: { [constants.BROTLI_PARAM_QUALITY]: BROTLI_QUALITY, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } })
            : await gzipped(body);

        reply.header('content-encoding', encoding);
        reply.removeHeader('content-length');
        varyOnEncoding(reply);

        return compressed;
    });
};
