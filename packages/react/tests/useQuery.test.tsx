import { session, useSession } from '../lib/session/session';
import { prefetch, Upstream, useQuery } from '../lib/query/useQuery';
import { fakeApi } from './support/fake-api';
import { Note, noteRoutes } from './support/notes';
import { act, render, renderHook, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const note = (id: string, title = id): Note => ({ id, title });

describe('useQuery', () => {
    it('loads the answer of its endpoint', async () => {
        const api = fakeApi();
        api.on('GET', '/notebooks/nb1/notes', { body: { data: [note('n1')] } });

        const { result } = renderHook(() => useQuery(noteRoutes.list, { path: { notebookId: 'nb1' } }));

        expect(result.current).toMatchObject({ loading: true, data: null });
        await waitFor(() => expect(result.current).toMatchObject({ loading: false, data: [note('n1')] }));
    });

    it('reads an empty answer as no data, once it has landed', async () => {
        const api = fakeApi();
        api.on('GET', '/me', { status: 204 });

        const { result } = renderHook(() => useQuery(noteRoutes.me));

        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current.data).toBeNull();
    });

    it('answers from what a route prefetched, without asking again', async () => {
        const api = fakeApi();
        api.on('GET', '/notebooks/nb1/notes/n1', { body: { data: note('n1') } });

        await prefetch(noteRoutes.get, { path: { notebookId: 'nb1', noteId: 'n1' } });
        const { result } = renderHook(() => useQuery(noteRoutes.get, { path: { notebookId: 'nb1', noteId: 'n1' } }));

        expect(result.current).toMatchObject({ loading: false, data: note('n1') });
        expect(api.calls('GET', '/notebooks/nb1/notes/n1')).toHaveLength(1);
    });

    it('shares a prefetch still on its way with the query that mounts', async () => {
        const api = fakeApi();
        api.on('GET', '/me', { body: { data: { id: 'u1' } } });

        const pending = prefetch(noteRoutes.me);
        const { result } = renderHook(() => useQuery(noteRoutes.me));
        await pending;

        await waitFor(() => expect(result.current.data).toEqual({ id: 'u1' }));
        expect(api.calls('GET', '/me')).toHaveLength(1);
    });

    it('prefetches nothing while a path param is missing', async () => {
        const api = fakeApi();

        await prefetch(noteRoutes.get, { path: { notebookId: 'nb1' } });

        expect(api.sent).toHaveLength(0);
    });

    it('waits while a path param is missing, then loads', async () => {
        const api = fakeApi();
        api.on('GET', '/notebooks/nb1/notes/n1', { body: { data: note('n1') } });

        const { result, rerender } = renderHook(
            ({ noteId }: { noteId?: string }) => useQuery(noteRoutes.get, { path: { notebookId: 'nb1', noteId } }),
            { initialProps: {} }
        );

        expect(result.current).toMatchObject({ loading: false, data: null });
        expect(api.sent).toHaveLength(0);

        rerender({ noteId: 'n1' });
        await waitFor(() => expect(result.current.data).toEqual(note('n1')));
    });

    it('waits for a target that is not there yet, or while it is disabled', () => {
        const api = fakeApi();
        const noteId: string | undefined = undefined;

        renderHook(() => useQuery(noteRoutes.get, noteId && { path: { notebookId: 'nb1', noteId } }));
        renderHook(() => useQuery(noteRoutes.me, {}, { enabled: false }));

        expect(api.sent).toHaveLength(0);
    });

    it('asks the api once for every component reading the same query', async () => {
        const api = fakeApi();
        api.on('GET', '/me', { body: { data: { id: 'u1' } } });

        const first = renderHook(() => useQuery(noteRoutes.me));
        const second = renderHook(() => useQuery(noteRoutes.me));

        await waitFor(() => expect(second.result.current.data).toEqual({ id: 'u1' }));
        expect(first.result.current.data).toEqual({ id: 'u1' });
        expect(api.calls('GET', '/me')).toHaveLength(1);
    });

    it('keeps the answers of different headers apart', async () => {
        const api = fakeApi();
        api.on('GET', '/notebooks/nb1/notes', ({ headers }) => ({ body: { data: [note(headers['X-Share-Token'] ?? 'own')] } }));
        const path = { notebookId: 'nb1' };

        const shared = renderHook(() => useQuery(noteRoutes.list, { path, headers: { 'X-Share-Token': 'share-1' } }));
        const own = renderHook(() => useQuery(noteRoutes.list, { path }));

        await waitFor(() => expect(shared.result.current.data).toEqual([note('share-1')]));
        await waitFor(() => expect(own.result.current.data).toEqual([note('own')]));
    });

    it('keeps the answers of two apis apart, even at the same path', async () => {
        const api = fakeApi();
        api.on('GET', '/me', ({ url }) => ({ body: { data: { id: url.host } } }));

        const own = renderHook(() => useQuery(noteRoutes.me));
        const iam = renderHook(() => useQuery(noteRoutes.me, { base: 'http://iam.test' }));

        await waitFor(() => expect(own.result.current.data).toEqual({ id: 'api.test' }));
        await waitFor(() => expect(iam.result.current.data).toEqual({ id: 'iam.test' }));
    });

    it('waits for any query it depends on, one with no set too', async () => {
        const api = fakeApi();
        api.on('GET', '/notebooks', { body: { data: [] } });
        const team: Upstream = { data: null, loading: true, error: undefined, reload: vi.fn() };

        const { result, rerender } = renderHook(({ upstream }) => useQuery(noteRoutes.notebooks, {}, { dependsOn: upstream }), { initialProps: { upstream: team } });
        expect(api.sent).toHaveLength(0);

        rerender({ upstream: { ...team, data: { id: 't1' }, loading: false } });
        await waitFor(() => expect(result.current.data).toEqual([]));
    });

    it('answers from memory for 30 seconds, then asks again', async () => {
        vi.useFakeTimers({ toFake: ['Date'] });
        const api = fakeApi();
        api.on('GET', '/me', { body: { data: { id: 'u1' } } });

        const first = renderHook(() => useQuery(noteRoutes.me));
        await waitFor(() => expect(first.result.current.data).toEqual({ id: 'u1' }));
        first.unmount();

        const again = renderHook(() => useQuery(noteRoutes.me));
        expect(again.result.current).toMatchObject({ loading: false, data: { id: 'u1' } });
        again.unmount();

        vi.advanceTimersByTime(30_001);
        const later = renderHook(() => useQuery(noteRoutes.me));
        expect(later.result.current).toMatchObject({ loading: true, data: { id: 'u1' } });
        await waitFor(() => expect(later.result.current.loading).toBe(false));
        expect(api.calls('GET', '/me')).toHaveLength(2);
        vi.useRealTimers();
    });

    it('asks again on every mount when it must be fresh', async () => {
        const api = fakeApi();
        api.on('GET', '/me', { body: { data: { id: 'u1' } } });

        const first = renderHook(() => useQuery(noteRoutes.me, {}, { fresh: true }));
        await waitFor(() => expect(first.result.current.data).toEqual({ id: 'u1' }));
        first.unmount();
        const again = renderHook(() => useQuery(noteRoutes.me, {}, { fresh: true }));

        expect(again.result.current).toMatchObject({ loading: true, data: { id: 'u1' } });
        await waitFor(() => expect(api.calls('GET', '/me')).toHaveLength(2));
    });

    it('keeps the same reload and set across renders, so an effect can depend on them', async () => {
        const api = fakeApi();
        api.on('GET', '/me', { body: { data: { id: 'u1' } } });
        const { result, rerender } = renderHook(() => useQuery(noteRoutes.me));
        const { reload, set } = result.current;

        rerender();
        await waitFor(() => expect(result.current.data).toEqual({ id: 'u1' }));

        expect(result.current.reload).toBe(reload);
        expect(result.current.set).toBe(set);
    });

    it('keeps its data and tells the error when a reload fails', async () => {
        const api = fakeApi();
        api.on('GET', '/me', { body: { data: { id: 'u1' } } });
        const { result } = renderHook(() => useQuery(noteRoutes.me));
        await waitFor(() => expect(result.current.data).toEqual({ id: 'u1' }));

        api.on('GET', '/me', { status: 503, body: { error: 'Server::Internal' } });
        act(() => result.current.reload());

        await waitFor(() => expect(result.current.error?.message).toBe('Server::Internal'));
        expect(result.current).toMatchObject({ loading: false, data: { id: 'u1' } });
    });

    it('takes the answer of the last reload, whatever answers first', async () => {
        const api = fakeApi();
        const answers = [
            Promise.withResolvers<void>(),
            Promise.withResolvers<void>()
        ];
        let asked = 0;
        api.on('GET', '/me', async () => {
            const turn = asked++;
            await answers[turn].promise;
            return { body: { data: { id: `u${turn}` } } };
        });
        const { result } = renderHook(() => useQuery(noteRoutes.me));
        await waitFor(() => expect(asked).toBe(1));

        act(() => result.current.reload());
        await waitFor(() => expect(asked).toBe(2));
        answers[1].resolve();
        await waitFor(() => expect(result.current.data).toEqual({ id: 'u1' }));
        answers[0].resolve();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(result.current.data).toEqual({ id: 'u1' });
    });

    it('selects what the component reads from the answer', async () => {
        const api = fakeApi();
        api.on('GET', '/notebooks/nb1/notes', { body: { data: [note('n1'), note('n2')] } });

        const { result } = renderHook(() => useQuery(noteRoutes.list, { path: { notebookId: 'nb1' } }, { select: (notes) => notes.length }));

        await waitFor(() => expect(result.current.data).toBe(2));
    });

    it('waits for the queries it depends on, and fails with them', async () => {
        const api = fakeApi();
        api.on('GET', '/me', { status: 500, body: { error: 'Server::Internal' } });

        const { result } = renderHook(() => {
            const me = useQuery(noteRoutes.me);
            const notebooks = useQuery(noteRoutes.notebooks, {}, { dependsOn: me });
            return notebooks;
        });

        expect(result.current.loading).toBe(true);
        await waitFor(() => expect(result.current.error?.message).toBe('Server::Internal'));
        expect(api.calls('GET', '/notebooks')).toHaveLength(0);
    });

    it('takes data handed to it, for a frame from a gateway', async () => {
        const api = fakeApi();
        api.on('GET', '/notebooks/nb1/notes/n1', { body: { data: note('n1') } });
        const { result } = renderHook(() => useQuery(noteRoutes.get, { path: { notebookId: 'nb1', noteId: 'n1' } }));
        await waitFor(() => expect(result.current.data).toEqual(note('n1')));

        act(() => result.current.set(note('n1', 'renamed')));

        expect(result.current.data).toEqual(note('n1', 'renamed'));
    });

    it('asks nothing more for a page the end of the session took away', async () => {
        const api = fakeApi();
        api.on('GET', '/me', { body: { data: { id: 'u1' } } });
        session.start('token-a');
        const Me = () => <p>{useQuery(noteRoutes.me).data?.id}</p>;
        const Guarded = () => useSession() === null ? <p>signed out</p> : <Me />;
        render(<Guarded />);
        expect(await screen.findByText('u1')).toBeTruthy();

        act(() => session.end());
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(screen.getByText('signed out')).toBeTruthy();
        expect(api.calls('GET', '/me')).toHaveLength(1);
    });

    it('forgets what it loaded when the session ends, and asks again without it', async () => {
        const api = fakeApi();
        api.on('GET', '/me', ({ headers }) => headers.Authorization
            ? { body: { data: { id: 'u1' } } }
            : { status: 401, body: { error: 'Auth::Unauthorized' } });
        session.start('token-a');
        const { result } = renderHook(() => useQuery(noteRoutes.me));
        await waitFor(() => expect(result.current.data).toEqual({ id: 'u1' }));

        act(() => session.end());

        expect(result.current.data).toBeNull();
        await waitFor(() => expect(result.current.error?.message).toBe('Auth::Unauthorized'));
    });
});
