import { prefetchPage } from '../lib/pages/prefetch';
import { pageOf, pagesOf, routesOf } from '../lib/pages/routes';
import { render, screen } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouterProvider, useParams } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

const page = (text: string) => vi.fn(async () => ({ default: () => <p>{text}</p> }));

const frame = (text: string) => vi.fn(async () => ({ default: () => <section>{text} <Outlet /></section> }));

const shown = async (files: Parameters<typeof pagesOf>[0], path: string, text: string): Promise<string> => {
    const router = createMemoryRouter(routesOf(pagesOf(files)), { initialEntries: [path] });
    const { container } = render(<RouterProvider router={router} />);
    await screen.findByText(text);
    return container.textContent ?? '';
};

describe('pageOf', () => {
    it('reads the tier and the path from where the file sits', () => {
        expect(pageOf('/src/modules/issues/pages/protected/[projectId]/errores/index.tsx'))
            .toEqual({ tier: 'protected', kind: 'page', path: '/:projectId/errores' });
        expect(pageOf('/src/modules/auth/pages/guest/signIn/index.tsx'))
            .toEqual({ tier: 'guest', kind: 'page', path: '/sign-in' });
        expect(pageOf('/src/modules/site/pages/public/layout.tsx'))
            .toEqual({ tier: 'public', kind: 'layout', path: '/' });
    });

    it('reads a folder in double brackets as an optional param', () => {
        expect(pageOf('/src/modules/ai/pages/protected/dashboard/ai/[[conversationId]]/index.tsx'))
            .toEqual({ tier: 'protected', kind: 'page', path: '/dashboard/ai/:conversationId?' });
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

    it('refuses a page at a path an optional param already answers', () => {
        expect(() => pagesOf({
            '/src/modules/ai/pages/protected/ai/index.tsx': page('a'),
            '/src/modules/ai/pages/protected/ai/[[conversationId]]/index.tsx': page('b')
        })).toThrow('Page::DuplicatePath:protected page /ai');
    });
});

describe('an optional param', () => {
    const Conversation = () => <p>conversation {useParams().conversationId ?? 'new'}</p>;
    const files = {
        '/src/modules/dashboard/pages/protected/dashboard/layout.tsx': frame('dashboard'),
        '/src/modules/ai/pages/protected/dashboard/ai/[[conversationId]]/index.tsx': vi.fn(async () => ({ default: Conversation }))
    };

    it('opens its page with the param and without it, in the layout above', async () => {
        expect(await shown(files, '/dashboard/ai', 'conversation new')).toBe('dashboard conversation new');
        expect(await shown(files, '/dashboard/ai/c1', 'conversation c1')).toBe('dashboard conversation c1');
    });

    it('lets prefetchPage find its page from either path', async () => {
        const chat = vi.fn(async () => ({ default: () => null }));
        const room = vi.fn(async () => ({ default: () => null }));
        pagesOf({
            '/src/modules/chat/pages/protected/chat/[[threadId]]/index.tsx': chat,
            '/src/modules/rooms/pages/protected/rooms/[[roomId]]/index.tsx': room
        });

        await prefetchPage('/chat');
        await prefetchPage('/rooms/r1');

        expect(chat).toHaveBeenCalledOnce();
        expect(room).toHaveBeenCalledOnce();
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

describe('layouts', () => {
    it('frame every page below their folder, however deep', async () => {
        const files = {
            '/src/modules/dashboard/pages/protected/dashboard/layout.tsx': frame('dashboard'),
            '/src/modules/dashboard/pages/protected/dashboard/index.tsx': page('home'),
            '/src/modules/plugins/pages/protected/dashboard/trajectory/[trajectoryId]/plugins/[pluginId]/index.tsx': page('listing')
        };

        expect(await shown(files, '/dashboard/trajectory/t1/plugins/p1', 'listing')).toBe('dashboard listing');
        expect(routesOf(pagesOf(files)).map((route) => route.children?.map((child) => child.path ?? 'index')))
            .toEqual([['index', 'trajectory/:trajectoryId/plugins/:pluginId']]);
    });

    it('nest, the deeper one inside the one above it', async () => {
        const files = {
            '/src/modules/dashboard/pages/protected/dashboard/layout.tsx': frame('dashboard'),
            '/src/modules/settings/pages/protected/dashboard/settings/layout.tsx': frame('settings'),
            '/src/modules/settings/pages/protected/dashboard/settings/general/index.tsx': page('general'),
            '/src/modules/keys/pages/protected/dashboard/settings/secretKeys/[secretKeyId]/index.tsx': page('one key')
        };

        expect(await shown(files, '/dashboard/settings/secret-keys/k1', 'one key')).toBe('dashboard settings one key');
        expect(routesOf(pagesOf(files))).toMatchObject([{
            path: 'dashboard',
            children: [{ path: 'settings', children: [{ path: 'general' }, { path: 'secret-keys/:secretKeyId' }] }]
        }]);
    });

    it('frame a whole tier from its root', async () => {
        const files = {
            '/src/modules/site/pages/public/layout.tsx': frame('site'),
            '/src/modules/site/pages/public/index.tsx': page('landing'),
            '/src/modules/docs/pages/public/docs/guides/[slug]/index.tsx': page('guide')
        };

        expect(await shown(files, '/', 'landing')).toBe('site landing');
        expect(await shown(files, '/docs/guides/start', 'guide')).toBe('site guide');
    });

    it('leave a folder that only starts with the same name alone', async () => {
        const files = {
            '/src/modules/notes/pages/protected/notes/layout.tsx': frame('notes'),
            '/src/modules/notes/pages/protected/notes/index.tsx': page('all notes'),
            '/src/modules/archive/pages/protected/notesArchive/index.tsx': page('archive')
        };

        expect(await shown(files, '/notes-archive', 'archive')).toBe('archive');
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
