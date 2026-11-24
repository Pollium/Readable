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
        const { status = 200, body } = handler ? await handler(request) : { status: 404, body: { error: 'Route::NotFound' } };
        return status === 204
            ? new Response(null, { status })
            : new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
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
