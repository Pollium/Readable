import 'reflect-metadata';
import BaseGateway, { Channel, Connection, OnMessage, Payload } from '../lib/gateway/Gateway';
import { configure } from '../lib/app/config';
import { createRedis } from '../lib/app/redis';
import { closeServed, nextFrame, opened, Peer, serve } from './support/live';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_REDIS } from './env';

configure({ name: 'readable-rooms', jwtSecret: null, redis: TEST_REDIS, storage: null });

const TOPIC = 'readable-rooms:gateway:/stage';

@Channel('/stage')
class StageGateway extends BaseGateway{
    @OnMessage('enter')
    enter(@Connection() connection: Connection, @Payload() payload: { room: string }){
        this.connections.join(connection, payload.room);
        return { entered: payload.room };
    }

    @OnMessage('say')
    async say(@Connection() connection: Connection, @Payload() payload: { room: string; text: string; quietly?: boolean }){
        await this.toRoom(payload.room, { type: 'said', data: payload.text }, payload.quietly === true ? { except: connection } : {});
        return { said: true };
    }
}

const relaying = async () => {
    const redis = createRedis();
    try{
        await expect.poll(async () => (await redis.pubsub('NUMSUB', TOPIC))[1]).toBeGreaterThanOrEqual(1);
    }finally{
        await redis.quit();
    }
};

const entered = async (client: Peer, room: string) => {
    client.send({ type: 'enter', room });
    await nextFrame(client);
};

const heard = (client: Peer) => client.frames().filter((frame) => frame.type === 'said').map((frame) => frame.data);

const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

afterEach(closeServed);

describe('a room send', () => {
    it('reaches the room\'s members on every instance, once each', async () => {
        const [one, two] = await Promise.all([serve([StageGateway]), serve([StageGateway])]);
        const ana = await opened(one.url('/stage'));
        const ben = await opened(two.url('/stage'));
        const cai = await opened(two.url('/stage'));
        await entered(ana, 'stage:1');
        await entered(ben, 'stage:1');
        await entered(cai, 'stage:2');
        await relaying();

        ana.send({ type: 'say', room: 'stage:1', text: 'hola' });

        await expect.poll(() => heard(ben)).toEqual(['hola']);
        await settle();
        expect(heard(ana)).toEqual(['hola']);
        expect(heard(cai)).toEqual([]);
    });

    it('from an instance with no member there still reaches the others', async () => {
        const [one, two] = await Promise.all([serve([StageGateway]), serve([StageGateway])]);
        const ana = await opened(one.url('/stage'));
        const ben = await opened(two.url('/stage'));
        await entered(ben, 'stage:1');
        await relaying();

        ana.send({ type: 'say', room: 'stage:1', text: 'from afar' });

        await expect.poll(() => heard(ben)).toEqual(['from afar']);
        expect(heard(ana)).toEqual([]);
    });

    it('skips the connection it is told to skip, on every instance', async () => {
        const [one, two] = await Promise.all([serve([StageGateway]), serve([StageGateway])]);
        const ana = await opened(one.url('/stage'));
        const bea = await opened(one.url('/stage'));
        const ben = await opened(two.url('/stage'));
        for(const client of [ana, bea, ben]) await entered(client, 'stage:1');
        await relaying();

        ana.send({ type: 'say', room: 'stage:1', text: 'not to me', quietly: true });

        await expect.poll(() => heard(ben)).toEqual(['not to me']);
        await expect.poll(() => heard(bea)).toEqual(['not to me']);
        await settle();
        expect(heard(ana)).toEqual([]);
    });
});
