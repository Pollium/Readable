import 'reflect-metadata';
import Application from '../lib/app/Application';
import BaseController, { Route } from '../lib/http/Controller';
import BaseGateway, { Channel, OnMessage } from '../lib/gateway/Gateway';
import { ModuleDiscovery } from '../lib/app/discovery';
import { RuntimeError } from '../lib/app/errors';
import { configure } from '../lib/app/config';
import { Middleware } from '../lib/http/middleware';
import { Authenticate, configureAuthentication } from '../lib/auth/authentication';
import { CurrentPrincipal, CurrentUser, SessionExpiresAt, Token } from '../lib/auth/params';
import { JWTService, Principal, sessionCutoffs } from '../lib/auth/sessions';
import {
    AuthenticatedRoute,
    OptionalAuthenticatedRoute,
    ParamGuardRoute,
    SocketAuthenticatedRoute,
    SocketOptionalAuthenticatedRoute,
    bearerPrincipal
} from '../lib/auth/guards';
import { request, route } from '../lib/testing/request';
import websocket, { WebSocket } from '@fastify/websocket';
import Fastify, { FastifyInstance, FastifyRequest } from 'fastify';
import { afterEach, beforeAll, beforeEach, describe, expect, expectTypeOf, it, vi } from 'vitest';
import { TEST_REDIS } from './env';

declare module '../lib/auth/sessions'{
    interface Principal{
        authType?: 'user' | 'secretKey';
        teamPermissions?: string[];
    }
}

const TEAM_ID = '019ca945-0a00-7000-8000-010000000000';
const SECRET_KEY = 'vsk_live_1';

const secretKeys: Authenticate = async (token) => {
    if(token === 'vsk_revoked') throw new RuntimeError('SecretKey::Revoked', 401);
    if(token !== SECRET_KEY) return null;

    return { userId: 'creator-1', authType: 'secretKey', teamPermissions: ['trajectory:read'] };
};

class ProbeController extends BaseController{
    @Route('/me')
    @Middleware(AuthenticatedRoute)
    me(@CurrentPrincipal() principal: Principal, @CurrentUser() userId: string, @Token() token: string){
        return { principal, userId, token };
    }

    @Route('/expiry')
    @Middleware(AuthenticatedRoute)
    expiry(@SessionExpiresAt() expiresAt: number){
        return { expiresAt };
    }

    @Route('/canvas')
    @Middleware(OptionalAuthenticatedRoute)
    canvas(@CurrentPrincipal() principal: Principal | undefined, @Token() token: string | undefined){
        return { principal: principal ?? null, token: token ?? null };
    }

    @Route('/teams/:teamId')
    @Middleware(ParamGuardRoute('teamId', async (_teamId, userId) => {
        if(userId !== 'creator-1') throw new RuntimeError('Team::NotAMember', 403);
    }))
    team(@CurrentPrincipal() principal: Principal){
        return principal;
    }

    @Route('/socket-guard')
    @Middleware(SocketAuthenticatedRoute)
    socketGuard(@CurrentPrincipal() principal: Principal, @Token() token: string){
        return { principal, token };
    }

    @Route('/socket-optional')
    @Middleware(SocketOptionalAuthenticatedRoute)
    socketOptional(@CurrentPrincipal() principal: Principal | undefined){
        return { principal: principal ?? null };
    }
}

const apps: FastifyInstance[] = [];

const mounted = async () => {
    const app = Fastify();
    apps.push(app);
    await new ProbeController().register(app, '');

    return app;
};

const get = async (url: string, headers: Record<string, string> = {}) => (await mounted()).inject({ method: 'GET', url, headers });

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

beforeAll(() => {
    configure({ name: 'readable', jwtSecret: 'test-jwt-secret', redis: TEST_REDIS, storage: null });
});

beforeEach(() => {
    vi.spyOn(sessionCutoffs, 'cutoffOf').mockResolvedValue(null);
});

