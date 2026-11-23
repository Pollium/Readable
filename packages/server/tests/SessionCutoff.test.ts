import 'reflect-metadata';
import { configure } from '../lib/app/config';
import { Route } from '../lib/http/Controller';
import Fastify from 'fastify';
import { AuthenticatedController } from '../lib/auth/guards';
import { JWTService, sessionCutoffs } from '../lib/auth/sessions';
import { beforeAll, describe, expect, it, vi } from 'vitest';

class ProbeController extends AuthenticatedController{
    @Route('/probe')
    probe(){
        return { reached: true };
    }
}

const probe = async (token: string) => {
    const app = Fastify();
    await new ProbeController().register(app, '');
    const res = await app.inject({ method: 'GET', url: '/probe', headers: { authorization: `Bearer ${token}` } });
    await app.close();

    return res;
};

describe('a session cut by a credential change', () => {
    const jwt = new JWTService();

    beforeAll(() => {
        configure({
            name: 'readable',
            jwtSecret: 'test-jwt-secret',
            redis: { host: 'localhost', port: 6379 },
            storage: null
        });
    });

    it('refuses a token issued before the cut', async () => {
        const token = jwt.sign('user-1');
        vi.spyOn(sessionCutoffs, 'cutoffOf').mockResolvedValue(jwt.verify(token).iat + 1);

        const res = await probe(token);

        expect(res.statusCode).toBe(401);
        expect(res.json()).toMatchObject({ message: 'Auth::InvalidToken' });
    });

    it('accepts a token issued at or after the cut', async () => {
        const token = jwt.sign('user-1');
        vi.spyOn(sessionCutoffs, 'cutoffOf').mockResolvedValue(jwt.verify(token).iat);

        expect((await probe(token)).statusCode).toBe(200);
    });

    it('renews a session without moving its expiry', () => {
        const original = jwt.verify(jwt.sign('user-1'));

        const renewed = jwt.verify(jwt.signUntil('user-1', original.exp));

        expect(renewed.exp).toBe(original.exp);
    });
});
