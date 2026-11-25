import { registerLoader } from './prefetch';
import { defineErrors } from '@pollium/readable-contracts/errors';
import { ComponentType, lazy, ReactElement, Suspense } from 'react';
import { RouteObject } from 'react-router-dom';

export type PageTier = 'guest' | 'public' | 'protected';

export type PageKind = 'page' | 'layout';

export interface PageModule{
    default: ComponentType;
}

export type PageFiles = Record<string, () => Promise<unknown>>;

export interface Page{
    tier: PageTier;
    kind: PageKind;
    path: string;
    load: () => Promise<PageModule>;
}

const PageErrors = defineErrors({
    domain: 'Page',
    causes: {
        InvalidFile: 500,
        DuplicatePath: 500
    }
});

const PAGE_FILE = /\/modules\/[^/]+\/pages\/(guest|public|protected)\/(.*?)(index|layout)\.tsx$/;

const toKebab = (segment: string): string => segment
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1-$2')
    .toLowerCase();

const toSegment = (raw: string): string => {
    const param = /^\[(.+)\]$/.exec(raw);
    return param === null ? toKebab(raw) : `:${param[1]}`;
};

export const pageOf = (file: string): Omit<Page, 'load'> => {
    const match = PAGE_FILE.exec(file);
    if(match === null) throw PageErrors.InvalidFile(file);

    const [, tier, folders, name] = match;
    const segments = folders.split('/').filter(Boolean).map(toSegment);
    return {
        tier: tier as PageTier,
        kind: name === 'layout' ? 'layout' : 'page',
        path: segments.length === 0 ? '/' : `/${segments.join('/')}`
    };
};

export const pagesOf = (files: PageFiles): Page[] => {
    const pages = Object.entries(files).map(([file, load]) => ({ ...pageOf(file), load: load as Page['load'] }));

    const seen = new Set<string>();
    for(const page of pages){
        const key = `${page.tier} ${page.kind} ${page.path}`;
        if(seen.has(key)) throw PageErrors.DuplicatePath(key);
        seen.add(key);
        registerLoader(page.path, page.load);
    }
    return pages;
};

const lazyElement = (load: Page['load']): ReactElement => {
    const Component = lazy(load);
    return (
        <Suspense fallback={null}>
            <Component />
        </Suspense>
    );
};

const depthOf = (path: string): number => path.split('/').filter(Boolean).length;

const owns = (layout: Page, page: Page): boolean => page.path === layout.path
    || (page.path.startsWith(`${layout.path === '/' ? '' : layout.path}/`) && depthOf(page.path) === depthOf(layout.path) + 1);

const relative = (path: string, parent: string | null): string =>
    parent === null || parent === '/' ? path.replace(/^\//, '') : path.slice(parent.length + 1);

const routeOf = (page: Page, parent: string | null): RouteObject => {
    const path = relative(page.path, parent);
    return path === ''
        ? { index: true, element: lazyElement(page.load) }
        : { path, element: lazyElement(page.load) };
};

export const routesOf = (pages: readonly Page[]): RouteObject[] => {
    const layouts = pages.filter((page) => page.kind === 'layout');
    const owned = pages.filter((page) => page.kind === 'page');
    const ownerOf = (page: Page) => layouts.find((layout) => owns(layout, page));

    return [
        ...owned.filter((page) => ownerOf(page) === undefined).map((page) => routeOf(page, null)),
        ...layouts.map((layout) => ({
            path: layout.path.replace(/^\//, ''),
            element: lazyElement(layout.load),
            children: owned.filter((page) => ownerOf(page) === layout).map((page) => routeOf(page, layout.path))
        }))
    ];
};
