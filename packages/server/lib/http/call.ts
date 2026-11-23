import { RuntimeError, defineErrors, AuthError } from '../app/errors';
import { Endpoint } from '@pollium/readable-contracts/routing';
import { logger } from '../app/logger';
import { MiddlewareFn } from './middleware';
import { timingSafeEqual } from 'node:crypto';

export interface Host{
    url: string;
    header: string;
    key: string;
}

export interface CallOptions<I>{
    path?: Record<string, string>;
    query?: Record<string, string>;
    body?: I;
}

export const CallError = defineErrors({
    domain: 'Call',
    causes: {
        Failed: 502,
        Rejected: 502
    }
} as const);

export const isNotFound = (error: unknown): boolean =>
    error instanceof RuntimeError && error.statusCode === 404;

export const interpolate = (path: string, params: Record<string, string> = {}): string =>
    path.replace(/:(\w+)/g, (_, name: string) => encodeURIComponent(params[name] ?? ''));

const unwrap = <T>(payload: unknown): T => {
    if(payload !== null && typeof payload === 'object' && 'data' in payload){
        return (payload as { data: T }).data;
    }

    return payload as T;
};

const errorOf = async (response: Response): Promise<RuntimeError> => {
    const payload = await response.json().catch(() => null);
    if(payload !== null && typeof payload === 'object' && 'error' in payload && typeof payload.error === 'string'){
        return new RuntimeError(payload.error, response.status);
    }

    return CallError.Failed(String(response.status));
};

const rejectionOf = <I, O>(host: Host, endpoint: Endpoint<I, O>, status: number): RuntimeError => {
    logger.error(`${endpoint.method} ${host.url}${endpoint.path} rejected the ${host.header} service key`, null, {
        scope: 'call',
        statusCode: status
    });

    return CallError.Rejected(String(status));
};

export const request = async <I, O>(
    host: Host,
    endpoint: Endpoint<I, O>,
    options: CallOptions<I> = {}
): Promise<Response> => {
    const path = interpolate(endpoint.path, options.path);
    const search = options.query === undefined ? '' : `?${new URLSearchParams(options.query)}`;
    const response = await fetch(`${host.url}${path}${search}`, {
        method: endpoint.method,
        body: options.body === undefined ? undefined : JSON.stringify(options.body),
        headers: {
            [host.header]: host.key,
            ...(options.body === undefined ? {} : { 'content-type': 'application/json' })
        }
    });

    if([401, 403].includes(response.status)) throw rejectionOf(host, endpoint, response.status);
    if(!response.ok) throw await errorOf(response);

    return response;
};

export const call = async <I, O>(
    host: Host,
    endpoint: Endpoint<I, O>,
    options: CallOptions<I> = {}
): Promise<O> => {
    const response = await request(host, endpoint, options);
    if(response.status === 204) return undefined as O;

    return unwrap<O>(await response.json());
};

export class ServiceClient{
    #host: Host;

    constructor(host: Host){
        this.#host = host;
    }

    call<I, O>(endpoint: Endpoint<I, O>, options?: CallOptions<I>): Promise<O>{
        return call(this.#host, endpoint, options);
    }
}

export const ServiceKeyRoute = (header: string, expected: string): MiddlewareFn => (req) => {
    const presented = req.headers[header];
    if(typeof presented !== 'string' || presented === '') throw AuthError.Unauthorized();

    const left = Buffer.from(presented);
    const right = Buffer.from(expected);
    if(left.length !== right.length || !timingSafeEqual(left, right)){
        throw AuthError.Unauthorized();
    }
};
