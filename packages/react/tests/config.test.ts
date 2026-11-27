import { configure, settings } from '../lib/app/config';
import { call } from '../lib/http/call';
import { fakeApi } from './support/fake-api';
import { noteRoutes } from './support/notes';
import { describe, expect, it } from 'vitest';

describe('configure', () => {
    it('keeps the api url without its trailing slash', () => {
        expect(settings()).toMatchObject({ name: 'notes', apiUrl: 'http://api.test', copy: null });
    });

    it('keeps the session under <name>.session, with no old keys to move', () => {
        expect(settings()).toMatchObject({ sessionKey: 'notes.session', legacyKeys: [] });
    });

    it('times nothing out, changes no request, fills no path and leaves credentials to the browser by default', () => {
        expect(settings()).toMatchObject({ timeoutMs: 0, credentials: undefined, onRequest: null, pathDefaults: null });
    });

    it('calls the api under /api of the page when no url is given', () => {
        configure({ name: 'notes', apiUrl: ' ' });

        expect(settings().apiUrl).toBe(`${window.location.origin}/api`);
    });

    it('reads an api url given as a function on every call', async () => {
        const api = fakeApi();
        api.on('GET', '/me', { body: { data: { id: 'u1' } } });
        let backend = 'http://one.test/';
        configure({ name: 'notes', apiUrl: () => backend });

        await call(noteRoutes.me);
        backend = 'http://two.test';
        await call(noteRoutes.me);

        expect(api.sent.map((sent) => sent.url.origin)).toEqual(['http://one.test', 'http://two.test']);
        expect(settings().apiUrl).toBe('http://two.test');
    });

    it('falls back to /api of the page when the function has no url', () => {
        configure({ name: 'notes', apiUrl: () => null });

        expect(settings().apiUrl).toBe(`${window.location.origin}/api`);
    });
});
