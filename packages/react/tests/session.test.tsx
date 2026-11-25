import { session, useSession } from '../lib/session/session';
import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

describe('session', () => {
    afterEach(() => session.end());

    it('keeps the token for the next visit', () => {
        session.start('token-a');

        expect(localStorage.getItem('notes.session')).toBe('token-a');
        expect(session.token).toBe('token-a');
    });

    it('renders again when the session starts and ends', () => {
        const { result } = renderHook(() => useSession());

        act(() => session.start('token-a'));
        expect(result.current).toBe('token-a');

        act(() => session.end());
        expect(result.current).toBeNull();
        expect(localStorage.getItem('notes.session')).toBeNull();
    });

    it('tells what depends on the session that it ended', () => {
        const ended = vi.fn();
        const off = session.onEnd(ended);
        session.start('token-a');

        session.end();
        session.end();
        off();

        expect(ended).toHaveBeenCalledTimes(1);
    });

    it('keeps a newer session when an older token is ended', () => {
        session.start('token-a');
        session.start('token-b');

        session.end('token-a');

        expect(session.token).toBe('token-b');
    });

    it('ends here when another tab signs out', () => {
        const ended = vi.fn();
        const off = session.onEnd(ended);
        session.start('token-a');

        window.dispatchEvent(new StorageEvent('storage', { key: 'notes.session', oldValue: 'token-a', newValue: null }));
        off();

        expect(session.token).toBeNull();
        expect(ended).toHaveBeenCalledOnce();
    });
});
