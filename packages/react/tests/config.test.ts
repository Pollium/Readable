import { configure, settings } from '../lib/app/config';
import { describe, expect, it } from 'vitest';

describe('configure', () => {
    it('keeps the api url without its trailing slash', () => {
        expect(settings()).toEqual({ name: 'notes', apiUrl: 'http://api.test', copy: null });
    });

    it('calls the api under /api of the page when no url is given', () => {
        configure({ name: 'notes', apiUrl: ' ' });

        expect(settings().apiUrl).toBe(`${window.location.origin}/api`);
    });
});
