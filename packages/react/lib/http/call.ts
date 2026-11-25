import { settings } from '../app/config';
import { session } from '../session/session';
import { ApiError } from './ApiError';
import { AuthErrors, baseCodeOf, defineErrors } from '@pollium/readable-contracts/errors';
import { ApiError as ErrorBody, ApiResponse, PageOf } from '@pollium/readable-contracts/http';
import { Endpoint } from '@pollium/readable-contracts/routing';

export type PathValues = Readonly<Record<string, string | number | undefined>>;

export interface Target{
    base?: string;
    path?: PathValues;
    query?: object;
    headers?: Readonly<Record<string, string>>;
}

export type Body<I> = [I] extends [never]
    ? { body?: FormData }
    : undefined extends I ? { body?: I | FormData } : { body: I | FormData };

export type CallArgs<I> = Target & Body<I> & {
    signal?: AbortSignal;
    keepalive?: boolean;
};

export type ArgsOf<I> = [I] extends [never]
    ? [args?: CallArgs<I>]
    : undefined extends I ? [args?: CallArgs<I>] : [args: CallArgs<I>];

const CallErrors = defineErrors({
    domain: 'Call',
    causes: {
        MissingPathParam: 500
    }
});

const PARAM = /:(\w+)/g;

const ENDS_SESSION = Object.entries(AuthErrors.causes)
    .filter(([, status]) => status === 401)
    .map(([cause]) => `${AuthErrors.domain}::${cause}`);

export const isComplete = (template: string, values: PathValues = {}): boolean =>
    [...template.matchAll(PARAM)].every(([, name]) => values[name] !== undefined);

export const pathOf = (template: string, values: PathValues = {}): string =>
    template.replace(PARAM, (_, name: string) => {
        const value = values[name];
        if(value === undefined) throw CallErrors.MissingPathParam(`${name}@${template}`);
        return encodeURIComponent(value);
    });

const textOf = (value: unknown): string => value instanceof Date ? value.toISOString() : String(value);

export const searchOf = (query: object = {}): string => {
    const params = new URLSearchParams();
    const entries = Object.entries(query).sort(([a], [b]) => a.localeCompare(b));
    for(const [name, value] of entries){
        for(const item of Array.isArray(value) ? value : [value]){
            if(item !== undefined && item !== null) params.append(name, textOf(item));
        }
    }
    const search = params.toString();
    return search === '' ? '' : `?${search}`;
};

export const urlOf = (endpoint: Pick<Endpoint, 'path'>, { base, path, query }: Target = {}): string =>
    `${(base ?? settings().apiUrl).replace(/\/+$/, '')}${pathOf(endpoint.path, path)}${searchOf(query)}`;

const isJson = (body: unknown): boolean => body !== undefined && !(body instanceof FormData);

const headersOf = (body: unknown, token: string | null): Record<string, string> => ({
    ...(isJson(body) ? { 'Content-Type': 'application/json' } : {}),
    ...(token === null ? {} : { Authorization: `Bearer ${token}` })
});

const unwrap = (payload: unknown): unknown => {
    const answer = payload as ApiResponse<unknown> | undefined;
    if(!answer?.meta) return answer?.data;

    return {
        items: answer.data as unknown[],
        meta: answer.meta
    } satisfies PageOf<unknown>;
};

const payloadOf = async (response: Response): Promise<unknown> => {
    const text = await response.text().catch(() => '');
    if(text === '') return undefined;

    try{
        return JSON.parse(text);
    }catch{
        return undefined;
    }
};

const send = async (url: string, init: RequestInit): Promise<Response> => {
    try{
        return await fetch(url, init);
    }catch(cause: unknown){
        if(init.signal?.aborted) throw cause;
        throw new ApiError(0, 'Network::Unreachable', undefined, { cause });
    }
};

export const request = async (endpoint: Pick<Endpoint, 'method' | 'path'>, args: CallArgs<unknown> = {}): Promise<unknown> => {
    const { base, path, query, headers, body, signal, keepalive } = args;
    const token = session.token;
    const response = await send(urlOf(endpoint, { base, path, query }), {
        method: endpoint.method,
        headers: { ...headersOf(body, token), ...headers },
        body: isJson(body) ? JSON.stringify(body) : body as FormData | undefined,
        signal,
        keepalive
    });
    const payload = await payloadOf(response);
    if(response.ok) return unwrap(payload);

    const code = (payload as ErrorBody | undefined)?.error ?? response.statusText;
    if(response.status === 401 && token !== null && ENDS_SESSION.includes(baseCodeOf(code))) session.end(token);
    throw new ApiError(response.status, code, payload);
};

export const call = <I, O>(endpoint: Endpoint<I, O>, ...[args]: ArgsOf<I>): Promise<O> =>
    request(endpoint, args as CallArgs<unknown>) as Promise<O>;
