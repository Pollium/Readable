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

export type AnswerKind = 'json' | 'text' | 'blob' | 'arrayBuffer' | 'response';

export type AnswerOf<A extends AnswerKind, O> =
    A extends 'text' ? string
        : A extends 'blob' ? Blob
            : A extends 'arrayBuffer' ? ArrayBuffer
                : A extends 'response' ? Response
                    : O;

export type CallArgs<I, A extends AnswerKind = 'json'> = Target & Body<I> & {
    signal?: AbortSignal;
    keepalive?: boolean;
    as?: A;
};

export type ArgsOf<I, A extends AnswerKind = 'json'> = [I] extends [never]
    ? [args?: CallArgs<I, A>]
    : undefined extends I ? [args?: CallArgs<I, A>] : [args: CallArgs<I, A>];

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

const parsed = (text: string): unknown => {
    if(text === '') return undefined;

    try{
        return JSON.parse(text);
    }catch{
        return undefined;
    }
};

const payloadOf = async (response: Response): Promise<unknown> => parsed(await response.text().catch(() => ''));

const answerOf = async (response: Response, as: AnswerKind): Promise<unknown> => {
    switch(as){
        case 'response': return response;
        case 'text': return response.text();
        case 'blob': return response.blob();
        case 'arrayBuffer': return response.arrayBuffer();
        default: return unwrap(await payloadOf(response));
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

export const request = async (endpoint: Pick<Endpoint, 'method' | 'path'>, args: CallArgs<unknown, AnswerKind> = {}): Promise<unknown> => {
    const { base, path, query, headers, body, signal, keepalive, as = 'json' } = args;
    const token = session.token;
    const response = await send(urlOf(endpoint, { base, path, query }), {
        method: endpoint.method,
        headers: { ...headersOf(body, token), ...headers },
        body: isJson(body) ? JSON.stringify(body) : body as FormData | undefined,
        signal,
        keepalive
    });
    if(response.ok) return answerOf(response, as);

    const payload = await payloadOf(response);
    const code = (payload as ErrorBody | undefined)?.error ?? response.statusText;
    if(response.status === 401 && token !== null && ENDS_SESSION.includes(baseCodeOf(code))) session.end(token);
    throw new ApiError(response.status, code, payload);
};

export const call = <I, O, const A extends AnswerKind = 'json'>(endpoint: Endpoint<I, O>, ...[args]: ArgsOf<I, A>): Promise<AnswerOf<A, O>> =>
    request(endpoint, args as CallArgs<unknown, AnswerKind>) as Promise<AnswerOf<A, O>>;
