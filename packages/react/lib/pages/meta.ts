import type { PageTier } from './routes';
import { matchRoutes, UIMatch, useMatches } from 'react-router-dom';

// The app gives its pages' metadata its shape:
// declare module '@pollium/readable-react/pages/meta'{ interface PageMeta{ title?: string } }
export interface PageMeta{}

export type MetaFiles = Readonly<Record<string, unknown>>;

export interface PageInfo{
    tier: PageTier;
    path: string;
    meta: PageMeta | undefined;
}

interface PageHandle{
    page?: PageInfo;
}

let listed: readonly PageInfo[] = [];

// A page's meta comes from the page file itself, or from a meta.ts beside it. Importing it from the page
// file puts every page in the first bundle, because Vite cannot split a module it imports eagerly.
export const metaOf = (file: string, files: MetaFiles = {}): PageMeta | undefined => [
    file,
    file.replace(/index\.tsx$/, 'meta.ts'),
    file.replace(/index\.tsx$/, 'meta.tsx')
].map((name) => files[name]).find((meta) => meta !== undefined) as PageMeta | undefined;

export const listPages = (pages: readonly PageInfo[]) => {
    listed = pages;
};

export const pageList = (): readonly PageInfo[] => listed;

export const pageMeta = (path: string): PageMeta | undefined => {
    const exact = listed.find((page) => page.path === path);
    if(exact !== undefined) return exact.meta;

    const routes = listed.map((page) => ({ path: page.path, handle: { page } satisfies PageHandle }));
    return (matchRoutes(routes, path)?.at(-1)?.route.handle as PageHandle | undefined)?.page?.meta;
};

export const openedPage = (matches: readonly UIMatch[]): PageInfo | undefined => matches
    .map((match) => (match.handle as PageHandle | undefined)?.page)
    .findLast((page) => page !== undefined);

export const usePageMeta = (): PageMeta | undefined => openedPage(useMatches())?.meta;
