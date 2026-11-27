import 'reflect-metadata';
import BaseGateway, { Channel, OnConnect } from '../lib/gateway/Gateway';
import { SocketAuthenticatedRoute } from '../lib/auth/guards';
import { JWTService, sessionCutoffs } from '../lib/auth/sessions';
import { RuntimeError } from '../lib/app/errors';
import { configure } from '../lib/app/config';
import { Middleware, MiddlewareFn } from '../lib/http/middleware';
import { closeServed, opened, peer, serve } from './support/live';
import { SocketClose } from '@pollium/readable-contracts/gateway';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TEST_REDIS } from './env';

configure({ name: 'readable', jwtSecret: 'test-jwt-secret', redis: TEST_REDIS, storage: null });

const connected: string[] = [];

const NotMember: MiddlewareFn = async () => {
    throw new RuntimeError('Team::NotMember', 403);
};

const Broken: MiddlewareFn = async () => {
    throw new Error('the database is down');
};

@Channel('/strict')
@Middleware(SocketAuthenticatedRoute)
class StrictGateway extends BaseGateway{}

@Channel('/signed', { refusal: 'close' })
@Middleware(SocketAuthenticatedRoute)
class SignedGateway extends BaseGateway{
    @OnConnect()
    connect(){
        connected.push('signed');
    }
}

@Channel('/team', { refusal: 'close' })
@Middleware(NotMember)
class TeamGateway extends BaseGateway{
    @OnConnect()
    connect(){
        connected.push('team');
    }
}

@Channel('/broken', { refusal: 'close' })
@Middleware(Broken)
class BrokenGateway extends BaseGateway{}

beforeEach(() => {
    connected.splice(0);
    vi.spyOn(sessionCutoffs, 'cutoffOf').mockResolvedValue(null);
});

afterEach(async () => {
    vi.restoreAllMocks();
    await closeServed();
});

describe('a channel that closes the sockets it refuses', () => {
    it('closes one without a token with 4401 and the error code', async () => {
        const { url } = await serve([SignedGateway]);
        const client = peer(url('/signed'));

        await expect(client.closed).resolves.toEqual({ code: SocketClose.Unauthenticated, reason: 'Auth::Unauthorized' });
        expect(connected).toEqual([]);
    });

    it('closes one with a token it cannot verify with 4401 and the error code', async () => {
        const { url } = await serve([SignedGateway]);
        const client = peer(url('/signed'), 'not-a-token');

        await expect(client.closed).resolves.toEqual({ code: SocketClose.Unauthenticated, reason: 'Auth::InvalidToken' });
    });

    it('closes one its guard forbids with 4403 and the error code', async () => {
        const { url } = await serve([TeamGateway]);
        const client = peer(url('/team'));

        await expect(client.closed).resolves.toEqual({ code: SocketClose.Forbidden, reason: 'Team::NotMember' });
        expect(connected).toEqual([]);
    });

    it('closes one its guard failed on with 4500, without the failure text', async () => {
        const { url } = await serve([BrokenGateway]);
        const client = peer(url('/broken'));

        await expect(client.closed).resolves.toEqual({ code: 4500, reason: 'Gateway::Internal' });
    });

    it('lets a socket its guard admits in', async () => {
        const { url } = await serve([SignedGateway]);
        const client = await opened(url('/signed'), new JWTService().sign('user-1'));

        await expect.poll(() => connected).toEqual(['signed']);
        expect(client.socket.readyState).toBe(WebSocket.OPEN);
    });
});

describe('a channel left as it was', () => {
    it('still refuses the upgrade itself', async () => {
        const { url } = await serve([StrictGateway]);
        const client = peer(url('/strict'));

        await expect(client.opened).rejects.toThrow('did not open');
        expect((await client.closed).code).toBe(1006);
    });
});
