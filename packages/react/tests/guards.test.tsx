import { appRoutes, RouteOptions } from '../lib/app/mount';
import { Guard, GuardContext, recheckGuards } from '../lib/pages/guards';
import { session } from '../lib/session/session';
import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

declare module '../lib/pages/meta'{
    interface PageMeta{
        needsTeam?: boolean;
    }
}

const page = (text: string) => async () => ({ default: () => <p>{text}</p> });

const pages = {
    '/src/modules/auth/pages/guest/signIn/index.tsx': page('sign in'),
    '/src/modules/system/pages/public/connect/index.tsx': page('connect'),
    '/src/modules/site/pages/public/pricing/index.tsx': page('pricing'),
    '/src/modules/onboarding/pages/protected/onboarding/index.tsx': page('onboarding'),
    '/src/modules/dashboard/pages/protected/dashboard/index.tsx': page('dashboard'),
    '/src/modules/keys/pages/protected/dashboard/keys/[keyId]/index.tsx': page('one key')
};

const meta = {
    '/src/modules/dashboard/pages/protected/dashboard/index.tsx': { needsTeam: true },
    '/src/modules/keys/pages/protected/dashboard/keys/[keyId]/index.tsx': { needsTeam: true }
};

const opened = (path: string, options: Partial<RouteOptions> = {}) => {
    const router = createMemoryRouter(appRoutes({ pages, meta, ...options }), { initialEntries: [path] });
    render(<RouterProvider router={router} />);
    return router;
};

const later = <T,>() => {
    let settle: (value: T) => void = () => undefined;
    let fail: (error: unknown) => void = () => undefined;
    const promise = new Promise<T>((resolve, reject) => {
        settle = resolve;
        fail = reject;
    });
    return { promise, settle, fail };
};

describe('guards', () => {
    afterEach(() => session.end());

    it('send a signed-in user where they name, after the sign-in check', async () => {
        let teams = 0;
        const needsTeam: Guard = ({ meta: opening }) => opening?.needsTeam && teams === 0 ? '/onboarding' : null;
        const router = opened('/dashboard', { guards: { protected: [needsTeam] } });

        expect(await screen.findByText('sign in')).toBeTruthy();

        act(() => session.start('token-a'));
        expect(await screen.findByText('onboarding')).toBeTruthy();
        expect(router.state.location.pathname).toBe('/onboarding');

        teams = 1;
        await act(() => router.navigate('/dashboard'));
        expect(await screen.findByText('dashboard')).toBeTruthy();
    });

    it('read the path, the search, the params, the meta and the session of the page being opened', async () => {
        const seen = vi.fn<Guard>(() => null);
        session.start('token-a');
        opened('/dashboard/keys/k1?tab=usage', { guards: { protected: [seen] } });

        expect(await screen.findByText('one key')).toBeTruthy();
        expect(seen).toHaveBeenLastCalledWith({
            tier: 'protected',
            path: '/dashboard/keys/k1',
            search: '?tab=usage',
            params: { keyId: 'k1' },
            meta: { needsTeam: true },
            session: 'token-a'
        } satisfies GuardContext);
    });

    it('run in order, and the first that names a path wins', async () => {
        const first = vi.fn<Guard>(() => null);
        const second = vi.fn<Guard>(() => '/pricing');
        const third = vi.fn<Guard>(() => '/connect');
        opened('/sign-in', { guards: { guest: [first, second, third] } });

        expect(await screen.findByText('pricing')).toBeTruthy();
        expect(first).toHaveBeenCalled();
        expect(third).not.toHaveBeenCalled();
    });

    it('guard the public pages too, and let a user stay on the path a guard names', async () => {
        const needsBackend: Guard = () => '/connect';
        const router = opened('/pricing', { guards: { public: [needsBackend] } });

        expect(await screen.findByText('connect')).toBeTruthy();
        expect(router.state.location.pathname).toBe('/connect');
    });

    it('show the pending state while one decides, then the page it lets through', async () => {
        const team = later<string | null>();
        session.start('token-a');
        opened('/dashboard', { pending: <p>checking</p>, guards: { protected: [() => team.promise] } });

        expect(await screen.findByText('checking')).toBeTruthy();
        await act(async () => team.settle(null));

        expect(await screen.findByText('dashboard')).toBeTruthy();
        expect(screen.queryByText('checking')).toBeNull();
    });

    it('wait for one that answers later before asking the next', async () => {
        const team = later<string | null>();
        const machine = vi.fn<Guard>(() => '/onboarding');
        session.start('token-a');
        const router = opened('/dashboard', { guards: { protected: [() => team.promise, machine] } });

        await act(async () => undefined);
        expect(machine).not.toHaveBeenCalled();

        await act(async () => team.settle(null));
        expect(await screen.findByText('onboarding')).toBeTruthy();
        expect(router.state.location.pathname).toBe('/onboarding');
    });

    it('run again when asked, for something else they read', async () => {
        let teams = 1;
        session.start('token-a');
        const router = opened('/dashboard', { guards: { protected: [({ path }) => teams === 0 && path !== '/onboarding' ? '/onboarding' : null] } });
        expect(await screen.findByText('dashboard')).toBeTruthy();

        teams = 0;
        act(() => recheckGuards());

        expect(await screen.findByText('onboarding')).toBeTruthy();
        expect(router.state.location.pathname).toBe('/onboarding');
    });

    it('hand a guard that fails to the route\'s error boundary', async () => {
        vi.spyOn(console, 'error').mockImplementation(() => undefined);
        vi.spyOn(console, 'warn').mockImplementation(() => undefined);
        const Frame = () => <Outlet />;
        const router = createMemoryRouter([{
            element: <Frame />,
            errorElement: <p>something broke</p>,
            children: appRoutes({ pages, guards: { public: [() => Promise.reject(new Error('no backend'))] } })
        }], { initialEntries: ['/pricing'] });
        render(<RouterProvider router={router} />);

        expect(await screen.findByText('something broke')).toBeTruthy();
    });
});
