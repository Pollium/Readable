import { configure } from '../lib/app/config';
import { call } from '../lib/http/call';
import { useMutation } from '../lib/query/useMutation';
import { useQuery } from '../lib/query/useQuery';
import { fakeApi } from './support/fake-api';
import { noteRoutes } from './support/notes';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';

let teamId: string | undefined;

const seeded = () => {
    const api = fakeApi();
    api.on('GET', '/teams/t1/members', { body: { data: [{ id: 'm1' }] } });
    api.on('GET', '/teams/t2/members', { body: { data: [{ id: 'm2' }] } });
    api.on('GET', '/teams/other/members', { body: { data: [] } });
    api.on('DELETE', '/teams/t1/members/m1', { status: 204 });
    return api;
};

describe('path defaults', () => {
    beforeEach(() => {
        teamId = 't1';
        configure({ name: 'notes', apiUrl: 'http://api.test', pathDefaults: () => ({ teamId }) });
    });

    it('fills a param the call leaves out', async () => {
        const api = seeded();

        expect(await call(noteRoutes.members)).toEqual([{ id: 'm1' }]);
        expect(await call(noteRoutes.members, { path: { teamId: undefined } })).toEqual([{ id: 'm1' }]);
        expect(api.sent.map((sent) => sent.url.pathname)).toEqual(['/teams/t1/members', '/teams/t1/members']);
    });

    it('takes the value a call gives over the default', async () => {
        const api = seeded();

        await call(noteRoutes.members, { path: { teamId: 'other' } });

        expect(api.sent[0].url.pathname).toBe('/teams/other/members');
    });

    it('keeps a query waiting while neither the call nor the default has the param', () => {
        const api = seeded();
        teamId = undefined;

        const { result } = renderHook(() => useQuery(noteRoutes.members));

        expect(result.current).toMatchObject({ loading: false, data: null });
        expect(api.sent).toHaveLength(0);
    });

    it('keeps the answers of each filled path apart', async () => {
        const api = seeded();
        const { result, rerender } = renderHook(() => useQuery(noteRoutes.members));
        await waitFor(() => expect(result.current.data).toEqual([{ id: 'm1' }]));

        teamId = 't2';
        rerender();

        await waitFor(() => expect(result.current.data).toEqual([{ id: 'm2' }]));
        teamId = 't1';
        rerender();
        expect(result.current.data).toEqual([{ id: 'm1' }]);
        expect(api.calls('GET', '/teams/t1/members')).toHaveLength(1);
    });

    it('refreshes the branch of the filled path after a mutation', async () => {
        const api = seeded();
        const list = renderHook(() => useQuery(noteRoutes.members));
        await waitFor(() => expect(list.result.current.data).toEqual([{ id: 'm1' }]));
        const { result } = renderHook(() => useMutation(noteRoutes.removeMember));

        await act(() => result.current.run({ path: { memberId: 'm1' } }));

        await waitFor(() => expect(api.calls('GET', '/teams/t1/members')).toHaveLength(2));
        expect(api.calls('DELETE', '/teams/t1/members/m1')).toHaveLength(1);
    });
});
