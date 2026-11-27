import { useChannel } from '../lib/live/useChannel';
import { channels } from '../lib/live/SocketChannel';
import { session } from '../lib/session/session';
import { binary, SocketClose } from '@pollium/readable-contracts/gateway';
import { fakeSockets } from './support/fake-socket';
import { noteGateway } from './support/notes';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const flushed = () => act(async () => {
    await Promise.resolve();
    await Promise.resolve();
});

describe('useChannel while it connects', () => {
    afterEach(() => {
        session.end();
        vi.useRealTimers();
    });

    it('queues what it is told to, and sends it after its joins once open', () => {
        const sockets = fakeSockets();
        const { result } = renderHook(() => useChannel(noteGateway, {}, { join: ['note.watch', { notebookId: 'nb1' }] }));

        expect(result.current.send('note.typing', { noteId: 'n1' }, { queue: true })).toBe(true);
        expect(result.current.send('note.typing', { noteId: 'n2' })).toBe(false);
        act(() => sockets.last.open());

        expect(sockets.last.sent).toEqual([
            { type: 'note.watch', notebookId: 'nb1' },
            { type: 'note.typing', noteId: 'n1' }
        ]);
    });

    it('holds only so much', () => {
        fakeSockets();
        const { result } = renderHook(() => useChannel(noteGateway, {}));

        const queued = Array.from({ length: 257 }, () => result.current.send('note.typing', { noteId: 'n1' }, { queue: true }));

        expect(queued.filter(Boolean)).toHaveLength(256);
        expect(queued[256]).toBe(false);
    });
});

describe('useChannel requests', () => {
    afterEach(() => {
        session.end();
        vi.useRealTimers();
    });

    it('resolves with the answer to its id, asked before or after the socket opened', async () => {
        const sockets = fakeSockets();
        const { result } = renderHook(() => useChannel(noteGateway, {}));
        const early = result.current.request('note.watch', { notebookId: 'nb1' });
        act(() => sockets.last.open());
        const late = result.current.request('note.watch', { notebookId: 'nb2' });

        expect(sockets.last.sent).toEqual([
            { type: 'note.watch', notebookId: 'nb1', id: 1 },
            { type: 'note.watch', notebookId: 'nb2', id: 2 }
        ]);
        act(() => {
            sockets.last.receive({ type: 'note.watch', re: 2, data: [{ id: 'n2', title: 'two' }] });
            sockets.last.receive({ type: 'note.watch', re: 1, data: [] });
        });

        await expect(early).resolves.toEqual([]);
        await expect(late).resolves.toEqual([{ id: 'n2', title: 'two' }]);
    });

    it('hands an answer to its request only, never to the frame handlers', async () => {
        const sockets = fakeSockets();
        const watched = vi.fn();
        const { result } = renderHook(() => useChannel(noteGateway, { 'note.watch': watched }));
        act(() => sockets.last.open());

        const asked = result.current.request('note.watch', { notebookId: 'nb1' });
        act(() => sockets.last.receive({ type: 'note.watch', re: 1, data: [] }));

        await expect(asked).resolves.toEqual([]);
        expect(watched).not.toHaveBeenCalled();
    });

    it('rejects with the code the gateway answered, without reporting it as the last error', async () => {
        const sockets = fakeSockets();
        const { result } = renderHook(() => useChannel(noteGateway, {}));
        act(() => sockets.last.open());

        const asked = result.current.request('note.watch', { notebookId: 'nb1' });
        act(() => sockets.last.receive({ type: 'note.watch', re: 1, error: 'Note::NotFound' }));

        await expect(asked).rejects.toMatchObject({ message: 'Note::NotFound' });
        expect(result.current.lastError).toBeUndefined();
    });

    it('rejects with Gateway::Timeout when no answer comes in time', async () => {
        vi.useFakeTimers();
        const sockets = fakeSockets();
        const { result } = renderHook(() => useChannel(noteGateway, {}));
        act(() => sockets.last.open());

        const asked = result.current.request('note.watch', { notebookId: 'nb1' }, { timeoutMs: 1000 });
        const settled = asked.catch((error: unknown) => error);
        act(() => vi.advanceTimersByTime(1000));

        await expect(settled).resolves.toMatchObject({ message: 'Gateway::Timeout' });
    });

    it('rejects what it had sent when the socket drops, and keeps what it had not', async () => {
        vi.useFakeTimers();
        const sockets = fakeSockets();
        const { result } = renderHook(() => useChannel(noteGateway, {}));
        act(() => sockets.last.open());
        const sent = result.current.request('note.watch', { notebookId: 'nb1' });
        const rejected = sent.catch((error: unknown) => error);

        act(() => sockets.last.close(1006));
        const queued = result.current.request('note.watch', { notebookId: 'nb2' });
        act(() => vi.advanceTimersByTime(500));
        act(() => sockets.last.open());
        act(() => sockets.last.receive({ type: 'note.watch', re: 2, data: [] }));

        await expect(rejected).resolves.toMatchObject({ message: 'Gateway::Closed' });
        await expect(queued).resolves.toEqual([]);
    });

    it('refuses fields named like the frame\'s own', async () => {
        fakeSockets();
        const { result } = renderHook(() => useChannel(noteGateway, {}));

        await expect(result.current.request('note.watch', { notebookId: 'nb1', id: 'n1' } as { notebookId: string }))
            .rejects.toMatchObject({ message: 'Gateway::MalformedFrame:id' });
    });
});

