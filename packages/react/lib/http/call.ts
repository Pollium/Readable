import { OutgoingRequest, settings } from '../app/config';
import { session } from '../session/session';
import { ApiError } from './ApiError';
import { Deadline, deadlineOf } from './deadline';
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

export type RawBody = Blob | ArrayBuffer | ArrayBufferView | URLSearchParams;

type SentBody<I> = [I] extends [never]
    ? { body?: FormData | RawBody }
    : undefined extends I ? { body?: I | FormData | RawBody } : { body: I | FormData | RawBody };

// A body the caller encoded itself, such as a document too large for the api to take as JSON.
interface EncodedBody{
    body: string;
    contentType: string;
}

export type CallArgs<I, A extends AnswerKind = 'json'> = Target & (SentBody<I> | EncodedBody) & {
    contentType?: string;
    signal?: AbortSignal;
    keepalive?: boolean;
    timeoutMs?: number;
    credentials?: RequestCredentials;
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

type Encoding = 'none' | 'form' | 'raw' | 'json';

const isRaw = (body: unknown): boolean => body instanceof Blob || body instanceof ArrayBuffer
    || ArrayBuffer.isView(body) || body instanceof URLSearchParams;

const encodingOf = (body: unknown, contentType: string | undefined): Encoding => {
    if(body === undefined) return 'none';
    if(body instanceof FormData) return 'form';
    if(isRaw(body) || (typeof body === 'string' && contentType !== undefined)) return 'raw';
    return 'json';
};

const isContentType = (name: string): boolean => name.toLowerCase() === 'content-type';

// FormData never takes a Content-Type: fetch writes it with the boundary of the parts.
export const headersOf = (
    encoding: Encoding,
    contentType: string | undefined,
    token: string | null,
    headers: Readonly<Record<string, string>> = {}
): Record<string, string> => {
    const given = Object.entries(headers).find(([name]) => isContentType(name))?.[1];
    const type = encoding === 'form' ? undefined : given ?? contentType ?? (encoding === 'json' ? 'application/json' : undefined);

    return {
        ...(type === undefined ? {} : { 'Content-Type': type }),
        ...(token === null ? {} : { Authorization: `Bearer ${token}` }),
        ...Object.fromEntries(Object.entries(headers).filter(([name]) => !isContentType(name)))
    };
};

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
        default: return unwrap(parsed(await response.text()));
    }
};

const failure = (cause: unknown, deadline: Deadline, signal: AbortSignal | undefined): unknown => {
    if(deadline.expired()) return new ApiError(0, 'Network::Timeout', undefined, { cause });
    if(signal?.aborted) return cause;
    return new ApiError(0, 'Network::Unreachable', undefined, { cause });
};

// The deadline covers the answer's body too, except for a Response handed back unread.
const answered = async (url: string, init: RequestInit, as: AnswerKind, deadline: Deadline, signal?: AbortSignal) => {
    try{
        const response = await fetch(url, init);
        return { response, answer: response.ok ? await answerOf(response, as) : undefined };
    }catch(cause: unknown){
        throw failure(cause, deadline, signal);
    }finally{
        deadline.clear();
    }
};

export const request = async (endpoint: Pick<Endpoint, 'method' | 'path'>, args: CallArgs<unknown, AnswerKind> = {}): Promise<unknown> => {
    const { base, path, query, headers, body, contentType, signal, keepalive, timeoutMs, credentials, as = 'json' } = args;
    const config = settings();
    const token = session.token;
    const encoding = encodingOf(body, contentType);
    const url = urlOf(endpoint, { base, path, query });
    const init: OutgoingRequest = {
        method: endpoint.method,
        headers: headersOf(encoding, contentType, token, headers),
        body: encoding === 'json' ? JSON.stringify(body) : body as BodyInit | undefined,
        credentials: credentials ?? config.credentials,
        signal,
        keepalive
    };
    if(config.onRequest !== null) await config.onRequest(init, url);

    const deadline = deadlineOf(init.signal ?? undefined, timeoutMs ?? config.timeoutMs);
    const { response, answer } = await answered(url, { ...init, signal: deadline.signal }, as, deadline, init.signal ?? undefined);
    if(response.ok) return answer;

    const payload = await payloadOf(response);
    const code = (payload as ErrorBody | undefined)?.error ?? response.statusText;
    if(response.status === 401 && token !== null && ENDS_SESSION.includes(baseCodeOf(code))) session.end(token);
    throw new ApiError(response.status, code, payload);
};

export const call = <I, O, const A extends AnswerKind = 'json'>(endpoint: Endpoint<I, O>, ...[args]: ArgsOf<I, A>): Promise<AnswerOf<A, O>> =>
    request(endpoint, args as CallArgs<unknown, AnswerKind>) as Promise<AnswerOf<A, O>>;
