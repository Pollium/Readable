import 'reflect-metadata';
import BaseGateway, { Channel, Connection, OnConnect, OnDisconnect, OnMessage, Payload, Socket } from '../lib/gateway/Gateway';
import Application from '../lib/app/Application';
import { ModuleDiscovery } from '../lib/app/discovery';
import { AuthError } from '../lib/app/errors';
import { configure } from '../lib/app/config';
import { Middleware, MiddlewareFn } from '../lib/http/middleware';
import { CurrentUser } from '../lib/auth/params';
import { closeServed, nextFrame, opened, serve } from './support/live';
import { WebSocket } from '@fastify/websocket';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TEST_REDIS } from './env';

configure({ name: 'readable', jwtSecret: null, redis: TEST_REDIS, storage: null });

interface Seat{
    seat?: string;
}

const seen: string[] = [];

// Signs a socket in as the name it asks for, so a test can tell connections apart.
const Named: MiddlewareFn = async (req) => {
    const name = (req.query as { name?: string }).name;
    if(name === undefined) throw AuthError.Unauthorized();
    req.principal = { userId: name };
};

const Listed: MiddlewareFn = async (req) => {
    seen.push(`listed:${req.principal?.userId}`);
};

@Channel('/hall')
@Middleware(Named)
class HallGateway extends BaseGateway{
    @OnConnect()
    connected(@Connection() connection: Connection<Seat>){
        seen.push(`hall:connect:${connection.principal?.userId}`);
    }

    @OnDisconnect()
    disconnected(@Connection() connection: Connection<Seat>){
        seen.push(`hall:disconnect:${connection.principal?.userId}`);
    }

    @OnMessage('sit')
    sit(@Connection() connection: Connection<Seat>, @Payload() payload: { seat: string }){
        connection.data.seat = payload.seat;
        this.connections.join(connection, `row:${payload.seat[0]}`);
        return { id: connection.id };
    }

    @OnMessage('row')
    row(@Payload() payload: { row: string }, @Socket() socket: WebSocket, @Connection() connection: Connection){
        const room = `row:${payload.row}`;
        return {
            members: this.connections.members(room).map((member) => ({
                user: member.principal?.userId,
                seat: (member.data as Seat).seat
            })),
            here: this.connections.isIn(socket, room),
            hereById: this.connections.isIn(connection.id, room),
            rooms: this.connections.roomsOf(connection)
        };
    }

    @OnMessage('whisper')
    whisper(@Payload() payload: { to: string; text: string }){
        return { delivered: this.connections.sendTo(payload.to, { type: 'whispered', data: payload.text }) };
    }

    @OnMessage('shout')
    shout(@Connection() connection: Connection, @Payload() payload: { row: string; text: string }){
        this.connections.sendToRoomExcept(`row:${payload.row}`, connection, { type: 'shouted', data: payload.text });
    }
}

@Channel('/hall')
@Middleware(Named, Listed)
class TicketGateway extends BaseGateway{
    @OnConnect()
    connected(@CurrentUser() userId: string){
        seen.push(`ticket:connect:${userId}`);
    }

    @OnDisconnect()
    disconnected(@CurrentUser() userId: string){
        seen.push(`ticket:disconnect:${userId}`);
    }

    @OnMessage('ticket')
    ticket(@Connection() connection: Connection<Seat>){
        return { seat: connection.data.seat ?? null, rooms: this.connections.roomsOf(connection) };
    }
}

@Channel('/hall')
class DuplicateGateway extends BaseGateway{
    @OnMessage('ticket')
    ticket(){
        return null;
    }
}

const boots = (gateways: Array<new () => BaseGateway>) => new Application({
    port: 0,
    corsOrigins: [],
    log: { level: 'silent', pretty: false },
    discover: async () => ({ ...ModuleDiscovery.merge([]), gateways })
}).build({ queues: false });

beforeEach(() => {
    seen.splice(0);
});

afterEach(closeServed);

