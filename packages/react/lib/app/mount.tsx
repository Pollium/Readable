import { configure, WebOptions } from './config';
import { Guard, Guarded, isPending, TierGuards } from '../pages/guards';
import { MetaFiles } from '../pages/meta';
import { PageFiles, pagesOf, PageTier, routesOf } from '../pages/routes';
import { ComponentType, ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, DOMRouterOpts, Navigate, RouteObject, RouterProvider, RouterProviderProps } from 'react-router-dom';

export interface RouteOptions{
    pages: PageFiles;
    meta?: MetaFiles;
    layout?: ComponentType;
    frame?: ComponentType;
    notFound?: ComponentType;
    pending?: ReactNode;
    guards?: TierGuards;
    signIn?: string;
    home?: string;
}

export type RouterOptions = DOMRouterOpts & Omit<RouterProviderProps, 'router'>;

export interface AppOptions extends WebOptions, RouteOptions{
    wrap?: (app: ReactNode) => ReactNode;
    root?: HTMLElement | null;
    router?: RouterOptions;
    boot?: () => void | PromiseLike<void>;
    booting?: ReactNode;
}

const isLocal = (path: string | null): path is string => path !== null && path.startsWith('/') && !path.startsWith('//');

const signedOut = (home: string): Guard => ({ session, search }) => {
    if(session === null) return null;

    const next = new URLSearchParams(search).get('next');
    return isLocal(next) ? next : home;
};

const signedIn = (signIn: string): Guard => ({ session, path, search }) => {
    if(session !== null) return null;

    const next = `${path}${search}`;
    return next === '/' ? signIn : `${signIn}?next=${encodeURIComponent(next)}`;
};

export const appRoutes = ({
    pages,
    meta,
    layout: Layout,
    frame: Frame,
    notFound: NotFound,
    pending,
    guards = {},
    signIn = '/sign-in',
    home = '/'
}: RouteOptions): RouteObject[] => {
    const found = pagesOf(pages, meta);
    const tier = (name: PageTier) => routesOf(found.filter((page) => page.tier === name), { pending });
    const guarded = (name: PageTier, own: readonly Guard[], children: RouteObject[]): RouteObject => {
        const all = [...own, ...guards[name] ?? []];
        return all.length === 0 ? { children } : { element: <Guarded tier={name} guards={all} pending={pending} />, children };
    };
    const protectedPages = tier('protected');

    const tiers: RouteObject[] = [
        guarded('public', [], tier('public')),
        guarded('guest', [signedOut(home)], tier('guest')),
        guarded('protected', [signedIn(signIn)], Layout === undefined ? protectedPages : [{ element: <Layout />, children: protectedPages }]),
        { path: '*', element: NotFound === undefined ? <Navigate to={home} replace /> : <NotFound /> }
    ];
    return Frame === undefined ? tiers : [{ element: <Frame />, children: tiers }];
};

const report = (error: unknown) => {
    if(typeof reportError === 'function') reportError(error);
    else console.error(error);
};

// A boot that fails still lets the app draw, and its error goes where an uncaught one would.
const booted = (boot: AppOptions['boot']): Promise<void> | null => {
    try{
        const started = boot?.();
        return isPending<void>(started) ? Promise.resolve(started).catch(report) : null;
    }catch(error: unknown){
        report(error);
        return null;
    }
};

export const mount = (options: AppOptions) => {
    configure(options);
    const { useTransitions, onError, ...init } = options.router ?? {};
    const router = createBrowserRouter(appRoutes(options), init);
    const root = options.root ?? document.getElementById('root');
    if(root === null){
        void booted(options.boot);
        return router;
    }

    const view = createRoot(root);
    const show = (node: ReactNode) => view.render(<StrictMode>{options.wrap?.(node) ?? node}</StrictMode>);
    const app = <RouterProvider router={router} useTransitions={useTransitions} onError={onError} />;
    const booting = booted(options.boot);
    if(booting === null){
        show(app);
        return router;
    }

    show(options.booting ?? options.pending ?? null);
    void booting.then(() => show(app));
    return router;
};
