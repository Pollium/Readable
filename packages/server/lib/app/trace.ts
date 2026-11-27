import { FastifyInstance } from 'fastify';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';

export const TRACE_ID_HEADER = 'x-trace-id';

const storage = new AsyncLocalStorage<string>();

export const traceId = (): string | undefined => storage.getStore();

// A caller's id is kept when it is one printable token of reasonable length, so a header can
// neither flood the logs nor break the line it is echoed on.
const incoming = (value: string | string[] | undefined): string | undefined => {
    const id = (Array.isArray(value) ? value[0] : value)?.trim();
    return id !== undefined && /^[\x21-\x7e]{1,128}$/.test(id) ? id : undefined;
};

// The rest of the request runs inside done, and Fastify carries the async context across reading
// the body, so the guards, the handler and everything they await see the id.
export const registerTracing = (app: FastifyInstance) => {
    app.addHook('onRequest', (req, reply, done) => {
        const id = incoming(req.headers[TRACE_ID_HEADER]) ?? randomUUID();
        reply.header(TRACE_ID_HEADER, id);

        storage.run(id, done);
    });
};
