import { FastifyInstance, FastifyReply } from 'fastify';
import { promisify } from 'node:util';
import { brotliCompress, constants, gzip } from 'node:zlib';

type Encoding = 'br' | 'gzip';

const encodingFor = (accepted: string | undefined): Encoding | null => {
    const offered = (accepted ?? '').split(',').map((part) => part.trim().split(';')[0]);
    if(offered.includes('br')) return 'br';

    return offered.includes('gzip') ? 'gzip' : null;
};

const isCompressible = (reply: FastifyReply): boolean => {
    const compressibleType = /^(application\/(json|xml|javascript)|text\/|image\/svg\+xml)/;

    return !reply.hasHeader('content-encoding') && compressibleType.test(String(reply.getHeader('content-type') ?? ''));
};

const varyOnEncoding = (reply: FastifyReply) => {
    const vary = reply.getHeader('vary');
    reply.header('vary', vary === undefined ? 'Accept-Encoding' : `${String(vary)}, Accept-Encoding`);
};

export const registerCompression = (app: FastifyInstance) => {
    const brotli = promisify(brotliCompress);
    const gzipped = promisify(gzip);

    app.addHook('onSend', async (request, reply, payload) => {
        if(typeof payload !== 'string' && !Buffer.isBuffer(payload)) return payload;
        if(!isCompressible(reply)) return payload;

        const body = Buffer.from(payload);
        const encoding = encodingFor(request.headers['accept-encoding']);
        if(body.length < 1024 || encoding === null) return payload;

        const compressed = encoding === 'br'
            ? await brotli(body, { params: { [constants.BROTLI_PARAM_QUALITY]: 4, [constants.BROTLI_PARAM_SIZE_HINT]: body.length } })
            : await gzipped(body);

        reply.header('content-encoding', encoding);
        reply.removeHeader('content-length');
        varyOnEncoding(reply);

        return compressed;
    });
};
