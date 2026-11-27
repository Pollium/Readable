import { ApiError } from '../lib/http/ApiError';
import { fetchQuery, useQuery } from '../lib/query/useQuery';
import { fakeApi } from './support/fake-api';
import { noteRoutes } from './support/notes';
import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const path = { notebookId: 'nb1', noteId: 'n1' };

describe('fetchQuery', () => {
    it('answers what it read, and a query that mounts later reads it without asking', async () => {
        const api = fakeApi();
        api.on('GET', '/notebooks/nb1/notes/n1', { body: { data: { id: 'n1', title: 'a' } } });

        expect(await fetchQuery(noteRoutes.get, { path })).toEqual({ id: 'n1', title: 'a' });
        const { result } = renderHook(() => useQuery(noteRoutes.get, { path }));

        expect(result.current).toMatchObject({ loading: false, data: { id: 'n1', title: 'a' } });
        expect(api.sent).toHaveLength(1);
    });

    it('answers from memory while the answer is fresh, and asks again with staleMs 0', async () => {
        const api = fakeApi();
        api.on('GET', '/me', { body: { data: { id: 'u1' } } });

        await fetchQuery(noteRoutes.me);
        await fetchQuery(noteRoutes.me);
        expect(api.sent).toHaveLength(1);

        await fetchQuery(noteRoutes.me, {}, { staleMs: 0 });
        expect(api.sent).toHaveLength(2);
    });

    it('throws what the api refused', async () => {
        const api = fakeApi();
        api.on('GET', '/notebooks/nb1/notes/n1', { status: 404, body: { error: 'Note::NotFound' } });

        const error = await fetchQuery(noteRoutes.get, { path }).catch((cause: unknown) => cause);

        expect(error).toBeInstanceOf(ApiError);
        expect(error).toMatchObject({ status: 404, code: 'Note::NotFound' });
    });

    it('throws a path param that is missing, before asking', async () => {
        const api = fakeApi();

        await expect(fetchQuery(noteRoutes.get, { path: { notebookId: 'nb1' } })).rejects.toThrow('Call::MissingPathParam');
        expect(api.sent).toHaveLength(0);
    });

    it('answers fresh data it has even when a reload of it failed since', async () => {
        const api = fakeApi();
        api.on('GET', '/me', { body: { data: { id: 'u1' } } });
        const { result } = renderHook(() => useQuery(noteRoutes.me));
        await vi.waitFor(() => expect(result.current.data).toEqual({ id: 'u1' }));

        api.on('GET', '/me', { status: 503, body: { error: 'Server::Unavailable' } });
        result.current.reload();
        await vi.waitFor(() => expect(result.current.error).toBeDefined());

        await expect(fetchQuery(noteRoutes.me)).resolves.toEqual({ id: 'u1' });
        await expect(fetchQuery(noteRoutes.me, {}, { staleMs: 0 })).rejects.toThrow('Server::Unavailable');
    });

    it('retries as it is told', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const api = fakeApi();
        let asked = 0;
        api.on('GET', '/me', () => asked++ === 0 ? { status: 503, body: { error: 'Server::Unavailable' } } : { body: { data: { id: 'u1' } } });

        const answer = fetchQuery(noteRoutes.me, {}, { retry: 1 });
        await vi.advanceTimersByTimeAsync(1_000);

        await expect(answer).resolves.toEqual({ id: 'u1' });
        expect(api.sent).toHaveLength(2);
        vi.useRealTimers();
    });
});
