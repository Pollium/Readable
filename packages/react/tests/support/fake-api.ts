import { vi } from 'vitest';

export interface Sent{
    method: string;
    url: URL;
    headers: Record<string, string>;
    body: unknown;
    init: RequestInit;
}

export interface Answer{
    status?: number;
    body?: unknown;
    raw?: BodyInit;
    headers?: Record<string, string>;
}

type Handler = (sent: Sent) => Answer | Promise<Answer>;

const parsed = (text: string): unknown => {
    try{
        return JSON.parse(text);
    }catch{
        return text;
    }
};

const bodyOf = (body: RequestInit['body']): unknown => typeof body === 'string' ? parsed(body) : body;

// As fetch does, an aborted signal rejects the call with its reason.
const abortable = (signal: AbortSignal | null | undefined, answer: () => Promise<Answer>): Promise<Answer> => {
    if(!signal) return answer();
    if(signal.aborted) return Promise.reject(signal.reason);

    return new Promise((resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
        answer().then(resolve, reject);
    });
};

export const fakeApi = () => {
    const routes = new Map<string, Handler>();
    const sent: Sent[] = [];

    vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
        const request: Sent = {
            method: init.method ?? 'GET',
            url: new URL(input),
            headers: { ...init.headers as Record<string, string> },
            body: bodyOf(init.body),
            init
        };
        sent.push(request);

        const handler = routes.get(`${request.method} ${request.url.pathname}`);
        const { status = 200, body, raw, headers } = await abortable(init.signal, async () => handler ? handler(request) : { status: 404, body: { error: 'Route::NotFound' } });
        if(status === 204) return new Response(null, { status });
        if(raw !== undefined) return new Response(raw, { status, headers });
        return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
    }));

    return {
        sent,
        on(method: string, path: string, answer: Answer | Handler){
            routes.set(`${method} ${path}`, typeof answer === 'function' ? answer : () => answer);
        },
        calls(method: string, path: string): Sent[]{
            return sent.filter((request) => request.method === method && request.url.pathname === path);
        }
    };
};
