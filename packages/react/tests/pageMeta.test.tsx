import { appRoutes } from '../lib/app/mount';
import { pageList, pageMeta, usePageMeta } from '../lib/pages/meta';
import { pagesOf } from '../lib/pages/routes';
import { session } from '../lib/session/session';
import { act, render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

declare module '../lib/pages/meta'{
    interface PageMeta{
        title?: string;
        section?: string;
    }
}

const page = (text: string) => vi.fn(async () => ({ default: () => <p>{text}</p> }));

const pages = {
    '/src/modules/dashboard/pages/protected/dashboard/index.tsx': page('home'),
    '/src/modules/keys/pages/protected/dashboard/keys/[keyId]/index.tsx': page('one key'),
    '/src/modules/keys/pages/protected/dashboard/keys/all/index.tsx': page('all keys'),
    '/src/modules/auth/pages/guest/signIn/index.tsx': page('sign in'),
    '/src/modules/keys/pages/protected/dashboard/keys/layout.tsx': vi.fn(async () => ({ default: () => <Outlet /> }))
};

const meta = {
    '/src/modules/dashboard/pages/protected/dashboard/index.tsx': { title: 'Dashboard', section: 'main' },
    '/src/modules/keys/pages/protected/dashboard/keys/[keyId]/meta.ts': { title: 'Key' },
    '/src/modules/keys/pages/protected/dashboard/keys/all/index.tsx': undefined,
    '/src/modules/keys/pages/protected/dashboard/keys/all/meta.ts': { title: 'All keys', section: 'settings' }
};

describe('page meta', () => {
    afterEach(() => session.end());

    it('lists every page with its meta, before any of them loads', () => {
        pagesOf(pages, meta);

        expect(pageList()).toEqual([
            { tier: 'protected', path: '/dashboard', meta: { title: 'Dashboard', section: 'main' } },
            { tier: 'protected', path: '/dashboard/keys/:keyId', meta: { title: 'Key' } },
            { tier: 'protected', path: '/dashboard/keys/all', meta: { title: 'All keys', section: 'settings' } },
            { tier: 'guest', path: '/sign-in', meta: undefined }
        ]);
        expect(Object.values(pages).some((load) => load.mock.calls.length > 0)).toBe(false);
    });

    it('finds the meta of the page a path opens, a static folder before a param', () => {
        pagesOf(pages, meta);

        expect(pageMeta('/dashboard/keys/k1')).toEqual({ title: 'Key' });
        expect(pageMeta('/dashboard/keys/all')).toEqual({ title: 'All keys', section: 'settings' });
        expect(pageMeta('/dashboard/keys/:keyId')).toEqual({ title: 'Key' });
        expect(pageMeta('/nowhere')).toBeUndefined();
    });

    it('finds the meta of a page in an optional folder from either of its paths', () => {
        const chat = '/src/modules/ai/pages/protected/dashboard/ai/[[conversationId]]/index.tsx';
        pagesOf({ [chat]: page('chat') }, { [chat]: { title: 'Assistant' } });

        expect(pageMeta('/dashboard/ai')).toEqual({ title: 'Assistant' });
        expect(pageMeta('/dashboard/ai/c1')).toEqual({ title: 'Assistant' });
    });

    it('gives the open page\'s meta to a frame above it, and follows a navigation', async () => {
        const Title = () => <h1>{usePageMeta()?.title ?? 'untitled'}</h1>;
        const Console = () => <main><Title /><Outlet /></main>;
        session.start('token-a');
        const router = createMemoryRouter(appRoutes({ pages, meta, layout: Console }), { initialEntries: ['/dashboard'] });
        render(<RouterProvider router={router} />);

        expect(await screen.findByText('home')).toBeTruthy();
        expect(screen.getByRole('heading').textContent).toBe('Dashboard');

        await act(() => router.navigate('/dashboard/keys/k1'));

        expect(await screen.findByText('one key')).toBeTruthy();
        expect(screen.getByRole('heading').textContent).toBe('Key');
    });
});