afterEach(async () => {
    configureAuthentication();
    vi.restoreAllMocks();
    await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('the default authenticate', () => {
    it('signs a Readable session in, with its principal, raw token and expiry', async () => {
        const token = new JWTService().sign('user-1');

        const me = await get('/me', bearer(token));
        const expiry = await get('/expiry', bearer(token));

        expect(me.json()).toEqual({ data: { principal: { userId: 'user-1' }, userId: 'user-1', token } });
        expect(expiry.json().data.expiresAt).toBe(new JWTService().verify(token).exp);
    });

    it('refuses no token and a bad one as before', async () => {
        expect((await get('/me')).json()).toMatchObject({ message: 'Auth::Unauthorized' });
        expect((await get('/me', bearer('nope'))).json()).toMatchObject({ message: 'Auth::InvalidToken' });
        expect((await get('/me', bearer(''))).json()).toMatchObject({ message: 'Auth::InvalidToken' });
    });
});

describe('an app\'s own authenticate', () => {
    beforeEach(() => {
        configureAuthentication({ authenticate: secretKeys });
    });

    it('decides the principal, with the fields the app added to it', async () => {
        const res = await get('/me', bearer(SECRET_KEY));

        expect(res.json()).toEqual({
            data: {
                principal: { userId: 'creator-1', authType: 'secretKey', teamPermissions: ['trajectory:read'] },
                userId: 'creator-1',
                token: SECRET_KEY
            }
        });
        expectTypeOf<Principal['authType']>().toEqualTypeOf<'user' | 'secretKey' | undefined>();
    });

    it('answers a token it does not know with Auth::InvalidToken, and its own refusal with its own code', async () => {
        const unknown = await get('/me', bearer(new JWTService().sign('user-1')));
        const revoked = await get('/me', bearer('vsk_revoked'));

        expect(unknown.statusCode).toBe(401);
        expect(unknown.json()).toMatchObject({ message: 'Auth::InvalidToken' });
        expect(revoked.statusCode).toBe(401);
        expect(revoked.json()).toMatchObject({ message: 'SecretKey::Revoked' });
    });

    it('signs ParamGuardRoute in too', async () => {
        const res = await get(`/teams/${TEAM_ID}`, bearer(SECRET_KEY));

        expect(res.json()).toMatchObject({ data: { userId: 'creator-1', authType: 'secretKey' } });
    });

    it('resolves bearerPrincipal without signing the request in', async () => {
        const req = { headers: bearer(SECRET_KEY) } as unknown as FastifyRequest;

        await expect(bearerPrincipal(req)).resolves.toMatchObject({ userId: 'creator-1' });
        await expect(bearerPrincipal({ headers: {} } as FastifyRequest)).resolves.toBeNull();
        expect(req.principal).toBeUndefined();
    });
});

describe('OptionalAuthenticatedRoute', () => {
    beforeEach(() => {
        configureAuthentication({ authenticate: secretKeys });
    });

    it('lets a caller with no token in, with no principal', async () => {
        expect((await get('/canvas')).json()).toEqual({ data: { principal: null, token: null } });
    });

    it('signs a good token in', async () => {
        expect((await get('/canvas', bearer(SECRET_KEY))).json()).toMatchObject({
            data: { principal: { userId: 'creator-1' }, token: SECRET_KEY }
        });
    });

    it('refuses a bad token instead of treating it as none', async () => {
        const res = await get('/canvas', bearer('vsk_unknown'));

        expect(res.statusCode).toBe(401);
        expect(res.json()).toMatchObject({ message: 'Auth::InvalidToken' });
    });
});

describe('the socket guards', () => {
    beforeEach(() => {
        configureAuthentication({ authenticate: secretKeys });
    });

    it('read the token from the subprotocol first, then from ?token=', async () => {
        const fromProtocol = await get('/socket-guard?token=vsk_unknown', { 'sec-websocket-protocol': `${SECRET_KEY}, json` });
        const fromQuery = await get(`/socket-guard?token=${SECRET_KEY}`);

        expect(fromProtocol.json()).toMatchObject({ data: { principal: { userId: 'creator-1' }, token: SECRET_KEY } });
        expect(fromQuery.json()).toMatchObject({ data: { token: SECRET_KEY } });
    });

    it('refuse no token, and a bad one', async () => {
        expect((await get('/socket-guard')).json()).toMatchObject({ message: 'Auth::Unauthorized' });
        expect((await get('/socket-guard?token=nope')).json()).toMatchObject({ message: 'Auth::InvalidToken' });
        expect((await get(`/socket-guard?token=${SECRET_KEY}&token=${SECRET_KEY}`)).json()).toMatchObject({ message: 'Auth::Unauthorized' });
    });

    it('let a socket with no token in when optional, and still refuse a bad one', async () => {
        expect((await get('/socket-optional')).json()).toEqual({ data: { principal: null } });
        expect((await get(`/socket-optional?token=${SECRET_KEY}`)).json()).toMatchObject({ data: { principal: { userId: 'creator-1' } } });
        expect((await get('/socket-optional?token=nope')).statusCode).toBe(401);
    });

    it('hand a gateway the principal of an optional connection', async () => {
        @Channel('/canvas/live')
        @Middleware(SocketOptionalAuthenticatedRoute)
        class CanvasGateway extends BaseGateway{
            @OnMessage('whoami')
            whoami(@CurrentPrincipal() principal: Principal | undefined){
                return { userId: principal?.userId ?? null };
            }
        }

        const app = Fastify();
        apps.push(app);
        await app.register(websocket);
        new CanvasGateway().register(app);
        await app.ready();

        const replies = async (headers: Record<string, string>) => {
            const received: string[] = [];
            const socket: WebSocket = await app.injectWS('/canvas/live', { headers }, {
                onInit: (ws) => ws.on('message', (raw) => received.push(String(raw)))
            });
            socket.send(JSON.stringify({ type: 'whoami' }));
            await expect.poll(() => received.length).toBe(1);
            socket.terminate();

            return JSON.parse(received[0]!) as unknown;
        };

        await expect(replies({ 'sec-websocket-protocol': SECRET_KEY })).resolves.toEqual({ type: 'whoami', data: { userId: 'creator-1' } });
        await expect(replies({})).resolves.toEqual({ type: 'whoami', data: { userId: null } });
    });
});

describe('an app built with authenticate and signTestToken', () => {
    it('signs request(app, endpoint, { as }) the app\'s way', async () => {
        const authenticate = vi.fn<Authenticate>(async (token) => token.startsWith('session:') ? { userId: token.slice(8) } : null);
        const application = new Application({
            port: 0,
            corsOrigins: [],
            log: { level: 'silent', pretty: false },
            authenticate,
            signTestToken: async (userId) => `session:${userId}`,
            discover: async () => ModuleDiscovery.merge([{
                controllers: [{ prefix: '', Controller: ProbeController }],
                entities: [], events: [], queues: [], gateways: [], tools: []
            }])
        });
        const app = await application.build({ queues: false });

        const res = await request(app, route('GET', '/me'), { as: 'user-7' });

        expect(res.json()).toMatchObject({ data: { userId: 'user-7', token: 'session:user-7' } });
        expect(authenticate).toHaveBeenCalledWith('session:user-7', expect.anything());
        await application.stop();
    });
});
