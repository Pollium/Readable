import { prefetchPage } from '../lib/pages/prefetch';
import { pageOf, pagesOf, routesOf } from '../lib/pages/routes';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const page = (text: string) => vi.fn(async () => ({ default: () => <p>{text}</p> }));

describe('pageOf', () => {
    it('reads the tier and the path from where the file sits', () => {
        expect(pageOf('/src/modules/issues/pages/protected/[projectId]/errores/index.tsx'))
            .toEqual({ tier: 'protected', kind: 'page', path: '/:projectId/errores' });
        expect(pageOf('/src/modules/auth/pages/guest/signIn/index.tsx'))
            .toEqual({ tier: 'guest', kind: 'page', path: '/sign-in' });
        expect(pageOf('/src/modules/site/pages/public/layout.tsx'))
            .toEqual({ tier: 'public', kind: 'layout', path: '/' });
    });

    it('refuses a file outside a tier', () => {
        expect(() => pageOf('/src/modules/issues/pages/Issue.tsx')).toThrow('Page::InvalidFile:/src/modules/issues/pages/Issue.tsx');
    });
});

describe('pagesOf', () => {
    it('refuses two pages at the same path of a tier', () => {
        expect(() => pagesOf({
            '/src/modules/a/pages/protected/notes/index.tsx': page('a'),
            '/src/modules/b/pages/protected/notes/index.tsx': page('b')
        })).toThrow('Page::DuplicatePath:protected page /notes');
    });
});

describe('routesOf', () => {
    const files = {
        '/src/modules/notes/pages/protected/notes/layout.tsx': vi.fn(async () => ({
            default: () => <section>notes layout <Outlet /></section>
        })),
        '/src/modules/notes/pages/protected/notes/index.tsx': page('all notes'),
        '/src/modules/notes/pages/protected/notes/[noteId]/index.tsx': page('one note'),
        '/src/modules/account/pages/protected/account/index.tsx': page('account')
    };

    it('nests a folder\'s pages under its layout', () => {
        const routes = routesOf(pagesOf(files));

        expect(routes.map((route) => ({ path: route.path, index: route.index, children: route.children?.map((child) => child.path ?? 'index') })))
            .toEqual([
                { path: 'account', index: undefined, children: undefined },
                { path: 'notes', index: undefined, children: ['index', ':noteId'] }
            ]);
    });

    it('loads a page only when it is opened', async () => {
        const router = createMemoryRouter(routesOf(pagesOf(files)), { initialEntries: ['/notes/n1'] });
        render(<RouterProvider router={router} />);

        expect(await screen.findByText('one note')).toBeTruthy();
        expect(screen.getByText(/notes layout/)).toBeTruthy();
        expect(files['/src/modules/account/pages/protected/account/index.tsx']).not.toHaveBeenCalled();
    });
});

describe('prefetchPage', () => {
    it('loads the page a path opens once, and again after a failure', async () => {
        const load = vi.fn()
            .mockRejectedValueOnce(new Error('offline'))
            .mockResolvedValue({ default: () => null });
        pagesOf({ '/src/modules/reports/pages/protected/reports/[reportId]/index.tsx': load });

        await prefetchPage('/reports/r1');
        await prefetchPage('/reports/r1');
        await prefetchPage('/reports/r2');

        expect(load).toHaveBeenCalledTimes(2);
    });
});
