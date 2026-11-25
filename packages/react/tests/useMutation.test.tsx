import { useMutation, invalidate } from '../lib/query/useMutation';
import { useQuery } from '../lib/query/useQuery';
import { fakeApi } from './support/fake-api';
import { Note, noteRoutes } from './support/notes';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const note = (id: string, title = id): Note => ({ id, title });

const notebook = { notebookId: 'nb1' };

const seeded = () => {
    const api = fakeApi();
    api.on('GET', '/notebooks', { body: { data: [{ id: 'nb1' }] } });
    api.on('GET', '/notebooks/nb1/notes', { body: { data: [note('n1')] } });
    api.on('GET', '/notebooks/nb2/notes', { body: { data: [] } });
    api.on('GET', '/notebooks/nb1/notes/n1', { body: { data: note('n1') } });
    api.on('GET', '/me', { body: { data: { id: 'u1' } } });
    return api;
};

const mounted = async () => {
    const page = renderHook(() => ({
        notebooks: useQuery(noteRoutes.notebooks),
        list: useQuery(noteRoutes.list, { path: notebook }),
        other: useQuery(noteRoutes.list, { path: { notebookId: 'nb2' } }),
        detail: useQuery(noteRoutes.get, { path: { ...notebook, noteId: 'n1' } }),
        me: useQuery(noteRoutes.me)
    }));
    await waitFor(() => expect(Object.values(page.result.current).every((query) => query.data !== null)).toBe(true));
    return page;
};

const askedAgain = (api: ReturnType<typeof fakeApi>, path: string) => api.calls('GET', path).length > 1;

describe('useMutation', () => {
    it('sends its body and answers what the api returned', async () => {
        const api = fakeApi();
        api.on('POST', '/notebooks/nb1/notes', ({ body }) => ({ status: 201, body: { data: { id: 'n2', ...body as object } } }));
        const { result } = renderHook(() => useMutation(noteRoutes.create, { path: notebook }));

        let created: Note | undefined;
        await act(async () => {
            created = await result.current.run({ body: { title: 'b' } });
        });

        expect(created).toEqual(note('n2', 'b'));
        expect(result.current).toMatchObject({ loading: false, error: undefined });
    });

    it('keeps the error it failed with, and throws it', async () => {
        const api = fakeApi();
        api.on('PATCH', '/notebooks/nb1/notes/n1', { status: 409, body: { error: 'Note::Locked' } });
        const { result } = renderHook(() => useMutation(noteRoutes.update));

        await act(() => expect(result.current.run({ path: { ...notebook, noteId: 'n1' }, body: { title: 'b' } })).rejects.toThrow('Note::Locked'));

        expect(result.current.error?.message).toBe('Note::Locked');
        act(() => result.current.reset());
        expect(result.current.error).toBeUndefined();
    });

    it('refreshes the note it changed and every query above it', async () => {
        const api = seeded();
        api.on('PATCH', '/notebooks/nb1/notes/n1', { body: { data: note('n1', 'b') } });
        const page = await mounted();
        const { result } = renderHook(() => useMutation(noteRoutes.update, { path: notebook }));

        await act(() => result.current.run({ path: { noteId: 'n1' }, body: { title: 'b' } }));

        await waitFor(() => expect(askedAgain(api, '/notebooks/nb1/notes/n1')).toBe(true));
        expect(askedAgain(api, '/notebooks/nb1/notes')).toBe(true);
        expect(askedAgain(api, '/notebooks')).toBe(true);
        expect(askedAgain(api, '/notebooks/nb2/notes')).toBe(false);
        expect(askedAgain(api, '/me')).toBe(false);
        page.unmount();
    });

    it('refreshes the note an action ran on', async () => {
        const api = seeded();
        api.on('POST', '/notebooks/nb1/notes/n1/archive', { body: { data: note('n1') } });
        await mounted();
        const { result } = renderHook(() => useMutation(noteRoutes.archive, { path: { ...notebook, noteId: 'n1' } }));

        await act(() => result.current.run());

        await waitFor(() => expect(askedAgain(api, '/notebooks/nb1/notes/n1')).toBe(true));
        expect(askedAgain(api, '/notebooks/nb1/notes')).toBe(true);
    });

    it('refreshes the list a note was removed from, and not the removed note', async () => {
        const api = seeded();
        api.on('DELETE', '/notebooks/nb1/notes/n1', { status: 204 });
        await mounted();
        const { result } = renderHook(() => useMutation(noteRoutes.remove, { path: { ...notebook, noteId: 'n1' } }));

        await act(() => result.current.run());

        await waitFor(() => expect(askedAgain(api, '/notebooks/nb1/notes')).toBe(true));
        expect(askedAgain(api, '/notebooks/nb1/notes/n1')).toBe(false);
    });

    it('refreshes what it names besides its own branch', async () => {
        const api = seeded();
        api.on('POST', '/notebooks/nb1/notes', { status: 201, body: { data: note('n2') } });
        await mounted();
        const { result } = renderHook(() => useMutation(noteRoutes.create, { path: notebook, invalidates: [noteRoutes.me] }));

        await act(() => result.current.run({ body: { title: 'n2' } }));

        await waitFor(() => expect(askedAgain(api, '/me')).toBe(true));
        expect(askedAgain(api, '/notebooks/nb2/notes')).toBe(false);
    });

    it('refreshes the branch on the api it changed, not the same path on another', async () => {
        const api = fakeApi();
        api.on('GET', '/notebooks/nb1/notes', { body: { data: [note('n1')] } });
        api.on('PATCH', '/notebooks/nb1/notes/n1', { body: { data: note('n1', 'b') } });
        const page = renderHook(() => ({
            own: useQuery(noteRoutes.list, { path: notebook }),
            iam: useQuery(noteRoutes.list, { base: 'http://iam.test', path: notebook })
        }));
        await waitFor(() => expect(page.result.current.iam.data).toEqual([note('n1')]));
        await waitFor(() => expect(page.result.current.own.data).toEqual([note('n1')]));
        const { result } = renderHook(() => useMutation(noteRoutes.update, { base: 'http://iam.test', path: { ...notebook, noteId: 'n1' } }));

        await act(() => result.current.run({ body: { title: 'b' } }));

        const listFrom = (host: string) => api.calls('GET', '/notebooks/nb1/notes').filter((sent) => sent.url.host === host);
        await waitFor(() => expect(listFrom('iam.test')).toHaveLength(2));
        expect(listFrom('api.test')).toHaveLength(1);
    });

    it('refreshes everything on screen when it names nothing', async () => {
        const api = seeded();
        await mounted();

        await act(() => invalidate());

        expect(api.calls('GET', '/me')).toHaveLength(2);
        expect(api.calls('GET', '/notebooks/nb2/notes')).toHaveLength(2);
    });

    it('asks again on the next mount for a query nobody was reading', async () => {
        const api = seeded();
        const first = renderHook(() => useQuery(noteRoutes.list, { path: { notebookId: 'nb2' } }));
        await waitFor(() => expect(first.result.current.data).toEqual([]));
        first.unmount();

        await act(() => invalidate(noteRoutes.list));
        expect(api.calls('GET', '/notebooks/nb2/notes')).toHaveLength(1);

        renderHook(() => useQuery(noteRoutes.list, { path: { notebookId: 'nb2' } }));
        await waitFor(() => expect(api.calls('GET', '/notebooks/nb2/notes')).toHaveLength(2));
    });
});
