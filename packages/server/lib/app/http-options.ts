import { IdFormat, configureIds } from '../http/params';
import { Authenticate, SignTestToken, configureAuthentication } from '../auth/authentication';
import { ErrorMapper } from './error-answers';
import { FastifyHttpOptions } from 'fastify';
import { Server } from 'node:http';

// Readable owns the logger; everything else Fastify takes at construction passes through, the
// server's own timeouts under http (http: { headersTimeout }).
export type FastifyOptions = Omit<FastifyHttpOptions<Server>, 'logger' | 'loggerInstance' | 'http2'>;

export interface HttpOptions{
    host?: string;
    fastify?: FastifyOptions;
    exposedHeaders?: string[];
    ids?: IdFormat;
    authenticate?: Authenticate;
    signTestToken?: SignTestToken;
    mapError?: ErrorMapper;
}

// These settings are read by free functions (parseId, the guards and the test request helper), so
// the app being built sets them for the whole process, back to their defaults when it leaves one out.
export const applyHttpOptions = (options: HttpOptions) => {
    configureIds(options.ids);
    configureAuthentication(options);
};
