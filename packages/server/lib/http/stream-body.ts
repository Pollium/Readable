import { FastifyInstance, FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';

const streamed = new WeakSet<FastifyRequest>();

// A route that takes its body as a stream gets a scope of its own whose only parser hands the
// request stream over unread, whatever its content type, so no body limit applies to it.
export const takeBodyAsStream = (scope: FastifyInstance) => {
    scope.removeAllContentTypeParsers();
    scope.addContentTypeParser('*', (_req, payload, done) => {
        done(null, payload);
    });
    scope.addHook('onRequest', (req, _reply, done) => {
        streamed.add(req);
        done();
    });
};

// Fastify skips the parser of a request with no body at all; that one reads as an empty stream.
export const streamedBodyOf = (req: FastifyRequest): Readable | undefined => {
    if(!streamed.has(req)) return undefined;

    return (req.body as Readable | undefined) ?? req.raw;
};
