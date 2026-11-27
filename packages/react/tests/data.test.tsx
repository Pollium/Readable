import { clearData, getData, removeData, Rollback, setData, updateData } from '../lib/query/data';
import { useQuery } from '../lib/query/useQuery';
import { fakeApi } from './support/fake-api';
import { Note, noteRoutes } from './support/notes';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const note = (id: string, title = id): Note => ({ id, title });

const nb1 = { path: { notebookId: 'nb1' } };
const nb2 = { path: { notebookId: 'nb2' } };

const seeded = () => {
    const api = fakeApi();
    api.on('GET', '/notebooks/nb1/notes', { body: { data: [note('n1')] } });
    api.on('GET', '/notebooks/nb2/notes', { body: { data: [note('n2')] } });
    api.on('GET', '/me', { body: { data: { id: 'u1' } } });
    return api;
};

const loaded = async () => {
    const page = renderHook(() => ({
        one: useQuery(noteRoutes.list, nb1),
        two: useQuery(noteRoutes.list, nb2),
        me: useQuery(noteRoutes.me)
    }));
    await waitFor(() => expect(Object.values(page.result.current).every((query) => query.data !== null)).toBe(true));
    return page;
};

describe('cached data', () => {
    it('reads what a query loaded, and nothing before', async () => {
        seeded();
        expect(getData(noteRoutes.list, nb1)).toBeUndefined();

        await loaded();

        expect(getData(noteRoutes.list, nb1)).toEqual([note('n1')]);
        expect(getData(noteRoutes.get, { path: { notebookId: 'nb1' } })).toBeUndefined();
    });

    it('writes an answer the queries on screen show, and one that mounts later reads without asking', async () => {
        const api = seeded();
        const page = await loaded();

        act(() => {
            setData(noteRoutes.list, nb1, (notes) => [...notes ?? [], note('n9')]);
            setData(noteRoutes.get, { path: { notebookId: 'nb1', noteId: 'n9' } }, note('n9'));
        });
        const detail = renderHook(() => useQuery(noteRoutes.get, { path: { notebookId: 'nb1', noteId: 'n9' } }));

        expect(page.result.current.one.data).toEqual([note('n1'), note('n9')]);
        expect(detail.result.current).toMatchObject({ loading: false, data: note('n9') });
        expect(api.calls('GET', '/notebooks/nb1/notes/n9')).toHaveLength(0);
    });

    it('drops an answer that was on its way when the data was written', async () => {
        const api = fakeApi();
        const answer = Promise.withResolvers<void>();
        api.on('GET', '/me', async () => {
            await answer.promise;
            return { body: { data: { id: 'from-api' } } };
        });
        const { result } = renderHook(() => useQuery(noteRoutes.me));
        await waitFor(() => expect(api.sent).toHaveLength(1));

        act(() => {
            setData(noteRoutes.me, {}, { id: 'written' });
        });
        answer.resolve();
        await new Promise((resolve) => setTimeout(resolve, 10));

        expect(result.current).toMatchObject({ loading: false, data: { id: 'written' } });
    });

    it('rolls a write back to what was there', async () => {
        seeded();
        const page = await loaded();

        const rollback = setData(noteRoutes.list, nb1, []);
        act(() => rollback());

        expect(page.result.current.one.data).toEqual([note('n1')]);
    });

    it('rolls back nothing once a newer answer has landed', async () => {
        const api = seeded();
        const page = await loaded();
        const rollback = setData(noteRoutes.list, nb1, []);

        api.on('GET', '/notebooks/nb1/notes', { body: { data: [note('n1'), note('n3')] } });
        act(() => page.result.current.one.reload());
        await waitFor(() => expect(page.result.current.one.data).toHaveLength(2));
        act(() => rollback());

        expect(page.result.current.one.data).toEqual([note('n1'), note('n3')]);
    });

    it('rolls a write to nothing back to nothing, and a query on screen asks for it', async () => {
        const api = seeded();
        const rollback = setData(noteRoutes.me, {}, { id: 'guess' });
        const { result } = renderHook(() => useQuery(noteRoutes.me));
        expect(result.current.data).toEqual({ id: 'guess' });

        act(() => rollback());

        await waitFor(() => expect(result.current.data).toEqual({ id: 'u1' }));
        expect(api.calls('GET', '/me')).toHaveLength(1);
    });

    it('updates every answer of an endpoint, whatever its target, and rolls them all back', async () => {
        seeded();
        const page = await loaded();
        const targets: unknown[] = [];

        let rollback: Rollback = () => undefined;
        act(() => {
            rollback = updateData(noteRoutes.list, (notes, target) => {
                targets.push(target.path);
                return notes.map((current) => ({ ...current, title: 'renamed' }));
            });
        });

        expect(targets).toEqual([{ notebookId: 'nb1' }, { notebookId: 'nb2' }]);
        expect(page.result.current.one.data).toEqual([note('n1', 'renamed')]);
        expect(page.result.current.two.data).toEqual([note('n2', 'renamed')]);
        expect(page.result.current.me.data).toEqual({ id: 'u1' });

        act(() => rollback());
        expect(page.result.current.one.data).toEqual([note('n1')]);
        expect(page.result.current.two.data).toEqual([note('n2')]);
    });

    it('leaves an answer the update returns unchanged or undefined for', async () => {
        seeded();
        const page = await loaded();
        const before = page.result.current.two.data;

        act(() => {
            updateData(noteRoutes.list, (notes, target) => target.path?.notebookId === 'nb1' ? [] : undefined);
        });

        expect(page.result.current.one.data).toEqual([]);
        expect(page.result.current.two.data).toBe(before);
    });

    it('forgets one answer, and a query on screen asks for it again', async () => {
        const api = seeded();
        const page = await loaded();

        act(() => removeData(noteRoutes.list, nb1));

        expect(page.result.current.one).toMatchObject({ loading: true, data: null });
        await waitFor(() => expect(page.result.current.one.data).toEqual([note('n1')]));
        expect(api.calls('GET', '/notebooks/nb1/notes')).toHaveLength(2);
        expect(api.calls('GET', '/notebooks/nb2/notes')).toHaveLength(1);
    });

    it('forgets every answer of an endpoint, and one nobody reads asks on its next mount', async () => {
        const api = seeded();
        const page = await loaded();
        page.unmount();

        removeData(noteRoutes.list);
        const again = renderHook(() => useQuery(noteRoutes.list, nb2));

        expect(again.result.current).toMatchObject({ loading: true, data: null });
        expect(getData(noteRoutes.list, nb1)).toBeUndefined();
        expect(getData(noteRoutes.me)).toEqual({ id: 'u1' });
        await waitFor(() => expect(api.calls('GET', '/notebooks/nb2/notes')).toHaveLength(2));
    });

    it('forgets everything it was asked to clear', async () => {
        seeded();
        const page = await loaded();
        page.unmount();

        clearData();

        expect(getData(noteRoutes.me)).toBeUndefined();
        expect(getData(noteRoutes.list, nb2)).toBeUndefined();
    });
});
