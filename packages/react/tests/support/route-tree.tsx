import { appRoutes } from '../../lib/app/mount';
import { pageOf } from '../../lib/pages/routes';
import { session } from '../../lib/session/session';
import { AppPages } from './apps';
import { render, waitFor } from '@testing-library/react';
import { createMemoryRouter, Outlet, RouteObject, RouterProvider } from 'react-router-dom';

export interface RouteShape{
    path?: string;
    index?: true;
    children?: RouteShape[];
}

export interface Resolution{
    url: string;
    pathname: string;
    chain: string[];
}

const Layout = () => <main data-frame='layout'><Outlet /></main>;

const loaderOf = (file: string) => file.endsWith('/layout.tsx')
    ? async () => ({ default: () => <section data-frame={file}><Outlet /></section> })
    : async () => ({ default: () => <p data-page={file}>{file}</p> });

const pagesOf = ({ files }: AppPages) => Object.fromEntries(files.map((file) => [file, loaderOf(file)]));

export const routesOfApp = (app: AppPages): RouteObject[] =>
    appRoutes({ pages: pagesOf(app), layout: app.layout ? Layout : undefined });

export const shapeOf = (routes: readonly RouteObject[]): RouteShape[] => routes.map((route) => ({
    ...route.path === undefined ? {} : { path: route.path },
    ...route.index === true ? { index: true as const } : {},
    ...route.children === undefined ? {} : { children: shapeOf(route.children) }
}));

export const urlOf = (path: string): string => path
    .replace(/:(\w+)\?/g, 'some-$1')
    .replace(/:(\w+)/g, 'a-$1')
    .replace(/\*$/, 'anywhere');

const drawn = (container: HTMLElement): string[] => [...container.querySelectorAll('[data-frame], [data-page]')]
    .map((element) => element.getAttribute('data-frame') ?? element.getAttribute('data-page') ?? '');

const resolveAll = async (app: AppPages, files: readonly string[]): Promise<Record<string, Resolution>> => {
    const opened = files.map((file) => {
        const url = urlOf(pageOf(file).path);
        const router = createMemoryRouter(routesOfApp(app), { initialEntries: [url] });
        return { file, url, router, view: render(<RouterProvider router={router} />) };
    });
    await waitFor(() => {
        const blank = opened.find(({ view }) => view.container.querySelector('[data-page]') === null);
        if(blank !== undefined) throw new Error(`nothing drawn at ${blank.url}`);
    });

    const found = Object.fromEntries(opened.map(({ file, url, router, view }) =>
        [file, { url, pathname: router.state.location.pathname, chain: drawn(view.container) }]));
    opened.forEach(({ view }) => view.unmount());
    return found;
};

// Opens every page of an app, each as the tier it sits in expects (signed in for a protected page, signed
// out for the others), and reads which frames and which page drew it.
export const resolutionsOf = async (app: AppPages): Promise<Record<string, Resolution>> => {
    const pages = app.files.filter((file) => file.endsWith('/index.tsx'));
    const signedOut = await resolveAll(app, pages.filter((file) => pageOf(file).tier !== 'protected'));
    session.start('token-a');
    const signedIn = await resolveAll(app, pages.filter((file) => pageOf(file).tier === 'protected'));
    session.end();
    return Object.fromEntries(pages.map((file) => [file, signedOut[file] ?? signedIn[file]]));
};
