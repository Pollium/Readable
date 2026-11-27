import { describe, expect, it, vi } from 'vitest';

vi.mock('vitest/config', () => {
    throw new Error('readableConfig imported vitest/config');
});
vi.mock('vitest/node', () => {
    throw new Error('readableConfig imported vitest/node');
});

describe('readableConfig in a web without Vitest', () => {
    it('loads and gives its config', async () => {
        const { readableConfig } = await import('../lib/app/vite');

        expect(readableConfig({}, { root: '/web' }).resolve?.alias).toEqual({ '@': '/web/src' });
    });
});