describe('a gateway connection', () => {
    it('has an id, the principal its guard set, and data its handlers keep', async () => {
        const { url } = await serve([HallGateway]);
        const ana = await opened(url('/hall?name=ana'));

        ana.send({ type: 'sit', id: 1, seat: 'a1' });
        const { data } = await nextFrame(ana);
        ana.send({ type: 'row', id: 2, row: 'a' });

        expect(data).toEqual({ id: expect.stringMatching(/^[0-9a-f-]{36}$/) });
        expect(await nextFrame(ana, 2)).toEqual({
            type: 'row',
            re: 2,
            data: { members: [{ user: 'ana', seat: 'a1' }], here: true, hereById: true, rooms: ['row:a'] }
        });
    });

    it('is reached by its id from anywhere in the gateway', async () => {
        const { url } = await serve([HallGateway]);
        const ana = await opened(url('/hall?name=ana'));
        const ben = await opened(url('/hall?name=ben'));

        ana.send({ type: 'sit', id: 1, seat: 'a1' });
        const { data } = await nextFrame(ana);
        ben.send({ type: 'whisper', id: 1, to: (data as { id: string }).id, text: 'psst' });
        ben.send({ type: 'whisper', id: 2, to: 'nobody', text: 'psst' });

        expect(await nextFrame(ana, 2)).toEqual({ type: 'whispered', data: 'psst' });
        await expect.poll(() => ben.frames()).toHaveLength(2);
        expect(ben.frames()).toEqual(expect.arrayContaining([
            { type: 'whisper', re: 1, data: { delivered: true } },
            { type: 'whisper', re: 2, data: { delivered: false } }
        ]));
    });

    it('sends to a room except the connection that spoke', async () => {
        const { url } = await serve([HallGateway]);
        const [ana, ben, cai] = await Promise.all(['ana', 'ben', 'cai'].map((name) => opened(url(`/hall?name=${name}`))));
        for(const [client, seat] of [[ana, 'a1'], [ben, 'a2'], [cai, 'b1']] as const){
            client.send({ type: 'sit', id: 1, seat });
            await nextFrame(client);
        }

        ana.send({ type: 'shout', row: 'a', text: 'hello row a' });

        expect(await nextFrame(ben, 2)).toEqual({ type: 'shouted', data: 'hello row a' });
        await new Promise((resolve) => setTimeout(resolve, 50));
        expect(ana.frames()).toHaveLength(1);
        expect(cai.frames()).toHaveLength(1);
    });
});

describe('gateways that share a channel', () => {
    it('share one connection and its data, each answering its own messages', async () => {
        const { url } = await serve([HallGateway, TicketGateway]);
        const ana = await opened(url('/hall?name=ana'));

        ana.send({ type: 'sit', id: 1, seat: 'b7' });
        await nextFrame(ana);
        ana.send({ type: 'ticket', id: 2 });

        expect(await nextFrame(ana, 2)).toEqual({ type: 'ticket', re: 2, data: { seat: 'b7', rooms: ['row:b'] } });
    });

    it('run every connect and disconnect handler, and every guard once', async () => {
        const { url } = await serve([HallGateway, TicketGateway]);
        const dan = await opened(url('/hall?name=dan'));
        const ofDan = () => seen.filter((entry) => entry.endsWith(':dan'));
        await expect.poll(ofDan).toHaveLength(3);

        dan.socket.close();

        await expect.poll(ofDan).toHaveLength(5);
        expect(ofDan().slice(0, 3)).toEqual(['listed:dan', 'hall:connect:dan', 'ticket:connect:dan']);
        expect(ofDan().slice(3).sort()).toEqual(['hall:disconnect:dan', 'ticket:disconnect:dan']);
    });

    it('stop the boot when two of them take the same message type', async () => {
        await expect(boots([TicketGateway, DuplicateGateway])).rejects.toThrow('Gateway::DuplicateMessageType:/hall:ticket');
    });
});
