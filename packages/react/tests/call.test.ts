import { call } from '../lib/http/call';
import { ApiError } from '../lib/http/ApiError';
import { session } from '../lib/session/session';
import { fakeApi } from './support/fake-api';
import { noteRoutes } from './support/notes';
import { afterEach, describe, expect, it, vi } from 'vitest';

const note = { id: 'n1', title: 'a' };

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

    it('sends the headers a call adds, beside the session token', async () => {
        const api = fakeApi();
        api.on('GET', '/me', { body: { data: { id: 'u1' } } });
        session.start('token-a');

        await call(noteRoutes.me, { headers: { 'X-Share-Token': 'share-1' } });

        expect(api.sent[0].headers).toEqual({ Authorization: 'Bearer token-a', 'X-Share-Token': 'share-1' });
    });

    it('calls another api at the base it is given, with the same session', async () => {
        const api = fakeApi();
        api.on('GET', '/me', { body: { data: { id: 'iam-user' } } });
        session.start('token-a');

        expect(await call(noteRoutes.me, { base: 'http://iam.test/' })).toEqual({ id: 'iam-user' });
        expect(api.sent[0].url.origin).toBe('http://iam.test');
        expect(api.sent[0].headers.Authorization).toBe('Bearer token-a');
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

    it('answers nothing for a 204, and reads its body so the browser does not count it as aborted', async () => {
        const answer = new Response(null, { status: 204 });
        const read = vi.spyOn(answer, 'text');
        vi.stubGlobal('fetch', async () => answer);

        expect(await call(noteRoutes.remove, { path: { notebookId: 'nb1', noteId: 'n1' } })).toBeUndefined();
        expect(read).toHaveBeenCalledOnce();
    });

    it('throws the status of an error that is not JSON', async () => {
        vi.stubGlobal('fetch', async () => new Response('<html>Bad Gateway</html>', { status: 502, statusText: 'Bad Gateway' }));

        await expect(call(noteRoutes.me)).rejects.toMatchObject({ status: 502, message: 'Bad Gateway' });
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

    it('asks for a body only when the endpoint takes one, and takes a file for any', () => {
        const typed = () => {
            // @ts-expect-error the endpoint takes a note
            void call(noteRoutes.create, { path: { notebookId: 'nb1' } });
            // @ts-expect-error a note has no name
            void call(noteRoutes.create, { path: { notebookId: 'nb1' }, body: { name: 'a' } });
            void call(noteRoutes.archive, { path: { notebookId: 'nb1', noteId: 'n1' } });
            void call(noteRoutes.me);
            void call(noteRoutes.remove, { path: { notebookId: 'nb1', noteId: 'n1' }, body: new FormData() });
            // @ts-expect-error an endpoint with no input takes no JSON body
            void call(noteRoutes.remove, { path: { notebookId: 'nb1', noteId: 'n1' }, body: { title: 'a' } });
        };

        expect(typed).toBeTypeOf('function');
    });

    it('answers the text of a call read as text, without unwrapping it', async () => {
        const api = fakeApi();
        api.on('GET', '/notebooks/nb1/export', { raw: '{"data":"kept"}', headers: { 'Content-Type': 'text/plain' } });

        expect(await call(noteRoutes.download, { path: { notebookId: 'nb1' }, as: 'text' })).toBe('{"data":"kept"}');
    });

    it('answers a blob and the bytes of a call read as them', async () => {
        const api = fakeApi();
        api.on('GET', '/notebooks/nb1/export', { raw: new Uint8Array([1, 2, 3]), headers: { 'Content-Type': 'application/octet-stream' } });
        const path = { notebookId: 'nb1' };

        const blob = await call(noteRoutes.download, { path, as: 'blob' });
        const bytes = await call(noteRoutes.download, { path, as: 'arrayBuffer' });

        expect(blob).toBeInstanceOf(Blob);
        expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([1, 2, 3]);
        expect([...new Uint8Array(bytes)]).toEqual([1, 2, 3]);
    });

    it('answers the response itself, so its headers can be read', async () => {
        const api = fakeApi();
        api.on('GET', '/notebooks/nb1/export', { raw: 'a,b', headers: { 'Content-Disposition': 'attachment; filename="notes.csv"' } });

        const response = await call(noteRoutes.download, { path: { notebookId: 'nb1' }, as: 'response' });

        expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="notes.csv"');
        expect(await response.text()).toBe('a,b');
    });

    it('throws the code the api answered for a call read as anything but JSON', async () => {
        const api = fakeApi();
        api.on('GET', '/notebooks/nb1/export', { status: 404, body: { error: 'Note::NotFound' } });

        await expect(call(noteRoutes.download, { path: { notebookId: 'nb1' }, as: 'blob' })).rejects.toMatchObject({ status: 404, code: 'Note::NotFound' });
        await expect(call(noteRoutes.download, { path: { notebookId: 'nb1' }, as: 'response' })).rejects.toBeInstanceOf(ApiError);
    });

    it('types the answer by how the call reads it', () => {
        const typed = async () => {
            const blob: Blob = await call(noteRoutes.download, { path: { notebookId: 'nb1' }, as: 'blob' });
            const text: string = await call(noteRoutes.me, { as: 'text' });
            const me: { id: string } = await call(noteRoutes.me);
            // @ts-expect-error a call read as bytes does not answer the endpoint's output
            const wrong: { id: string } = await call(noteRoutes.me, { as: 'arrayBuffer' });
            return [blob, text, me, wrong];
        };

        expect(typed).toBeTypeOf('function');
    });

    it('sends a blob, bytes or form fields as they are', async () => {
        const api = fakeApi();
        api.on('POST', '/notebooks/nb1/notes', { status: 201, body: { data: note } });
        const path = { notebookId: 'nb1' };
        const blob = new Blob(['a'], { type: 'text/csv' });
        const bytes = new Uint8Array([1, 2]);
        const fields = new URLSearchParams({ title: 'a' });

        await call(noteRoutes.create, { path, body: blob });
        await call(noteRoutes.create, { path, body: bytes, contentType: 'application/octet-stream' });
        await call(noteRoutes.create, { path, body: bytes.buffer });
        await call(noteRoutes.create, { path, body: fields });

        expect(api.sent.map((sent) => sent.init.body)).toEqual([blob, bytes, bytes.buffer, fields]);
        expect(api.sent.map((sent) => sent.headers['Content-Type'])).toEqual([undefined, 'application/octet-stream', undefined, undefined]);
    });

    it('sends a string it is given a content type for as it is, and any other as JSON', async () => {
        const api = fakeApi();
        api.on('POST', '/notebooks/nb1/notes', { status: 201, body: { data: note } });
        const path = { notebookId: 'nb1' };

        await call(noteRoutes.create, { path, body: '{"title":"a"}', contentType: 'application/x-ipynb+json' });
        await call(noteRoutes.create, { path, body: { title: 'a' }, contentType: 'application/merge-patch+json' });

        expect(api.sent[0].init.body).toBe('{"title":"a"}');
        expect(api.sent[0].headers['Content-Type']).toBe('application/x-ipynb+json');
        expect(api.sent[1].init.body).toBe('{"title":"a"}');
        expect(api.sent[1].headers['Content-Type']).toBe('application/merge-patch+json');
    });

    it('never sends the Content-Type a caller gives with a form, so fetch writes its boundary', async () => {
        const api = fakeApi();
        api.on('POST', '/notebooks/nb1/notes', { status: 201, body: { data: note } });

        await call(noteRoutes.create, { path: { notebookId: 'nb1' }, body: new FormData(), headers: { 'content-type': 'multipart/form-data', 'X-Upload': 'yes' } });

        expect(api.sent[0].headers).toEqual({ 'X-Upload': 'yes' });
    });

    it('sends one Content-Type, the caller\'s, whatever case it is written in', async () => {
        const api = fakeApi();
        api.on('POST', '/notebooks/nb1/notes', { status: 201, body: { data: note } });

        await call(noteRoutes.create, { path: { notebookId: 'nb1' }, body: { title: 'a' }, headers: { 'content-type': 'application/vnd.notes+json' } });

        expect(api.sent[0].headers).toEqual({ 'Content-Type': 'application/vnd.notes+json' });
    });

    it('takes a string body only with its content type', () => {
        const typed = () => {
            // @ts-expect-error a string is sent as it is only when its content type is given
            void call(noteRoutes.create, { path: { notebookId: 'nb1' }, body: '{"title":"a"}' });
            void call(noteRoutes.create, { path: { notebookId: 'nb1' }, body: '{"title":"a"}', contentType: 'application/json' });
            void call(noteRoutes.remove, { path: { notebookId: 'nb1', noteId: 'n1' }, body: new Blob([]) });
        };

        expect(typed).toBeTypeOf('function');
    });
});
