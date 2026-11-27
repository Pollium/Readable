import { updateData } from '../lib/query/data';
import { useMutation } from '../lib/query/useMutation';
import { usePages } from '../lib/query/usePages';
import { fakeApi, Sent } from './support/fake-api';
import { Note, noteRoutes } from './support/notes';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const note = (id: number): Note => ({ id: `n${id}`, title: `note ${id}` });

const feed = (total: number, { maxLimit = 100, failAt }: { maxLimit?: number; failAt?: number } = {}) => {
    const api = fakeApi();
    let notes = Array.from({ length: total }, (_, index) => note(index + 1));
    const answer = ({ url }: Sent) => {
        const limit = Math.min(Number(url.searchParams.get('limit') ?? 50), maxLimit);
        const offset = Number(url.searchParams.get('offset') ?? 0);
        if(offset === failAt) return { status: 503, body: { error: 'Server::Unavailable' } };
        return { body: { data: notes.slice(offset, offset + limit), meta: { total: notes.length, limit, offset } } };
    };
    api.on('GET', '/notebooks/nb1/feed', answer);
    api.on('POST', '/notebooks/nb1/feed', () => {
        notes = [note(0), ...notes];
        return { status: 201, body: { data: note(0) } };
    });
    return {
        api,
        offsets: () => api.calls('GET', '/notebooks/nb1/feed').map((sent) => sent.url.searchParams.get('offset')),
        stopFailing: () => {
            failAt = undefined;
        }
    };
};

const path = { notebookId: 'nb1' };
const ids = (notes: readonly Note[] | null) => notes?.map(({ id }) => id);

