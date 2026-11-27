import { useQueries } from '../lib/query/useQueries';
import { useQuery } from '../lib/query/useQuery';
import { fakeApi } from './support/fake-api';
import { Note, noteRoutes } from './support/notes';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const note = (id: string): Note => ({ id, title: id });

const seeded = () => {
    const api = fakeApi();
    for(const id of ['nb1', 'nb2', 'nb3']){
        api.on('GET', `/notebooks/${id}/notes`, { body: { data: [note(`${id}-n1`)] } });
    }
    return api;
};

const targets = (...ids: (string | undefined)[]) => ids.map((notebookId) => ({ path: { notebookId } }));

describe('useQueries', () => {
    it('reads one answer per target', async () => {
        seeded();

        const { result } = renderHook(() => useQueries(noteRoutes.list, targets('nb1', 'nb2')));

        expect(result.current.map((query) => query.loading)).toEqual([true, true]);
        await waitFor(() => expect(result.current.map((query) => query.data)).toEqual([[note('nb1-n1')], [note('nb2-n1')]]));
    });

    it('lets each target wait on its own', async () => {
        const api = seeded();

        const { result } = renderHook(() => useQueries(noteRoutes.list, [...targets('nb1', undefined), false]));

        await waitFor(() => expect(result.current[0].data).toEqual([note('nb1-n1')]));
        expect(result.current.slice(1).map((query) => [query.loading, query.data])).toEqual([[false, null], [false, null]]);
        expect(api.sent).toHaveLength(1);
    });

    it('shares its answers with useQuery', async () => {
        const api = seeded();
        const single = renderHook(() => useQuery(noteRoutes.list, { path: { notebookId: 'nb1' } }));
        await waitFor(() => expect(single.result.current.data).not.toBeNull());

        const { result } = renderHook(() => useQueries(noteRoutes.list, targets('nb1', 'nb2')));

        expect(result.current[0]).toMatchObject({ loading: false, data: [note('nb1-n1')] });
        await waitFor(() => expect(result.current[1].data).not.toBeNull());
        expect(api.calls('GET', '/notebooks/nb1/notes')).toHaveLength(1);
    });

    it('asks only for a target added since', async () => {
        const api = seeded();
        const { result, rerender } = renderHook(({ ids }) => useQueries(noteRoutes.list, targets(...ids)), { initialProps: { ids: ['nb1'] } });
        await waitFor(() => expect(result.current[0].data).not.toBeNull());

        rerender({ ids: ['nb1', 'nb3'] });

        await waitFor(() => expect(result.current[1].data).toEqual([note('nb3-n1')]));
        expect(api.sent.map((sent) => sent.url.pathname)).toEqual(['/notebooks/nb1/notes', '/notebooks/nb3/notes']);
    });

    it('keeps reload and set across renders, and sets the answer of its own target', async () => {
        seeded();
        const { result, rerender } = renderHook(() => useQueries(noteRoutes.list, targets('nb1', 'nb2')));
        await waitFor(() => expect(result.current.every((query) => query.data !== null)).toBe(true));
        const [{ reload, set }] = result.current;

        rerender();
        act(() => result.current[1].set([]));

        expect(result.current[0].reload).toBe(reload);
        expect(result.current[0].set).toBe(set);
        expect(result.current.map((query) => query.data)).toEqual([[note('nb1-n1')], []]);
    });
});
