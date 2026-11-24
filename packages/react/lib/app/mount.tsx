import { configure, WebOptions } from './config';
import { PageFiles, pagesOf, PageTier, routesOf } from '../pages/routes';
import { useSession } from '../session/session';
import { ComponentType, ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Navigate, Outlet, RouteObject, RouterProvider, useLocation } from 'react-router-dom';

export interface RouteOptions{
    pages: PageFiles;
    layout?: ComponentType;
    signIn?: string;
    home?: string;
}

export interface AppOptions extends WebOptions, RouteOptions{
    wrap?: (app: ReactNode) => ReactNode;
    root?: HTMLElement | null;
}

const isLocal = (path: string | null): path is string => path !== null && path.startsWith('/') && !path.startsWith('//');

const GuestOnly = ({ home }: { home: string }) => {
    const token = useSession();
    const next = new URLSearchParams(useLocation().search).get('next');
    if(token === null) return <Outlet />;

    return <Navigate to={isLocal(next) ? next : home} replace />;
};

const SignedIn = ({ signIn }: { signIn: string }) => {
    const token = useSession();
    const { pathname, search } = useLocation();
    if(token !== null) return <Outlet />;

    const next = `${pathname}${search}`;
    return <Navigate to={next === '/' ? signIn : `${signIn}?next=${encodeURIComponent(next)}`} replace />;
};

export const appRoutes = ({ pages, layout: Layout, signIn = '/sign-in', home = '/' }: RouteOptions): RouteObject[] => {
    const found = pagesOf(pages);
    const tier = (name: PageTier) => routesOf(found.filter((page) => page.tier === name));
    const signedIn = tier('protected');

    return [
        { children: tier('public') },
        { element: <GuestOnly home={home} />, children: tier('guest') },
        {
            element: <SignedIn signIn={signIn} />,
            children: Layout === undefined ? signedIn : [{ element: <Layout />, children: signedIn }]
        },
        { path: '*', element: <Navigate to={home} replace /> }
    ];
};

export const mount = (options: AppOptions) => {
    configure(options);
    const router = createBrowserRouter(appRoutes(options));
    const root = options.root ?? document.getElementById('root');
    if(root === null) return router;

    const app = <RouterProvider router={router} />;
    createRoot(root).render(<StrictMode>{options.wrap?.(app) ?? app}</StrictMode>);
    return router;
};