describe('usePages', () => {
    it('loads the first page and tells whether the api has more', async () => {
        feed(5);

        const { result } = renderHook(() => usePages(noteRoutes.feed, { path }, { limit: 2 }));

        expect(result.current).toMatchObject({ loading: true, data: null, items: [], total: null, hasMore: false });
        await waitFor(() => expect(result.current.loading).toBe(false));
        expect(result.current).toMatchObject({ data: [note(1), note(2)], items: [note(1), note(2)], total: 5, hasMore: true, loadingMore: false });
    });

    it('loads the next page on loadMore, and stops at the end', async () => {
        const { offsets } = feed(5);
        const { result } = renderHook(() => usePages(noteRoutes.feed, { path }, { limit: 2 }));
        await waitFor(() => expect(result.current.data).not.toBeNull());

        act(() => result.current.loadMore());
        expect(result.current.loadingMore).toBe(true);
        await waitFor(() => expect(result.current.items).toHaveLength(4));
        act(() => result.current.loadMore());
        await waitFor(() => expect(result.current.items).toHaveLength(5));
        act(() => result.current.loadMore());

        expect(result.current).toMatchObject({ hasMore: false, loadingMore: false, loading: false });
        expect(ids(result.current.items)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5']);
        expect(offsets()).toEqual(['0', '2', '4']);
    });

    it('asks for one more page however often loadMore is called while it is on its way', async () => {
        const { offsets } = feed(10);
        const { result } = renderHook(() => usePages(noteRoutes.feed, { path }, { limit: 2 }));
        await waitFor(() => expect(result.current.data).not.toBeNull());

        act(() => {
            result.current.loadMore();
            result.current.loadMore();
        });
        await waitFor(() => expect(result.current.items).toHaveLength(4));
        act(() => result.current.loadMore());
        act(() => result.current.loadMore());
        await waitFor(() => expect(result.current.items).toHaveLength(6));

        expect(offsets()).toEqual(['0', '2', '4']);
    });

    it('shares its pages with every reader of the same list', async () => {
        const { api } = feed(5);
        const first = renderHook(() => usePages(noteRoutes.feed, { path }, { limit: 2 }));
        const second = renderHook(() => usePages(noteRoutes.feed, { path }, { limit: 2 }));
        await waitFor(() => expect(second.result.current.data).not.toBeNull());

        act(() => first.result.current.loadMore());

        await waitFor(() => expect(second.result.current.items).toHaveLength(4));
        expect(api.sent).toHaveLength(2);
    });

    it('keeps a list with another filter, or another size, apart', async () => {
        const { api } = feed(5);
        const all = renderHook(() => usePages(noteRoutes.feed, { path }, { limit: 2 }));
        const other = renderHook(() => usePages(noteRoutes.feed, { path, query: { tag: 'a' } }, { limit: 2 }));
        await waitFor(() => expect(other.result.current.data).not.toBeNull());

        act(() => all.result.current.loadMore());
        await waitFor(() => expect(all.result.current.items).toHaveLength(4));

        expect(other.result.current.items).toHaveLength(2);
        expect(api.sent.map((sent) => sent.url.search)).toEqual(['?limit=2&offset=0', '?limit=2&offset=0&tag=a', '?limit=2&offset=2']);
    });

    it('steps by the limit the api applied, so a lowered limit skips nothing', async () => {
        const { api } = feed(7, { maxLimit: 3 });
        const { result } = renderHook(() => usePages(noteRoutes.feed, { path }, { limit: 50 }));
        await waitFor(() => expect(result.current.data).not.toBeNull());

        act(() => result.current.loadMore());
        await waitFor(() => expect(result.current.items).toHaveLength(6));

        expect(ids(result.current.items)).toEqual(['n1', 'n2', 'n3', 'n4', 'n5', 'n6']);
        expect(api.sent[1].url.search).toBe('?limit=3&offset=3');
        expect(result.current.hasMore).toBe(true);
    });

    it('keeps the pages it has when a later one fails, and asks for it again on loadMore', async () => {
        const { offsets, stopFailing } = feed(5, { failAt: 2 });
        const { result } = renderHook(() => usePages(noteRoutes.feed, { path }, { limit: 2 }));
        await waitFor(() => expect(result.current.data).not.toBeNull());

        act(() => result.current.loadMore());
        await waitFor(() => expect(result.current.error?.message).toBe('Server::Unavailable'));
        expect(result.current).toMatchObject({ items: [note(1), note(2)], hasMore: true, loadingMore: false });

        stopFailing();
        act(() => result.current.loadMore());

        await waitFor(() => expect(result.current.items).toHaveLength(4));
        expect(result.current.error).toBeUndefined();
        expect(offsets()).toEqual(['0', '2', '2']);
    });

    it('reloads every page it has loaded', async () => {
        const { offsets } = feed(5);
        const { result } = renderHook(() => usePages(noteRoutes.feed, { path }, { limit: 2 }));
        await waitFor(() => expect(result.current.data).not.toBeNull());
        act(() => result.current.loadMore());
        await waitFor(() => expect(result.current.items).toHaveLength(4));

        act(() => result.current.reload());

        expect(result.current.fetching).toBe(true);
        await waitFor(() => expect(result.current.fetching).toBe(false));
        expect(offsets()).toEqual(['0', '2', '0', '2']);
    });

    it('refreshes every loaded page after a mutation on its branch', async () => {
        const { offsets } = feed(5);
        const { result } = renderHook(() => ({
            pages: usePages(noteRoutes.feed, { path }, { limit: 2 }),
            post: useMutation(noteRoutes.post, { path })
        }));
        await waitFor(() => expect(result.current.pages.data).not.toBeNull());
        act(() => result.current.pages.loadMore());
        await waitFor(() => expect(result.current.pages.items).toHaveLength(4));

        await act(() => result.current.post.run({ body: { title: 'note 0' } }));

        await waitFor(() => expect(ids(result.current.pages.items)).toEqual(['n0', 'n1', 'n2', 'n3']));
        expect(result.current.pages.total).toBe(6);
        expect(offsets()).toEqual(['0', '2', '0', '2']);
    });

    it('sets the items of every loaded page, cutting them into pages again', async () => {
        feed(5);
        const { result } = renderHook(() => usePages(noteRoutes.feed, { path }, { limit: 2 }));
        await waitFor(() => expect(result.current.data).not.toBeNull());
        act(() => result.current.loadMore());
        await waitFor(() => expect(result.current.items).toHaveLength(4));

        act(() => result.current.set((items) => [note(0), ...items]));
        expect(ids(result.current.items)).toEqual(['n0', 'n1', 'n2', 'n3']);
        expect(result.current).toMatchObject({ total: 6, hasMore: true });

        act(() => result.current.set((items) => items.filter(({ id }) => id !== 'n1' && id !== 'n2')));
        expect(ids(result.current.items)).toEqual(['n0', 'n3']);
        expect(result.current.total).toBe(4);
    });

    it('lets updateData change each page of a list', async () => {
        feed(5);
        const { result } = renderHook(() => usePages(noteRoutes.feed, { path }, { limit: 2 }));
        await waitFor(() => expect(result.current.data).not.toBeNull());
        act(() => result.current.loadMore());
        await waitFor(() => expect(result.current.items).toHaveLength(4));

        act(() => {
            updateData(noteRoutes.feed, (page) => ({ ...page, items: page.items.map((item) => ({ ...item, title: 'renamed' })) }));
        });

        expect(result.current.items.map(({ title }) => title)).toEqual(['renamed', 'renamed', 'renamed', 'renamed']);
    });

    it('starts again from its first page, from memory, once nobody reads the list', async () => {
        const { api } = feed(5);
        const first = renderHook(() => usePages(noteRoutes.feed, { path }, { limit: 2 }));
        await waitFor(() => expect(first.result.current.data).not.toBeNull());
        act(() => first.result.current.loadMore());
        await waitFor(() => expect(first.result.current.items).toHaveLength(4));
        first.unmount();

        const again = renderHook(() => usePages(noteRoutes.feed, { path }, { limit: 2 }));

        expect(again.result.current).toMatchObject({ loading: false, items: [note(1), note(2)] });
        act(() => again.result.current.loadMore());
        expect(again.result.current.items).toHaveLength(4);
        expect(api.sent).toHaveLength(2);
    });

    it('waits while a path param is missing or it is disabled', () => {
        const { api } = feed(5);

        const missing = renderHook(() => usePages(noteRoutes.feed, { path: { notebookId: undefined } }));
        const disabled = renderHook(() => usePages(noteRoutes.feed, { path }, { enabled: false }));

        expect(missing.result.current).toMatchObject({ loading: false, data: null, hasMore: false });
        expect(disabled.result.current).toMatchObject({ loading: false, data: null });
        act(() => missing.result.current.loadMore());
        expect(api.sent).toHaveLength(0);
    });

    it('reads only an endpoint that answers pages', () => {
        const typed = () => {
            const notes: Note[] = usePages(noteRoutes.feed, { path }).items;
            // @ts-expect-error a list of notes is not a page
            usePages(noteRoutes.list, { path });
            return notes;
        };

        expect(typed).toBeTypeOf('function');
    });
});
