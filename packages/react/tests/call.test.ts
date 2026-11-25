import { call } from '../lib/http/call';
import { ApiError } from '../lib/http/ApiError';
import { session } from '../lib/session/session';
import { fakeApi } from './support/fake-api';
import { noteRoutes } from './support/notes';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('call', () => {
    afterEach(() => session.end());

    it('sends the body as JSON with the session token and answers the data', async () => {
        const api = fakeApi();
        api.on('POST', '/notebooks/nb%201/notes', { status: 201, body: { data: { id: 'n1', title: 'a' } } });
        session.start('token-a');

        const note = await call(noteRoutes.create, { path: { notebookId: 'nb 1' }, body: { title: 'a' } });

        expect(note).toEqual({ id: 'n1', title: 'a' });
        expect(api.sent[0].headers).toEqual({ 'Content-Type': 'application/json', Authorization: 'Bearer token-a' });
        expect(api.sent[0].body).toEqual({ title: 'a' });
    });

    it('writes the query in a stable order and leaves out empty values', async () => {
        const api = fakeApi();
        api.on('GET', '/notebooks/nb1/notes', { body: { data: [] } });

        await call(noteRoutes.list, { path: { notebookId: 'nb1' }, query: { status: undefined, tag: ['a', 'b'], after: new Date('2026-01-01T00:00:00Z') } });

        expect(api.sent[0].url.search).toBe('?after=2026-01-01T00%3A00%3A00.000Z&tag=a&tag=b');
    });

    it('answers the items and their meta for a page', async () => {
        const api = fakeApi();
        const meta = { total: 3, limit: 1, offset: 0 };
        api.on('GET', '/notebooks', { body: { data: [{ id: 'nb1' }], meta } });

        expect(await call(noteRoutes.notebooks)).toEqual({ items: [{ id: 'nb1' }], meta });
    });

    it('answers nothing for a 204', async () => {
        const api = fakeApi();
        api.on('DELETE', '/notebooks/nb1/notes/n1', { status: 204 });

        expect(await call(noteRoutes.remove, { path: { notebookId: 'nb1', noteId: 'n1' } })).toBeUndefined();
    });

    it('throws the code, the status and the field errors the api answered', async () => {
        const api = fakeApi();
        api.on('PATCH', '/notebooks/nb1/notes/n1', { status: 400, body: { error: 'Request::ValidationFailed:title', errors: { title: 'too long' } } });

        const error = await call(noteRoutes.update, { path: { notebookId: 'nb1', noteId: 'n1' }, body: { title: 'x' } }).catch((cause: unknown) => cause);

        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ status: 400, code: 'Request::ValidationFailed', fields: { title: 'too long' } });
    });

    it('ends the session when the api no longer takes its token', async () => {
        const api = fakeApi();
        api.on('GET', '/me', { status: 401, body: { error: 'Auth::InvalidToken' } });
        session.start('token-a');

        await expect(call(noteRoutes.me)).rejects.toThrow('Auth::InvalidToken');
        expect(session.token).toBeNull();
    });

    it('keeps a session started while a call with the old token was on its way', async () => {
        const api = fakeApi();
        const refused = Promise.withResolvers<void>();
        api.on('GET', '/me', async () => {
            await refused.promise;
            return { status: 401, body: { error: 'Auth::InvalidToken' } };
        });
        session.start('token-a');

        const answer = call(noteRoutes.me).catch(() => undefined);
        await vi.waitFor(() => expect(api.sent).toHaveLength(1));
        session.start('token-b');
        refused.resolve();
        await answer;

        expect(session.token).toBe('token-b');
    });

    it('keeps the session for any other refusal', async () => {
        const api = fakeApi();
        api.on('GET', '/me', { status: 403, body: { error: 'Auth::Forbidden' } });
        session.start('token-a');

        await expect(call(noteRoutes.me)).rejects.toThrow('Auth::Forbidden');
        expect(session.token).toBe('token-a');
    });

    it('throws a network error when the api cannot be reached', async () => {
        fakeApi();
        globalThis.fetch = () => Promise.reject(new TypeError('fetch failed'));

        await expect(call(noteRoutes.me)).rejects.toMatchObject({ status: 0, isNetworkError: true });
    });

    it('refuses a path with a param missing before calling', async () => {
        const api = fakeApi();

        await expect(call(noteRoutes.get, { path: { notebookId: 'nb1' } })).rejects.toThrow('Call::MissingPathParam:noteId@/notebooks/:notebookId/notes/:noteId');
        expect(api.sent).toHaveLength(0);
    });

    it('sends a file as it is, without a JSON content type', async () => {
        const api = fakeApi();
        api.on('POST', '/notebooks/nb1/notes', { status: 201, body: { data: { id: 'n1', title: 'a' } } });
        const form = new FormData();

        await call(noteRoutes.create, { path: { notebookId: 'nb1' }, body: form });

        expect(api.sent[0].headers).toEqual({});
        expect(api.sent[0].body).toBe(form);
    });

    it('asks for a body only when the endpoint takes one', () => {
        const typed = () => {
            // @ts-expect-error the endpoint takes a note
            void call(noteRoutes.create, { path: { notebookId: 'nb1' } });
            // @ts-expect-error a note has no name
            void call(noteRoutes.create, { path: { notebookId: 'nb1' }, body: { name: 'a' } });
            void call(noteRoutes.archive, { path: { notebookId: 'nb1', noteId: 'n1' } });
            void call(noteRoutes.me);
        };

        expect(typed).toBeTypeOf('function');
    });
});
