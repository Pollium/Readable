import 'reflect-metadata';
import { configure } from '../lib/app/config';
import { readable } from '../lib/app/readable';
import {
    JWTService,
    MemorySessionCutoffStore,
    RedisSessionCutoffStore,
    SESSION_TTL_SECONDS,
    SessionCutoffStore,
    sessionCutoffs,
    useSessionCutoffs,
    verifiedSession
} from '../lib/auth/sessions';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_REDIS } from './env';

const configured = (redis: typeof TEST_REDIS | null) => {
    configure({ name: 'readable', jwtSecret: 'test-jwt-secret', redis, storage: null });
};

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
});

describe('MemorySessionCutoffStore', () => {
    it('reads no cut for an account that never cut its sessions', async () => {
        await expect(new MemorySessionCutoffStore().cutoffOf('user-1')).resolves.toBeNull();
    });

    it('keeps a cut for as long as a session it revokes could still be valid', async () => {
        vi.useFakeTimers({ now: new Date('2026-10-28T12:00:00Z') });
        const store = new MemorySessionCutoffStore();

        await store.cut('user-1');
        await expect(store.cutoffOf('user-1')).resolves.toBe(Date.parse('2026-10-28T12:00:00Z') / 1000);

        vi.advanceTimersByTime(SESSION_TTL_SECONDS * 1000);
        await expect(store.cutoffOf('user-1')).resolves.toBeNull();
    });
});

describe('the session cutoffs an app reads', () => {
    it('live in memory when the app has no Redis, and refuse a token issued before the cut', async () => {
        configured(null);
        const jwt = new JWTService();
        const token = jwt.sign('user-1');

        await sessionCutoffs.cut('user-1', jwt.verify(token).iat + 1);

        await expect(verifiedSession(token)).rejects.toThrow('Auth::InvalidToken');
        await expect(verifiedSession(jwt.sign('user-2'))).resolves.toMatchObject({ sub: 'user-2' });
    });

    it('live in Redis when the app has it', async () => {
        configured(TEST_REDIS);
        const cutoffOf = vi.spyOn(RedisSessionCutoffStore.prototype, 'cutoffOf').mockResolvedValue(null);

        await sessionCutoffs.cutoffOf('user-1');

        expect(cutoffOf).toHaveBeenCalledWith('user-1');
    });

    it('live where readable({ sessionCutoffs }) says', async () => {
        const store: SessionCutoffStore = { cutoffOf: vi.fn().mockResolvedValue(null), cut: vi.fn().mockResolvedValue(undefined) };
        vi.stubEnv('PORT', '0');
        vi.stubEnv('DATABASE_URL', 'sqlite::memory:');
        vi.stubEnv('JWT_SECRET', 'test-jwt-secret');
        readable({ root: join(import.meta.dirname, 'fixtures/notes'), sessionCutoffs: store });

        await verifiedSession(new JWTService().sign('user-1'));
        await sessionCutoffs.cut('user-1', 10);

        expect(store.cutoffOf).toHaveBeenCalledWith('user-1');
        expect(store.cut).toHaveBeenCalledWith('user-1', 10);
        useSessionCutoffs(new MemorySessionCutoffStore());
    });
});
