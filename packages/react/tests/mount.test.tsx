import { settings } from '../lib/app/config';
import { appRoutes, mount } from '../lib/app/mount';
import { session } from '../lib/session/session';
import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';

const page = (text: string) => async () => ({ default: () => <p>{text}</p> });

const pages = {
    '/src/modules/auth/pages/guest/signIn/index.tsx': page('sign in'),
    '/src/modules/notes/pages/protected/index.tsx': page('home'),
    '/src/modules/notes/pages/protected/notes/[noteId]/index.tsx': page('one note'),
    '/src/modules/site/pages/public/pricing/index.tsx': page('pricing')
};

const Console = () => <main>console <Outlet /></main>;

const opened = (path: string) => {
    const router = createMemoryRouter(appRoutes({ pages, layout: Console }), { initialEntries: [path] });
    render(<RouterProvider router={router} />);
    return router;
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
});
