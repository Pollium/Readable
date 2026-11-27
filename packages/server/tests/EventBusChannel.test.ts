import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_REDIS } from './env';

const redis = vi.hoisted(() => ({
    status: 'ready',
    publish: vi.fn(),
    subscribe: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    quit: vi.fn()
}));

vi.mock('../lib/app/redis', () => ({ createRedis: () => redis }));

declare global{
    interface EventMap{
        'test.channel.named': { attempt: number };
    }
}

const remoteBusOf = async (name: string) => {
    vi.stubEnv('VITEST', undefined);
    vi.resetModules();
    const { configure } = await import('../lib/app/config');
    configure({ name, jwtSecret: null, redis: TEST_REDIS, storage: null });
    const { eventBus } = await import('../lib/events/EventBus');
    vi.unstubAllEnvs();

    return eventBus;
};

afterEach(() => {
    vi.clearAllMocks();
});

describe('eventBus channel', () => {
    it('publishes on the channel named after the app', async () => {
        const eventBus = await remoteBusOf('sentinel');

        eventBus.emit('test.channel.named', { attempt: 1 });

        expect(redis.publish).toHaveBeenCalledWith('sentinel:events', expect.any(String));
    });

    it('listens on the channel named after the app', async () => {
        const eventBus = await remoteBusOf('condor');

        eventBus.on('test.channel.named', () => undefined);

        expect(redis.subscribe).toHaveBeenCalledWith('condor:events');
    });
});
