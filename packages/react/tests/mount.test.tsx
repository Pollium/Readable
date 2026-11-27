import { settings } from '../lib/app/config';
import { AppOptions, appRoutes, mount } from '../lib/app/mount';
import { session } from '../lib/session/session';
import { act, render, screen } from '@testing-library/react';
import { ReactElement } from 'react';
import { createMemoryRouter, Outlet, RouterProvider, useLocation } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

const page = (text: string) => async () => ({ default: () => <p>{text}</p> });

const pages = {
    '/src/modules/auth/pages/guest/signIn/index.tsx': page('sign in'),
    '/src/modules/notes/pages/protected/index.tsx': page('home'),
    '/src/modules/notes/pages/protected/notes/[noteId]/index.tsx': page('one note'),
    '/src/modules/site/pages/public/pricing/index.tsx': page('pricing')
};

const Console = () => <main>console <Outlet /></main>;

const opened = (path: string, options: Partial<Parameters<typeof appRoutes>[0]> = {}) => {
    const router = createMemoryRouter(appRoutes({ pages, layout: Console, ...options }), { initialEntries: [path] });
    render(<RouterProvider router={router} />);
    return router;
};

const Frame = () => <div data-testid='frame' data-path={useLocation().pathname}><Outlet /></div>;

const later = () => {
    let open: (module: { default: () => ReactElement }) => void = () => undefined;
    const load = () => new Promise<{ default: () => ReactElement }>((resolve) => {
        open = resolve;
    });
    return { load, open: (text: string) => open({ default: () => <p>{text}</p> }) };
};

describe('appRoutes', () => {
    afterEach(() => session.end());

    it('sends a guest to sign in, and back to where they were going', async () => {
        const router = opened('/notes/n1?tab=history');

        expect(await screen.findByText('sign in')).toBeTruthy();
        expect(router.state.location.search).toBe('?next=%2Fnotes%2Fn1%3Ftab%3Dhistory');

        act(() => session.start('token-a'));

        expect(await screen.findByText('one note')).toBeTruthy();
        expect(router.state.location.pathname).toBe('/notes/n1');
    });

    it('frames the signed-in pages in the layout', async () => {
        session.start('token-a');
        opened('/');

        expect(await screen.findByText('home')).toBeTruthy();
        expect(screen.getByText(/console/)).toBeTruthy();
    });

    it('sends a signed-in user away from the guest pages, never to another site', async () => {
        session.start('token-a');
        const router = opened('/sign-in?next=//evil.test');

        expect(await screen.findByText('home')).toBeTruthy();
        expect(router.state.location.pathname).toBe('/');
    });

    it('opens a public page to anyone', async () => {
        opened('/pricing');

        expect(await screen.findByText('pricing')).toBeTruthy();
    });

    it('sends an unknown path home', async () => {
        session.start('token-a');
        const router = opened('/nowhere');

        expect(await screen.findByText('home')).toBeTruthy();
        expect(router.state.location.pathname).toBe('/');
    });

    it('shows the not-found page the app gives for an unknown path', async () => {
        const router = createMemoryRouter(appRoutes({ pages, notFound: () => <p>no such page</p> }), { initialEntries: ['/nowhere'] });
        render(<RouterProvider router={router} />);

        expect(await screen.findByText('no such page')).toBeTruthy();
        expect(router.state.location.pathname).toBe('/nowhere');
    });
});

describe('a frame', () => {
    afterEach(() => session.end());

    it('wraps every tier and the page for an unknown path, inside the router', async () => {
        const router = opened('/pricing', { frame: Frame });
        expect(await screen.findByText('pricing')).toBeTruthy();
        expect(screen.getByTestId('frame').dataset.path).toBe('/pricing');

        await act(() => router.navigate('/sign-in'));
        expect((await screen.findByText('sign in')).closest('[data-testid=frame]')).not.toBeNull();

        act(() => session.start('token-a'));
        expect((await screen.findByText('home')).closest('[data-testid=frame]')).not.toBeNull();
        expect(screen.getByText(/console/).closest('[data-testid=frame]')).not.toBeNull();

        const lost = createMemoryRouter(appRoutes({ pages, frame: Frame, notFound: () => <p>lost</p> }), { initialEntries: ['/nowhere'] });
        render(<RouterProvider router={lost} />);
        expect((await screen.findByText('lost')).closest('[data-testid=frame]')).not.toBeNull();
    });
});