describe('useChannel binary frames', () => {
    it('hands a frame\'s bytes to its handler, and sends bytes it is given', () => {
        const sockets = fakeSockets();
        const changed = vi.fn();
        const { result } = renderHook(() => useChannel(noteGateway, { 'note.changed': changed }));
        act(() => sockets.last.open());

        act(() => sockets.last.receive({ type: 'note.changed', data: { id: 'n1', title: 'one' } }, new Uint8Array([1, 2])));
        result.current.send('note.typing', { noteId: 'n1' }, { bytes: new Uint8Array([3]) });

        expect(changed).toHaveBeenCalledWith({ id: 'n1', title: 'one' }, new Uint8Array([1, 2]));
        expect(sockets.last.sent).toEqual([{ frame: { type: 'note.typing', noteId: 'n1' }, bytes: [3] }]);
    });
});

describe('useChannel answers', () => {
    it('answers what the gateway asks with what its handler returns', async () => {
        const sockets = fakeSockets();
        renderHook(() => useChannel(noteGateway, {}, {
            answers: { 'note.confirm': async ({ question }) => ({ yes: question === 'sure?' }) }
        }));
        act(() => sockets.last.open());

        act(() => sockets.last.receive({ type: 'note.confirm', id: 7, data: { question: 'sure?' } }));
        await flushed();

        expect(sockets.last.sent).toEqual([{ type: 'note.confirm', re: 7, data: { yes: true } }]);
    });

    it('answers with bytes, with the error its handler throws, and refuses a question it has no answer for', async () => {
        const sockets = fakeSockets();
        let mode: 'bytes' | 'throw' = 'bytes';
        renderHook(() => useChannel(noteGateway, {}, {
            answers: {
                'note.confirm': () => {
                    if(mode === 'throw') throw new Error('Note::Locked');
                    return binary({ yes: true }, new Uint8Array([5]));
                }
            }
        }));
        act(() => sockets.last.open());

        act(() => sockets.last.receive({ type: 'note.confirm', id: 1, data: { question: 'a' } }));
        await flushed();
        mode = 'throw';
        act(() => sockets.last.receive({ type: 'note.confirm', id: 2, data: { question: 'b' } }));
        act(() => sockets.last.receive({ type: 'note.changed', id: 3, data: null }));
        await flushed();

        expect(sockets.last.sent).toEqual([
            { frame: { type: 'note.confirm', re: 1, data: { yes: true } }, bytes: [5] },
            { type: 'note.confirm', re: 2, error: 'Note::Locked' },
            { type: 'note.changed', re: 3, error: 'Gateway::UnknownMessageType' }
        ]);
    });
});

describe('useChannel joins', () => {
    it('sends several joins on every open, and the leave of one that changes', () => {
        const sockets = fakeSockets();
        const { rerender } = renderHook(
            ({ second }: { second: string }) => useChannel(noteGateway, {}, {
                joins: [['note.watch', { notebookId: 'nb1' }, 'note.unwatch'], ['note.watch', { notebookId: second }, 'note.unwatch']]
            }),
            { initialProps: { second: 'nb2' } }
        );
        act(() => sockets.last.open());

        rerender({ second: 'nb3' });

        expect(sockets.last.sent).toEqual([
            { type: 'note.watch', notebookId: 'nb1' },
            { type: 'note.watch', notebookId: 'nb2' },
            { type: 'note.watch', notebookId: 'nb3' },
            { type: 'note.unwatch', notebookId: 'nb2' }
        ]);
    });

    it('sends a join two readers hold once, and its leave with the last of them', () => {
        const sockets = fakeSockets();
        const join = ['note.watch', { notebookId: 'nb1' }, 'note.unwatch'] as const;
        const first = renderHook(() => useChannel(noteGateway, {}, { join }));
        const second = renderHook(() => useChannel(noteGateway, {}, { join }));
        const third = renderHook(() => useChannel(noteGateway, {}));
        act(() => sockets.last.open());

        first.unmount();
        expect(sockets.last.sent).toEqual([{ type: 'note.watch', notebookId: 'nb1' }]);
        second.unmount();

        expect(sockets.last.sent).toEqual([{ type: 'note.watch', notebookId: 'nb1' }, { type: 'note.unwatch', notebookId: 'nb1' }]);
        third.unmount();
    });

    it('sends no leave for a join that names none', () => {
        const sockets = fakeSockets();
        const keeper = renderHook(() => useChannel(noteGateway, {}));
        const watcher = renderHook(() => useChannel(noteGateway, {}, { join: ['note.watch', { notebookId: 'nb1' }] }));
        act(() => sockets.last.open());

        watcher.unmount();

        expect(sockets.last.sent).toEqual([{ type: 'note.watch', notebookId: 'nb1' }]);
        keeper.unmount();
    });
});

