import { configure } from '../lib/app/config';
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

    it('keeps the token under the key the app names', () => {
        configure({ name: 'notes', sessionKey: 'notes.token' });

        session.start('token-a');

        expect(localStorage.getItem('notes.token')).toBe('token-a');
        expect(localStorage.getItem('notes.session')).toBeNull();
    });

    it('moves a token kept under an old key once, and empties the old keys', () => {
        localStorage.setItem('authToken', 'token-old');
        localStorage.setItem('jwt', 'token-older');
        configure({ name: 'notes', legacyKeys: ['authToken', 'jwt'] });

        expect(session.token).toBe('token-old');
        expect(localStorage.getItem('notes.session')).toBe('token-old');
        expect(localStorage.getItem('authToken')).toBeNull();
        expect(localStorage.getItem('jwt')).toBeNull();
    });

    it('signs out for good after a moved token ends', () => {
        localStorage.setItem('authToken', 'token-old');
        configure({ name: 'notes', legacyKeys: ['authToken'] });
        expect(session.token).toBe('token-old');

        session.end();
        configure({ name: 'notes', sessionKey: 'other.session', legacyKeys: ['authToken'] });
        configure({ name: 'notes', legacyKeys: ['authToken'] });

        expect(session.token).toBeNull();
    });

    it('keeps its own token over one under an old key', () => {
        localStorage.setItem('notes.session', 'token-new');
        localStorage.setItem('authToken', 'token-old');
        configure({ name: 'notes', legacyKeys: ['authToken'] });

        expect(session.token).toBe('token-new');
        expect(localStorage.getItem('authToken')).toBe('token-old');
    });

    it('hears another tab under the key the app names', () => {
        configure({ name: 'notes', sessionKey: 'notes.token' });
        session.start('token-a');

        window.dispatchEvent(new StorageEvent('storage', { key: 'notes.session', oldValue: 'token-a', newValue: null }));
        expect(session.token).toBe('token-a');

        window.dispatchEvent(new StorageEvent('storage', { key: 'notes.token', oldValue: 'token-a', newValue: null }));
        expect(session.token).toBeNull();
    });
});
