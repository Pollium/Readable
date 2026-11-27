import { RedisTransport } from '../lib/events/RedisTransport';
import { TEST_REDIS } from './env';
import { expect, it } from 'vitest';

// A second channel subscribed while the new connection is still checked used to fail ioredis's
// ready check and lose the subscription; each delay below lands it at a different point of the connect.
it('hears every channel subscribed while its connection is still being opened', async () => {
    for(let attempt = 0; attempt < 40; attempt++){
        const transport = new RedisTransport({ ...TEST_REDIS });
        const heard: string[] = [];
        const first = transport.subscribe(`race-a-${attempt}`, (message) => heard.push(message));
        await new Promise((resolve) => setTimeout(resolve, attempt % 10));
        await Promise.all([first, transport.subscribe(`race-b-${attempt}`, (message) => heard.push(message))]);
        const publisher = new RedisTransport({ ...TEST_REDIS });
        await publisher.publish(`race-a-${attempt}`, 'a');
        await publisher.publish(`race-b-${attempt}`, 'b');
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(heard.sort()).toEqual(['a', 'b']);
        await transport.close();
        await publisher.close();
    }
});