describe('a pending state', () => {
    it('shows while a page loads', async () => {
        const report = later();
        opened('/report', { pages: { '/src/modules/reports/pages/public/report/index.tsx': report.load }, pending: <p>loading</p> });

        expect(await screen.findByText('loading')).toBeTruthy();
        await act(async () => report.open('the report'));
        expect(await screen.findByText('the report')).toBeTruthy();
        expect(screen.queryByText('loading')).toBeNull();
    });
});

describe('mount', () => {
    it('configures the app and renders it into its root, inside what wraps it', async () => {
        const root = document.createElement('div');
        document.body.append(root);

        mount({ name: 'board', apiUrl: 'http://board.test', pages, root, wrap: (app) => <section data-testid='wrap'>{app}</section> });

        expect(await screen.findByText('sign in')).toBeTruthy();
        expect(screen.getByTestId('wrap')).toBeTruthy();
        expect(settings()).toMatchObject({ name: 'board', apiUrl: 'http://board.test' });
        root.remove();
    });

    it('answers the router it made, with the options given to it and to its provider', async () => {
        const root = document.createElement('div');
        document.body.append(root);
        history.replaceState(null, '', '/console/pricing');
        const onError = vi.fn();
        const broken = { '/src/modules/site/pages/public/broken/index.tsx': async () => ({ default: () => { throw new Error('drawn wrong'); } }) };
        vi.spyOn(console, 'error').mockImplementation(() => undefined);

        const router = mount({ name: 'board', pages: { ...pages, ...broken }, root, router: { basename: '/console', onError } });

        expect(await screen.findByText('pricing')).toBeTruthy();
        expect(router.basename).toBe('/console');

        await act(() => router.navigate('/broken'));
        await vi.waitFor(() => expect(onError).toHaveBeenCalled());
        expect(onError.mock.calls[0][0]).toMatchObject({ message: 'drawn wrong' });

        router.dispose();
        root.remove();
        history.replaceState(null, '', '/');
    });
});

describe('boot', () => {
    const mounted: (() => void)[] = [];

    const mountAt = (path: string, options: Partial<AppOptions>) => {
        const root = document.createElement('div');
        document.body.append(root);
        history.replaceState(null, '', path);
        const router = mount({ name: 'board', pages, root, ...options });
        mounted.push(() => {
            router.dispose();
            root.remove();
        });
        return router;
    };

    afterEach(() => {
        mounted.splice(0).forEach((unmount) => unmount());
        session.end();
        history.replaceState(null, '', '/');
    });

    it('runs before the first render, which waits for it', async () => {
        let started: () => void = () => undefined;
        const starting = new Promise<void>((resolve) => {
            started = resolve;
        });
        const guard = vi.fn(() => null);
        const router = mountAt('/notes/n1', {
            boot: async () => {
                await starting;
                session.start('token-a');
            },
            booting: <p>starting the stack</p>,
            guards: { protected: [guard] }
        });

        expect(await screen.findByText('starting the stack')).toBeTruthy();
        expect(guard).not.toHaveBeenCalled();

        await act(async () => started());

        expect(await screen.findByText('one note')).toBeTruthy();
        expect(router.state.location.pathname).toBe('/notes/n1');
        expect(screen.queryByText('starting the stack')).toBeNull();
    });

    it('draws at once after a boot that is done when it returns', async () => {
        mountAt('/notes/n1', { boot: () => session.start('token-a'), booting: <p>starting the stack</p> });

        expect(await screen.findByText('one note')).toBeTruthy();
    });

    it('still draws the app after a boot that fails, and reports why', async () => {
        const reported = vi.fn();
        vi.stubGlobal('reportError', reported);
        mountAt('/notes/n1', { boot: () => Promise.reject(new Error('the stack did not start')) });

        expect(await screen.findByText('sign in')).toBeTruthy();
        expect(reported).toHaveBeenCalledWith(expect.objectContaining({ message: 'the stack did not start' }));
    });
});
