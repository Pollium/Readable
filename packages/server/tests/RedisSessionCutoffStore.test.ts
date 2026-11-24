import 'reflect-metadata';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const get = vi.fn();
const set = vi.fn();

vi.mock('../lib/app/redis', () => ({
    redis: {
        get: (...args: unknown[]) => get(...args),
        set: (...args: unknown[]) => set(...args)
    }
}));

const { RedisSessionCutoffStore } = await import('../lib/auth/sessions');

describe('RedisSessionCutoffStore', () => {
    const store = new RedisSessionCutoffStore();

    beforeEach(() => {
        get.mockReset();
        set.mockReset();
    });

    it('keeps the cut for as long as a session it revokes could still be valid', async () => {
        vi.setSystemTime(new Date('2026-10-28T12:00:00Z'));

        await store.cut('user-1');

        expect(set).toHaveBeenCalledWith('session:cutoff:user-1', String(Date.parse('2026-10-28T12:00:00Z') / 1000), 'EX', 7 * 24 * 60 * 60);
        vi.useRealTimers();
    });

    it('cuts at the second another service cut the session', async () => {
        const at = Date.parse('2026-10-28T12:00:00Z') / 1000;

        await store.cut('user-1', at);

        expect(set).toHaveBeenCalledWith('session:cutoff:user-1', String(at), 'EX', 7 * 24 * 60 * 60);
    });

    it('reads no cut for an account that never cut its sessions', async () => {
        get.mockResolvedValue(null);

        await expect(store.cutoffOf('user-1')).resolves.toBeNull();
    });
});
