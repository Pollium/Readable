import { get } from '@pollium/readable-contracts/routing';
import { call } from '../lib/http/call';
import { logger } from '../lib/utils/Logger';
import { afterEach, describe, expect, it, vi } from 'vitest';

const directoryRoutes = {
    defaultOrg: get<{ orgId: string }>('/directory/organizations/default'),
    user: get<{ id: string }>('/directory/users/:userId')
};

const host = {
    url: 'http://iam.test',
    header: 'x-iam-key',
    key: 'secret'
};

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
});

const jsonResponse = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
    });

describe('call', () => {
    it('sends the service key and unwraps the envelope', async () => {
        let url = '';
        let headers: RequestInit['headers'];
        vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
            url = String(input);
            headers = init?.headers;
            return jsonResponse(200, { data: { orgId: 'org-1' } });
        });

        await expect(call(host, directoryRoutes.defaultOrg)).resolves.toEqual({ orgId: 'org-1' });
        expect(url).toBe('http://iam.test/directory/organizations/default');
        expect(headers).toMatchObject({ 'x-iam-key': 'secret' });
    });

    it('fills path params', async () => {
        let url = '';
        vi.stubGlobal('fetch', async (input: string | URL) => {
            url = String(input);
            return jsonResponse(200, { data: { id: 'u1' } });
        });

        await call(host, directoryRoutes.user, { path: { userId: 'user-1' } });
        expect(url).toBe('http://iam.test/directory/users/user-1');
    });

    it('rethrows Domain::Cause from a non-ok body', async () => {
        vi.stubGlobal('fetch', async () => jsonResponse(404, { error: 'User::NotFound' }));

        await expect(call(host, directoryRoutes.user, { path: { userId: 'u' } })).rejects.toMatchObject({
            message: 'User::NotFound',
            statusCode: 404
        });
    });

    it.each([401, 403])('answers a %i refusal of the service key with a logged 502 that never carries the key', async (status) => {
        vi.stubGlobal('fetch', async () => jsonResponse(status, { error: 'Auth::Unauthorized' }));
        const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);

        await expect(call(host, directoryRoutes.user, { path: { userId: 'u' } })).rejects.toMatchObject({
            message: `Call::Rejected:${status}`,
            statusCode: 502
        });
        expect(error).toHaveBeenCalledOnce();
        expect(JSON.stringify(error.mock.calls)).not.toContain(host.key);
    });
});
