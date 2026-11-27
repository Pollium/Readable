import { prefetch, Upstream, useQuery } from '../lib/query/useQuery';
import { fakeApi } from './support/fake-api';
import { noteRoutes } from './support/notes';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const me = { id: 'u1' };

const flush = (ms = 0) => act(() => vi.advanceTimersByTimeAsync(ms));

const answering = (...statuses: number[]) => {
    const api = fakeApi();
    let asked = 0;
    api.on('GET', '/me', () => {
        const status = statuses[Math.min(asked++, statuses.length - 1)];
        return status === 200 ? { body: { data: me } } : { status, body: { error: status === 404 ? 'Note::NotFound' : 'Server::Unavailable' } };
    });
    return api;
};

let hidden = false;

describe('query options', () => {
    afterEach(() => {
        vi.useRealTimers();
        hidden = false;
    });

    it('answers from memory for as long as staleMs says', async () => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
        const api = answering(200);
        const mountMe = () => renderHook(() => useQuery(noteRoutes.me, {}, { staleMs: 60_000 }));

        mountMe().unmount();
        await flush();
        vi.setSystemTime(Date.now() + 30_001);
        mountMe().unmount();
        await flush();
        expect(api.sent).toHaveLength(1);

        vi.setSystemTime(Date.now() + 30_000);
        mountMe();
        await flush();
        expect(api.sent).toHaveLength(2);
    });

    it('never asks again on mount for an answer fresh for ever', async () => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
        const api = answering(200);

        renderHook(() => useQuery(noteRoutes.me, {}, { staleMs: Infinity, keepMs: Infinity })).unmount();
        await flush();
        vi.setSystemTime(Date.now() + 86_400_000);
        const later = renderHook(() => useQuery(noteRoutes.me, {}, { staleMs: Infinity, keepMs: Infinity }));
        await flush();

        expect(later.result.current).toMatchObject({ loading: false, data: me });
        expect(api.sent).toHaveLength(1);
    });

    it('forgets an answer nobody reads once keepMs has passed', async () => {
        vi.useFakeTimers({ toFake: ['Date', 'setTimeout', 'clearTimeout'] });
        answering(200);
        const mountMe = () => renderHook(() => useQuery(noteRoutes.me, {}, { keepMs: 1_000, staleMs: Infinity }));

        mountMe().unmount();
        await flush();
        vi.setSystemTime(Date.now() + 999);
        const soon = mountMe();
        expect(soon.result.current.data).toEqual(me);
        soon.unmount();

        vi.setSystemTime(Date.now() + 1_000);
        expect(mountMe().result.current).toMatchObject({ loading: true, data: null });
    });

    it('forgets an answer as soon as nobody reads it with keepMs 0', async () => {
        const api = answering(200);
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });

        const first = renderHook(() => useQuery(noteRoutes.me, {}, { keepMs: 0 }));
        await flush();
        expect(first.result.current.data).toEqual(me);
        first.unmount();

        const again = renderHook(() => useQuery(noteRoutes.me, {}, { keepMs: 0 }));
        expect(again.result.current).toMatchObject({ loading: true, data: null });
        await flush();
        expect(api.sent).toHaveLength(2);
    });

    it('keeps a prefetched answer for a query that keeps nothing, until the query has read it', async () => {
        const api = answering(200);
        await prefetch(noteRoutes.me);

        const { result } = renderHook(() => useQuery(noteRoutes.me, {}, { keepMs: 0 }), { reactStrictMode: true });

        expect(result.current).toMatchObject({ loading: false, data: me });
        expect(api.sent).toHaveLength(1);
    });

    it('asks again every pollMs while it is on screen', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const api = answering(200);

        const { unmount } = renderHook(() => useQuery(noteRoutes.me, {}, { pollMs: 1_000 }));
        await flush();
        await flush(1_000);
        await flush(1_000);
        expect(api.sent).toHaveLength(3);

        unmount();
        await flush(5_000);
        expect(api.sent).toHaveLength(3);
    });

    it('polls for as long as the answer asks for it', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const api = fakeApi();
        const statuses = ['waiting', 'waiting', 'ready'];
        api.on('GET', '/cluster', () => ({ body: { data: { status: statuses.shift() ?? 'ready' } } }));

        const { result } = renderHook(() => useQuery(noteRoutes.cluster, {}, {
            pollMs: (cluster) => cluster?.status === 'waiting' ? 5_000 : false
        }));
        await flush();
        await flush(5_000);
        await flush(5_000);
        await flush(20_000);

        expect(result.current.data).toEqual({ status: 'ready' });
        expect(api.sent).toHaveLength(3);
    });

    it('waits while the tab is hidden, and asks as soon as it is shown', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        vi.spyOn(document, 'hidden', 'get').mockImplementation(() => hidden);
        const api = answering(200);
        renderHook(() => useQuery(noteRoutes.me, {}, { pollMs: 1_000 }));
        await flush();

        hidden = true;
        await flush(10_000);
        expect(api.sent).toHaveLength(1);

        hidden = false;
        act(() => {
            document.dispatchEvent(new Event('visibilitychange'));
        });
        await flush();
        expect(api.sent).toHaveLength(2);
    });

    it('retries an answer the api failed to give, waiting longer each time', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const api = answering(503, 503, 200);

        const { result } = renderHook(() => useQuery(noteRoutes.me, {}, { retry: 2 }));
        await flush();
        expect(result.current).toMatchObject({ loading: true, fetching: true, error: undefined });

        await flush(999);
        expect(api.sent).toHaveLength(1);
        await flush(1);
        expect(api.sent).toHaveLength(2);
        await flush(2_000);

        expect(api.sent).toHaveLength(3);
        expect(result.current).toMatchObject({ loading: false, fetching: false, data: me });
    });

    it('stops retrying after the count, and tells the last error', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const api = answering(503);

        const { result } = renderHook(() => useQuery(noteRoutes.me, {}, { retry: 1 }));
        await flush(10_000);

        expect(api.sent).toHaveLength(2);
        expect(result.current).toMatchObject({ loading: false, data: null, error: expect.objectContaining({ status: 503 }) });
    });

    it('never retries a refusal on a count', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const api = answering(404);

        const { result } = renderHook(() => useQuery(noteRoutes.me, {}, { retry: 3 }));
        await flush(60_000);

        expect(api.sent).toHaveLength(1);
        expect(result.current.error?.message).toBe('Note::NotFound');
    });

    it('asks a retry function with the error and the attempt', async () => {
        vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
        const api = answering(404);
        const asked: [string, number][] = [];

        renderHook(() => useQuery(noteRoutes.me, {}, {
            retry: (error, attempt) => {
                asked.push([error.message, attempt]);
                return attempt < 2;
            }
        }));
        await flush(60_000);

        expect(asked).toEqual([['Note::NotFound', 1], ['Note::NotFound', 2]]);
        expect(api.sent).toHaveLength(2);
    });

    it('tells a request on its way apart from waiting for one', async () => {
        const api = answering(200);
        const team: Upstream = { data: null, loading: true, error: undefined, reload: vi.fn() };

        const waiting = renderHook(() => useQuery(noteRoutes.me, {}, { dependsOn: team }));
        expect(waiting.result.current).toMatchObject({ loading: true, fetching: false });
        expect(api.sent).toHaveLength(0);

        const asking = renderHook(() => useQuery(noteRoutes.me));
        await vi.waitFor(() => expect(asking.result.current.data).toEqual(me));
        act(() => asking.result.current.reload());
        expect(asking.result.current).toMatchObject({ loading: true, fetching: true, data: me });
    });
});