describe('useChannel and the session', () => {
    afterEach(() => {
        session.end();
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it('reconnects with the new token when the session changes, and joins again', () => {
        const sockets = fakeSockets();
        session.start('token-a');
        renderHook(() => useChannel(noteGateway, {}, { join: ['note.watch', { notebookId: 'nb1' }] }));
        act(() => sockets.last.open());

        act(() => session.start('token-b'));
        act(() => sockets.last.open());

        expect(sockets.opened.map((socket) => [socket.protocol, socket.readyState])).toEqual([['token-a', 3], ['token-b', 1]]);
        expect(sockets.last.sent).toEqual([{ type: 'note.watch', notebookId: 'nb1' }]);
    });

    it('reconnects without a token when the session ends', () => {
        const sockets = fakeSockets();
        session.start('token-a');
        renderHook(() => useChannel(noteGateway, {}));
        act(() => sockets.last.open());

        act(() => session.end());

        expect(sockets.opened).toHaveLength(2);
        expect(sockets.last.protocol).toBeUndefined();
    });

    it('opens again for a new session once the gateway ended the last one', () => {
        vi.useFakeTimers();
        const sockets = fakeSockets();
        session.start('token-a');
        const { result } = renderHook(() => useChannel(noteGateway, {}));
        act(() => sockets.last.open());
        act(() => sockets.last.close(SocketClose.SessionExpired, 'session expired'));
        expect(result.current.status).toBe('closed');

        act(() => session.start('token-b'));
        act(() => sockets.last.open());

        expect(sockets.opened).toHaveLength(2);
        expect(result.current.status).toBe('open');
    });

    it('stays closed when the gateway refuses the socket, says why, and opens for a new session', () => {
        vi.useFakeTimers();
        const sockets = fakeSockets();
        session.start('token-a');
        const { result } = renderHook(() => useChannel(noteGateway, {}));
        act(() => sockets.last.open());

        act(() => sockets.last.close(SocketClose.Forbidden, 'Team::NotMember'));
        act(() => vi.advanceTimersByTime(20_000));

        expect(result.current).toMatchObject({ status: 'closed', lastError: 'Team::NotMember' });
        expect(session.token).toBe('token-a');
        expect(sockets.opened).toHaveLength(1);

        act(() => session.start('token-b'));
        expect(sockets.opened).toHaveLength(2);
    });

    it('keeps backing off from a refusal it may retry, though the socket opened for an instant', () => {
        vi.useFakeTimers();
        vi.spyOn(Math, 'random').mockReturnValue(1);
        const sockets = fakeSockets();
        renderHook(() => useChannel(noteGateway, {}));
        const refused = () => act(() => {
            sockets.last.open();
            sockets.last.close(4429, 'RateLimit::TooManyRequests');
        });

        refused();
        act(() => vi.advanceTimersByTime(500));
        expect(sockets.opened).toHaveLength(2);
        refused();
        act(() => vi.advanceTimersByTime(999));
        expect(sockets.opened).toHaveLength(2);
        act(() => vi.advanceTimersByTime(1));

        expect(sockets.opened).toHaveLength(3);
    });

    it('closes for good once its last reader is gone, whatever the session does', () => {
        const sockets = fakeSockets();
        const { unmount } = renderHook(() => useChannel(noteGateway, {}));
        unmount();

        act(() => session.start('token-b'));

        expect(sockets.opened).toHaveLength(1);
        expect(channels.peek(noteGateway.channel)).toBeUndefined();
    });
});

describe('useChannel types', () => {
    it('types requests, answers and leaves by the gateway', () => {
        const typed = () => {
            const channel = useChannel(noteGateway, {}, {
                // @ts-expect-error the answer to a confirm is a confirm message
                answers: { 'note.confirm': () => ({ no: true }) },
                // @ts-expect-error a typing message takes another payload than a watch
                join: ['note.watch', { notebookId: 'nb1' }, 'note.typing']
            });
            const notes: Promise<{ id: string; title: string }[]> = channel.request('note.watch', { notebookId: 'nb1' });
            // @ts-expect-error the gateway takes no such message
            void channel.request('note.leave', {});
            return notes;
        };

        expect(typed).toBeTypeOf('function');
    });
});
