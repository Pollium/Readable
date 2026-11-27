import 'reflect-metadata';
import BaseGateway, { Channel, Connection, OnConnect, OnMessage, Payload } from '../lib/gateway/Gateway';
import { RuntimeError } from '../lib/app/errors';
import { configure } from '../lib/app/config';
import { closeServed, nextFrame, opened, serve } from './support/live';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_REDIS } from './env';

configure({ name: 'readable', jwtSecret: null, redis: TEST_REDIS, storage: null });

const asked: Array<Promise<unknown>> = [];

@Channel('/ask')
class AskGateway extends BaseGateway{
    @OnMessage('echo')
    echo(@Payload() payload: { text: string }){
        return { text: payload.text };
    }

    @OnMessage('quiet')
    quiet(){
        return undefined;
    }

    @OnMessage('refuse')
    refuse(){
        throw new RuntimeError('Echo::Refused', 409);
    }

    @OnMessage('crash')
    crash(){
        throw new Error('database password is hunter2');
    }

    @OnMessage('ask.back')
    askBack(@Connection() connection: Connection, @Payload() payload: { timeoutMs?: number }){
        asked.push(connection.request('confirm', { question: 'sure?' }, { timeoutMs: payload.timeoutMs }));
    }
}

@Channel('/ask/on-connect')
class AskOnConnectGateway extends BaseGateway{
    @OnConnect()
    async connected(@Connection() connection: Connection){
        connection.data.greeting = await connection.request('hello', { at: 'connect' });
    }

    @OnMessage('greeting')
    greeting(@Connection() connection: Connection){
        return connection.data.greeting;
    }
}

afterEach(async () => {
    asked.splice(0).forEach((question) => question.catch(() => undefined));
    await closeServed();
});

describe('a client request', () => {
    it('is answered with its id and what its handler returns', async () => {
        const { url } = await serve([AskGateway]);
        const client = await opened(url('/ask'));

        client.send({ type: 'echo', id: 1, text: 'hola' });

        expect(await nextFrame(client)).toEqual({ type: 'echo', re: 1, data: { text: 'hola' } });
    });

    it('is answered even when its handler returns nothing', async () => {
        const { url } = await serve([AskGateway]);
        const client = await opened(url('/ask'));

        client.send({ type: 'quiet', id: 'q1' });

        expect(await nextFrame(client)).toEqual({ type: 'quiet', re: 'q1', data: null });
    });

    it('that fails is answered with its id and the error code', async () => {
        const { url } = await serve([AskGateway]);
        const client = await opened(url('/ask'));

        client.send({ type: 'refuse', id: 2, sessionId: 's-1' });
        client.send({ type: 'crash', id: 3 });
        client.send({ type: 'nope', id: 4 });

        await expect.poll(() => client.frames()).toHaveLength(3);
        expect(client.frames()).toEqual(expect.arrayContaining([
            { type: 'refuse', re: 2, error: 'Echo::Refused', sessionId: 's-1' },
            { type: 'crash', re: 3, error: 'Gateway::Internal' },
            { type: 'nope', re: 4, error: 'Gateway::UnknownMessageType' }
        ]));
    });

    it('leaves a message without an id answered as before', async () => {
        const { url } = await serve([AskGateway]);
        const client = await opened(url('/ask'));

        client.send({ type: 'quiet' });
        client.send({ type: 'echo', text: 'hola' });
        client.send({ type: 'refuse' });

        await expect.poll(() => client.frames()).toHaveLength(2);
        expect(client.frames()).toEqual(expect.arrayContaining([{ type: 'echo', data: { text: 'hola' } }, { error: 'Echo::Refused' }]));
    });
});

describe('a server request', () => {
    it('resolves with the data the client answers', async () => {
        const { url } = await serve([AskGateway]);
        const client = await opened(url('/ask'));

        client.send({ type: 'ask.back' });
        const question = await nextFrame(client);
        expect(question).toMatchObject({ type: 'confirm', data: { question: 'sure?' } });
        client.send({ type: 'confirm', re: question.id, data: { yes: true } });

        await expect(asked[0]).resolves.toEqual({ yes: true });
    });

    it('rejects with the error the client answers', async () => {
        const { url } = await serve([AskGateway]);
        const client = await opened(url('/ask'));

        client.send({ type: 'ask.back' });
        const question = await nextFrame(client);
        client.send({ type: 'confirm', re: question.id, error: 'Tool::Failed' });

        await expect(asked[0]).rejects.toMatchObject({ message: 'Tool::Failed' });
    });

    it('rejects with Gateway::Timeout when the client does not answer in time', async () => {
        const { url } = await serve([AskGateway]);
        const client = await opened(url('/ask'));

        client.send({ type: 'ask.back', timeoutMs: 50 });
        await nextFrame(client);

        await expect(asked[0]).rejects.toMatchObject({
            message: 'Gateway::Timeout',
            statusCode: 504
        });
    });

    it('rejects with Gateway::Closed when the socket closes first', async () => {
        const { url } = await serve([AskGateway]);
        const client = await opened(url('/ask'));

        client.send({ type: 'ask.back' });
        await nextFrame(client);
        client.socket.close();

        await expect(asked[0]).rejects.toMatchObject({ message: 'Gateway::Closed' });
    });

    it('is answered while a connect handler waits for it, and messages wait for that handler', async () => {
        const { url } = await serve([AskOnConnectGateway]);
        const client = await opened(url('/ask/on-connect'));

        client.send({ type: 'greeting', id: 1 });
        const hello = await nextFrame(client);
        expect(hello).toMatchObject({ type: 'hello', data: { at: 'connect' } });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(client.frames()).toHaveLength(1);

        client.send({ type: 'hello', re: hello.id, data: 'hi' });

        expect(await nextFrame(client, 2)).toEqual({ type: 'greeting', re: 1, data: 'hi' });
    });
});
