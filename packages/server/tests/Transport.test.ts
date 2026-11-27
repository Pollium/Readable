import { configure } from '../lib/app/config';
import { logger } from '../lib/app/logger';
import { broadcast } from '../lib/events/Broadcast';
import { eventBus } from '../lib/events/EventBus';
import { MemoryTransport } from '../lib/events/MemoryTransport';
import { RedisTransport } from '../lib/events/RedisTransport';
import { closeTransport, hasChosenTransport, transport, useTransport } from '../lib/events/transports';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TEST_REDIS } from './env';

declare global{
    interface EventMap{
        'test.transport.sent': { n: number };
    }
}

const received = () => {
    const messages: string[] = [];
    return { messages, listener: (message: string) => messages.push(message) };
};

describe('MemoryTransport', () => {
    it('delivers a message to every subscriber of its channel, the publisher included, and to no other', async () => {
        const memory = new MemoryTransport();
        const first = received();
        const second = received();
        const other = received();
        await memory.subscribe('notes', first.listener);
        await memory.subscribe('notes', second.listener);
        await memory.subscribe('other', other.listener);

        await memory.publish('notes', 'hello');

        await vi.waitFor(() => expect(first.messages).toEqual(['hello']));
        expect(second.messages).toEqual(['hello']);
        expect(other.messages).toEqual([]);
    });

    it('logs a listener that throws and keeps delivering to the others', async () => {
        const memory = new MemoryTransport();
        const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const failure = new Error('broken listener');
        const after = received();
        await memory.subscribe('notes', () => {
            throw failure;
        });
        await memory.subscribe('notes', after.listener);

        await memory.publish('notes', 'still');

        await vi.waitFor(() => expect(after.messages).toEqual(['still']));
        expect(error).toHaveBeenCalledWith('Transport::ListenerFailed:notes', failure);
        error.mockRestore();
    });

    it('forgets its subscribers when closed', async () => {
        const memory = new MemoryTransport();
        const listener = received();
        await memory.subscribe('notes', listener.listener);

        await memory.close();
        await memory.publish('notes', 'late');
        await new Promise((resolve) => setTimeout(resolve, 5));

        expect(listener.messages).toEqual([]);
    });
});

describe('the transport an app runs on', () => {
    afterEach(async () => {
        await closeTransport();
    });

    it('is Redis when the app has Redis, and one process when it has not', async () => {
        configure({ name: 'readable', jwtSecret: null, redis: TEST_REDIS, storage: null });
        expect(transport()).toBeInstanceOf(RedisTransport);
        await closeTransport();

        configure({ name: 'readable', jwtSecret: null, redis: null as never, storage: null });
        expect(transport()).toBeInstanceOf(MemoryTransport);
    });

    it('is the one the app chose, which stays chosen when it is closed', async () => {
        const chosen = new MemoryTransport();
        useTransport(chosen);

        await closeTransport();

        expect(transport()).toBe(chosen);
        expect(hasChosenTransport()).toBe(true);
    });
});

describe('the event bus and broadcast over a chosen transport', () => {
    const memory = new MemoryTransport();

    it('dispatches an event another instance sent, and its own only once', async () => {
        configure({ name: 'readable', jwtSecret: null, redis: null as never, storage: null });
        useTransport(memory);
        const handled = vi.fn();
        eventBus.on('test.transport.sent', handled);

        eventBus.emit('test.transport.sent', { n: 1 });
        await memory.publish('readable:events', JSON.stringify({ origin: 'another-instance', event: 'test.transport.sent', payload: { n: 2 } }));
        await vi.waitFor(() => expect(handled).toHaveBeenCalledTimes(2));
        await eventBus.settled();

        expect(handled.mock.calls.map(([payload]) => payload)).toEqual([{ n: 1 }, { n: 2 }]);
    });

    it('hands broadcast subscribers what was published, once each, after being closed and subscribed again', async () => {
        useTransport(memory);
        const before = vi.fn();
        broadcast.subscribe('room', before);
        await broadcast.close();
        const after = vi.fn();
        broadcast.subscribe('room', after);

        await broadcast.publish('room', { text: 'hi' });

        await vi.waitFor(() => expect(after).toHaveBeenCalledWith({ text: 'hi' }));
        expect(after).toHaveBeenCalledTimes(1);
        expect(before).not.toHaveBeenCalled();
    });
});
