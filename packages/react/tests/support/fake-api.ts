import { vi } from 'vitest';

export interface Sent{
    method: string;
    url: URL;
    headers: Record<string, string>;
    body: unknown;
}

export interface Answer{
    status?: number;
    body?: unknown;
    raw?: BodyInit;
    headers?: Record<string, string>;
}

type Handler = (sent: Sent) => Answer | Promise<Answer>;

const bodyOf = (body: RequestInit['body']): unknown => typeof body === 'string' ? JSON.parse(body) : body;

export const fakeApi = () => {
    const routes = new Map<string, Handler>();
    const sent: Sent[] = [];

    vi.stubGlobal('fetch', vi.fn(async (input: string, init: RequestInit = {}) => {
        const request: Sent = {
            method: init.method ?? 'GET',
            url: new URL(input),
            headers: { ...init.headers as Record<string, string> },
            body: bodyOf(init.body)
        };
        sent.push(request);

        const handler = routes.get(`${request.method} ${request.url.pathname}`);
        const { status = 200, body, raw, headers } = handler ? await handler(request) : { status: 404, body: { error: 'Route::NotFound' } } as Answer;
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
