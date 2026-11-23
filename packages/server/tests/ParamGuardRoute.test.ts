import BaseController, { Route } from '../lib/http/Controller';
import { RuntimeError } from '../lib/app/errors';
import { Middleware } from '../lib/http/middleware';
import { ParamGuardRoute } from '../lib/auth/guards';
import { JWTService, sessionCutoffs } from '../lib/auth/sessions';
import { configure } from '../lib/app/config';
import Fastify from 'fastify';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const MEMBER = 'user-1';
const STRANGER = 'user-2';
const TEAM_ID = '0192f0a4-5c3e-7000-8000-000000000001';

const assertMember = async (_teamId: string, userId: string) => {
    if(userId !== MEMBER) throw new RuntimeError('Team::NotAMember', 403);
};

class TeamController extends BaseController{
    @Route('/teams/:teamId')
    @Middleware(ParamGuardRoute('teamId', assertMember))
    show(){
        return { reached: true };
    }
}

const visit = async (headers: Record<string, string>) => {
    const app = Fastify();
    await new TeamController().register(app, '');
    const res = await app.inject({ method: 'GET', url: `/teams/${TEAM_ID}`, headers });
    await app.close();

    return res;
};

describe('ParamGuardRoute on its own', () => {
    const jwt = new JWTService();

    beforeAll(() => {
        configure({
            name: 'readable',
            jwtSecret: 'test-jwt-secret',
            redis: { host: 'localhost', port: 6379 },
            storage: null
        });
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it('lets a member with a valid token through', async () => {
        vi.spyOn(sessionCutoffs, 'cutoffOf').mockResolvedValue(null);

        const res = await visit({ authorization: `Bearer ${jwt.sign(MEMBER)}` });

        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ data: { reached: true } });
    });

    it('refuses a token holder who is not a member', async () => {
        vi.spyOn(sessionCutoffs, 'cutoffOf').mockResolvedValue(null);

        const res = await visit({ authorization: `Bearer ${jwt.sign(STRANGER)}` });

        expect(res.statusCode).toBe(403);
        expect(res.json()).toMatchObject({ message: 'Team::NotAMember' });
    });

    it('refuses a request with no token', async () => {
        const res = await visit({});

        expect(res.statusCode).toBe(401);
        expect(res.json()).toMatchObject({ message: 'Auth::Unauthorized' });
    });
});
