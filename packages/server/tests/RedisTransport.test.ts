import { RedisTransport } from '../lib/events/RedisTransport';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it, vi } from 'vitest';
import { TEST_REDIS } from './env';

const instances = [new RedisTransport(TEST_REDIS), new RedisTransport(TEST_REDIS)];

afterAll(() => Promise.all(instances.map((instance) => instance.close())));

describe('RedisTransport', () => {
    it('delivers what one instance publishes to every instance listening on the channel', async () => {
        const channel = `transport-test-${randomUUID()}`;
        const heard: string[][] = [[], []];
        await Promise.all(instances.map((instance, at) => instance.subscribe(channel, (message) => heard[at].push(message))));

        await instances[0].publish(channel, 'hello');

        await vi.waitFor(() => expect(heard).toEqual([['hello'], ['hello']]));
    });

    it('connects again when it is used after being closed', async () => {
        const channel = `transport-test-${randomUUID()}`;
        const [instance] = instances;
        await instance.close();
        const heard: string[] = [];

        await instance.subscribe(channel, (message) => heard.push(message));
        await instance.publish(channel, 'again');

        await vi.waitFor(() => expect(heard).toEqual(['again']));
    });
});
