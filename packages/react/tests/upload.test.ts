import { configure } from '../lib/app/config';
import { upload, UploadProgress } from '../lib/http/upload';
import { session } from '../lib/session/session';
import { fakeXhr } from './support/fake-xhr';
import { afterEach, describe, expect, it, vi } from 'vitest';

const file = new Blob(['hello'], { type: 'text/plain' });

describe('upload', () => {
    afterEach(() => session.end());

    it('puts a file to a presigned url as it is, without the session or the request hook', async () => {
        const sent = fakeXhr();
        const onRequest = vi.fn();
        configure({ name: 'notes', apiUrl: 'http://api.test', credentials: 'include', onRequest });
        session.start('token-a');

        const answer = upload('https://store.test/bucket/key?signature=s', file);
        await vi.waitFor(() => expect(sent).toHaveLength(1));
        sent[0].answer(200);

        expect(await answer).toBeUndefined();
        expect(sent[0]).toMatchObject({ method: 'PUT', url: 'https://store.test/bucket/key?signature=s', headers: {}, body: file, withCredentials: false });
        expect(onRequest).not.toHaveBeenCalled();
    });

    it('tells how much of the body has gone out', async () => {
        const sent = fakeXhr();
        const progress: UploadProgress[] = [];

        const answer = upload('https://store.test/key', file, { onProgress: (step) => progress.push(step) });
        await vi.waitFor(() => expect(sent).toHaveLength(1));
        sent[0].progress(2, 5);
        sent[0].progress(4, 0, false);
        sent[0].answer(204);
        await answer;

        expect(progress).toEqual([{ loaded: 2, total: 5 }, { loaded: 4, total: 5 }]);
    });

    it('sends a path on the api with the session, the request hook and the credentials, and unwraps the answer', async () => {
        const sent = fakeXhr();
        configure({
            name: 'notes',
            apiUrl: 'http://api.test',
            credentials: 'include',
            onRequest: (init) => {
                init.headers['x-trace-id'] = 'trace-1';
            }
        });
        session.start('token-a');
        const form = new FormData();

        const answer = upload<{ id: string }>('/notebooks/nb1/attachments', form, { method: 'POST', headers: { 'Content-Type': 'multipart/form-data' } });
        await vi.waitFor(() => expect(sent).toHaveLength(1));
        sent[0].answer(201, { data: { id: 'a1' } });

        expect(await answer).toEqual({ id: 'a1' });
        expect(sent[0]).toMatchObject({
            method: 'POST',
            url: 'http://api.test/notebooks/nb1/attachments',
            headers: { Authorization: 'Bearer token-a', 'x-trace-id': 'trace-1' },
            withCredentials: true
        });
    });

    it('takes a full url under the api as one on the api', async () => {
        const sent = fakeXhr();
        session.start('token-a');

        const answer = upload('http://api.test/files', file, { headers: { 'Content-Type': 'text/csv' } });
        await vi.waitFor(() => expect(sent).toHaveLength(1));
        sent[0].answer(200, { data: 'ok' });

        expect(await answer).toBe('ok');
        expect(sent[0].headers).toEqual({ 'Content-Type': 'text/csv', Authorization: 'Bearer token-a' });
    });

    it('throws the code the api refused with, and ends the session on a 401 from it', async () => {
        const sent = fakeXhr();
        session.start('token-a');

        const answer = upload('/files', file).catch((cause: unknown) => cause);
        await vi.waitFor(() => expect(sent).toHaveLength(1));
        sent[0].answer(401, { error: 'Auth::InvalidToken' });

        expect(await answer).toMatchObject({ status: 401, code: 'Auth::InvalidToken' });
        expect(session.token).toBeNull();
    });

    it('throws the status of a store that refuses, and keeps the session', async () => {
        const sent = fakeXhr();
        session.start('token-a');

        const answer = upload('https://store.test/key', file).catch((cause: unknown) => cause);
        await vi.waitFor(() => expect(sent).toHaveLength(1));
        sent[0].answer(403, '<Error>SignatureDoesNotMatch</Error>', 'Forbidden');

        expect(await answer).toMatchObject({ status: 403, message: 'Forbidden' });
        expect(session.token).toBe('token-a');
    });

    it('throws a network error when the upload cannot get through', async () => {
        const sent = fakeXhr();

        const answer = upload('https://store.test/key', file).catch((cause: unknown) => cause);
        await vi.waitFor(() => expect(sent).toHaveLength(1));
        sent[0].fail();

        expect(await answer).toMatchObject({ status: 0, message: 'Network::Unreachable', isNetworkError: true });
    });

    it('stops when its signal aborts, and never starts with one aborted already', async () => {
        const sent = fakeXhr();
        const controller = new AbortController();

        const answer = upload('https://store.test/key', file, { signal: controller.signal });
        await vi.waitFor(() => expect(sent).toHaveLength(1));
        controller.abort(new Error('cancelled'));

        await expect(answer).rejects.toThrow('cancelled');
        await expect(upload('https://store.test/key', file, { signal: controller.signal })).rejects.toThrow('cancelled');
        expect(sent).toHaveLength(1);
    });
});
