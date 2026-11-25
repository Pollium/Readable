import { useChannel } from '../lib/live/useChannel';
import { useQuery } from '../lib/query/useQuery';
import { session } from '../lib/session/session';
import { fakeApi } from './support/fake-api';
import { fakeSockets } from './support/fake-socket';
import { Note, noteGateway, noteRoutes } from './support/notes';
import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const note = (id: string, title = id): Note => ({ id, title });

describe('useChannel', () => {
    afterEach(() => {
        session.end();
        vi.useRealTimers();
    });

    it('connects to the gateway\'s channel with the session token', () => {
        const sockets = fakeSockets();
        session.start('token-a');

        renderHook(() => useChannel(noteGateway, {}));

        expect(sockets.last).toMatchObject({ url: 'ws://api.test/notes/live', protocol: 'token-a' });
    });

    it('hands each frame to its handler, and keeps the error the gateway answered', () => {
        const sockets = fakeSockets();
        const changed = vi.fn();
        const { result } = renderHook(() => useChannel(noteGateway, { 'note.changed': changed }));

        act(() => {
            sockets.last.open();
            sockets.last.receive({ type: 'note.changed', data: note('n1') });
            sockets.last.receive({ error: 'Gateway::UnknownMessageType' });
        });

        expect(changed).toHaveBeenCalledWith(note('n1'));
        expect(result.current).toMatchObject({ status: 'open', lastError: 'Gateway::UnknownMessageType' });
        act(() => result.current.clearError());
        expect(result.current.lastError).toBeUndefined();
    });

    it('tells which session an error frame was about', () => {
        const sockets = fakeSockets();
        const onError = vi.fn();
        renderHook(() => useChannel(noteGateway, {}, { onError }));

        act(() => {
            sockets.last.open();
            sockets.last.receive({ error: 'Chat::Busy', sessionId: 's1' });
            sockets.last.receive({ error: 'Gateway::MalformedFrame' });
        });

        expect(onError.mock.calls).toEqual([['Chat::Busy', 's1'], ['Gateway::MalformedFrame', undefined]]);
    });

    it('joins on every open, again after a reconnect, and when what it joins changes', () => {
        vi.useFakeTimers();
        const sockets = fakeSockets();
        const { rerender } = renderHook(
            ({ notebookId }: { notebookId: string }) => useChannel(noteGateway, {}, { join: ['note.watch', { notebookId }] }),
            { initialProps: { notebookId: 'nb1' } }
        );

        act(() => sockets.last.open());
        expect(sockets.last.sent).toEqual([{ type: 'note.watch', notebookId: 'nb1' }]);

        act(() => sockets.last.close(1006));
        act(() => vi.advanceTimersByTime(500));
        act(() => sockets.last.open());
        expect(sockets.opened).toHaveLength(2);
        expect(sockets.last.sent).toEqual([{ type: 'note.watch', notebookId: 'nb1' }]);

        rerender({ notebookId: 'nb2' });
        expect(sockets.last.sent).toEqual([
            { type: 'note.watch', notebookId: 'nb1' },
            { type: 'note.watch', notebookId: 'nb2' }
        ]);
    });

    it('shares one socket among its readers and closes it with the last one', () => {
        const sockets = fakeSockets();
        const first = renderHook(() => useChannel(noteGateway, {}));
        const second = renderHook(() => useChannel(noteGateway, {}));
        act(() => sockets.last.open());

        first.unmount();
        expect(sockets.last.readyState).toBe(1);
        second.unmount();

        expect(sockets.opened).toHaveLength(1);
        expect(sockets.last.readyState).toBe(3);
    });

    it('updates a query with the frames it hears', async () => {
        const api = fakeApi();
        api.on('GET', '/notebooks/nb1/notes/n1', { body: { data: note('n1') } });
        const sockets = fakeSockets();

        const { result } = renderHook(() => {
            const current = useQuery(noteRoutes.get, { path: { notebookId: 'nb1', noteId: 'n1' } });
            useChannel(noteGateway, { 'note.changed': current.set });
            return current;
        });
        await waitFor(() => expect(result.current.data).toEqual(note('n1')));

        act(() => {
            sockets.last.open();
            sockets.last.receive({ type: 'note.changed', data: note('n1', 'renamed') });
        });

        expect(result.current.data).toEqual(note('n1', 'renamed'));
    });

    it('ends the session when the gateway closes for it, and stays closed', () => {
        vi.useFakeTimers();
        const sockets = fakeSockets();
        session.start('token-a');
        const { result } = renderHook(() => useChannel(noteGateway, {}));
        act(() => sockets.last.open());

        act(() => sockets.last.close(4401));
        act(() => vi.advanceTimersByTime(20_000));

        expect(session.token).toBeNull();
        expect(result.current.status).toBe('closed');
        expect(sockets.opened).toHaveLength(1);
    });

    it('sends nothing while the socket is not open', () => {
        fakeSockets();
        const { result } = renderHook(() => useChannel(noteGateway, {}));

        expect(result.current.send('note.watch', { notebookId: 'nb1' })).toBe(false);
    });

    it('reconnects at once when the browser is back online', () => {
        vi.useFakeTimers();
        const sockets = fakeSockets();
        renderHook(() => useChannel(noteGateway, {}));
        act(() => sockets.last.open());
        act(() => sockets.last.close(1006));

        act(() => {
            window.dispatchEvent(new Event('online'));
        });

        expect(sockets.opened).toHaveLength(2);
    });

    it('types the frames and the messages by the gateway', () => {
        const typed = () => {
            // @ts-expect-error a note is not a number
            useChannel(noteGateway, { 'note.changed': (count: number) => count });
            const channel = useChannel(noteGateway, {});
            // @ts-expect-error the gateway takes no such message
            channel.send('note.leave', {});
        };

        expect(typed).toBeTypeOf('function');
    });
});
