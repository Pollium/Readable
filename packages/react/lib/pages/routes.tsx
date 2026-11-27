import { listPages, MetaFiles, metaOf, PageMeta } from './meta';
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
    meta?: PageMeta;
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
    const optional = /^\[\[(.+)\]\]$/.exec(raw);
    if(optional !== null) return `:${optional[1]}?`;

    const param = /^\[(.+)\]$/.exec(raw);
    return param === null ? toKebab(raw) : `:${param[1]}`;
};

// Every path a page answers: one with each optional segment and one without it, so a page at
// /ai/:conversationId? collides with a page at /ai.
const answersOf = (path: string): string[] => path.split('/').filter(Boolean)
    .reduce<string[]>((paths, segment) => segment.endsWith('?')
        ? paths.flatMap((path) => [path, `${path}/${segment.slice(0, -1)}`])
        : paths.map((path) => `${path}/${segment}`), [''])
    .map((path) => path === '' ? '/' : path);

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

export const pagesOf = (files: PageFiles, meta?: MetaFiles): Page[] => {
    const pages = Object.entries(files).map(([file, load]): Page => {
        const page = pageOf(file);
        return { ...page, load: load as Page['load'], meta: page.kind === 'page' ? metaOf(file, meta) : undefined };
    });

    const seen = new Set<string>();
    for(const page of pages){
        for(const path of answersOf(page.path)){
            const key = `${page.tier} ${page.kind} ${path}`;
            if(seen.has(key)) throw PageErrors.DuplicatePath(key);
            seen.add(key);
        }
        registerLoader(page.path, page.load);
    }
    listPages(pages.filter((page) => page.kind === 'page').map(({ tier, path, meta }) => ({ tier, path, meta })));
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

const holds = (folder: string, path: string): boolean =>
    folder === '/' || path === folder || path.startsWith(`${folder}/`);

const relative = (path: string, parent: string | null): string =>
    parent === null || parent === '/' ? path.replace(/^\//, '') : path.slice(parent.length + 1);

const routeOf = ({ tier, path, load, meta }: Page, parent: string | null): RouteObject => {
    const route = { element: lazyElement(load), handle: { page: { tier, path, meta } } };
    const at = relative(path, parent);
    return at === '' ? { index: true, ...route } : { path: at, ...route };
};

// A layout frames every page in its folder and below it. When layouts sit inside each other, a page is
// framed by the deepest one that holds it, inside the ones above that.
export const routesOf = (pages: readonly Page[]): RouteObject[] => {
    const layouts = pages.filter((page) => page.kind === 'layout');
    const frameOf = (page: Page): Page | undefined => layouts
        .filter((layout) => holds(layout.path, page.path) && (page.kind === 'page' || layout.path !== page.path))
        .sort((a, b) => depthOf(b.path) - depthOf(a.path))[0];

    const framedBy = (parent: Page | undefined): RouteObject[] => {
        const parentPath = parent?.path ?? null;
        return [
            ...pages.filter((page) => page.kind === 'page' && frameOf(page) === parent).map((page) => routeOf(page, parentPath)),
            ...layouts.filter((layout) => frameOf(layout) === parent).map((layout) => ({
                path: relative(layout.path, parentPath),
                element: lazyElement(layout.load),
                children: framedBy(layout)
            }))
        ];
    };

    return framedBy(undefined);
};
