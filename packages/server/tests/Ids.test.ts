import Application from '../lib/app/Application';
import BaseController, { Route } from '../lib/http/Controller';
import { ModuleDiscovery } from '../lib/app/discovery';
import { configure } from '../lib/app/config';
import { Middleware } from '../lib/http/middleware';
import { Owned } from '../lib/auth/params';
import { IdParam, IdQuery, OptionalIdQuery, configureIds, parseId } from '../lib/http/params';
import { afterEach, describe, expect, it } from 'vitest';
import { TEST_REDIS } from './env';

const UUID = '019ca945-0a00-7000-8000-010000000000';
const OBJECT_ID = '65f0c2a4e13b5a0012ab34cd';
const OBJECT_IDS = /^[0-9a-f]{24}$/;

class TrajectoryService{
    async getOwned(userId: string, id: string){
        return { userId, id };
    }
}

@Middleware((req) => {
    req.principal = { userId: 'user-1' };
})
class TrajectoryController extends BaseController{
    @Route('/trajectories/:id')
    show(@IdParam('id') id: string, @IdQuery('team') team: string, @OptionalIdQuery('frame') frame?: string){
        return { id, team, frame: frame ?? null };
    }

    @Route('/owned/:id')
    owned(@Owned(TrajectoryService) trajectory: { userId: string; id: string }){
        return trajectory;
    }
}

configure({ name: 'readable', jwtSecret: null, redis: TEST_REDIS, storage: null });

const built = async (ids?: { test(value: string): boolean }) => {
    const application = new Application({
        port: 0,
        corsOrigins: [],
        log: { level: 'silent', pretty: false },
        ids,
        discover: async () => ModuleDiscovery.merge([{
            controllers: [{ prefix: '', Controller: TrajectoryController }],
            entities: [], events: [], queues: [], gateways: [], tools: []
        }])
    });

    return { application, app: await application.build({ queues: false }) };
};

afterEach(() => {
    configureIds();
});

describe('ids', () => {
    it('accepts a UUID by default, lowercased, and nothing else', () => {
        expect(parseId(UUID.toUpperCase())).toBe(UUID);
        expect(() => parseId(OBJECT_ID)).toThrow('Request::InvalidId');
        expect(() => parseId(undefined)).toThrow('Request::InvalidId');
    });

    it('accepts what the app\'s format accepts, as it was written', () => {
        configureIds(OBJECT_IDS);

        expect(parseId(OBJECT_ID)).toBe(OBJECT_ID);
        expect(() => parseId(UUID)).toThrow('Request::InvalidId');
        expect(() => parseId(OBJECT_ID.toUpperCase())).toThrow('Request::InvalidId');
        expect(() => parseId(42)).toThrow('Request::InvalidId');
    });

    it('takes any object with test, and a RegExp with the g flag on every call alike', () => {
        configureIds({ test: (value) => value.startsWith('vsk_') });
        expect(parseId('vsk_1')).toBe('vsk_1');
        expect(() => parseId('1')).toThrow('Request::InvalidId');

        configureIds(/^[0-9a-f]{24}$/g);
        expect([parseId(OBJECT_ID), parseId(OBJECT_ID), parseId(OBJECT_ID)]).toEqual([OBJECT_ID, OBJECT_ID, OBJECT_ID]);
    });

    it('decides what @IdParam, @IdQuery, @OptionalIdQuery and @Owned accept in an app built with it', async () => {
        const { application, app } = await built(OBJECT_IDS);

        const shown = await app.inject({ method: 'GET', url: `/trajectories/${OBJECT_ID}?team=${OBJECT_ID}&frame=${OBJECT_ID}` });
        const owned = await app.inject({ method: 'GET', url: `/owned/${OBJECT_ID}` });
        const refused = await app.inject({ method: 'GET', url: `/trajectories/${UUID}?team=${OBJECT_ID}` });

        expect(shown.json()).toEqual({ data: { id: OBJECT_ID, team: OBJECT_ID, frame: OBJECT_ID } });
        expect(owned.json()).toEqual({ data: { userId: 'user-1', id: OBJECT_ID } });
        expect(refused.statusCode).toBe(400);
        expect(refused.json()).toEqual({ error: 'Request::InvalidId' });
        await application.stop();
    });

    it('goes back to UUIDs when the next app built leaves ids out', async () => {
        await (await built(OBJECT_IDS)).application.stop();
        const { application, app } = await built();

        const res = await app.inject({ method: 'GET', url: `/trajectories/${UUID}?team=${UUID}` });

        expect(res.json()).toEqual({ data: { id: UUID, team: UUID, frame: null } });
        await application.stop();
    });
});
