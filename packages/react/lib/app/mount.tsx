import { configure, WebOptions } from './config';
import { MetaFiles } from '../pages/meta';
import { PageFiles, pagesOf, PageTier, routesOf } from '../pages/routes';
import { useSession } from '../session/session';
import { ComponentType, ReactNode, StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import {
    createBrowserRouter,
    DOMRouterOpts,
    Navigate,
    Outlet,
    RouteObject,
    RouterProvider,
    RouterProviderProps,
    useLocation
} from 'react-router-dom';

export interface RouteOptions{
    pages: PageFiles;
    meta?: MetaFiles;
    layout?: ComponentType;
    frame?: ComponentType;
    notFound?: ComponentType;
    pending?: ReactNode;
    signIn?: string;
    home?: string;
}

export type RouterOptions = DOMRouterOpts & Omit<RouterProviderProps, 'router'>;

export interface AppOptions extends WebOptions, RouteOptions{
    wrap?: (app: ReactNode) => ReactNode;
    root?: HTMLElement | null;
    router?: RouterOptions;
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

export const appRoutes = ({
    pages,
    meta,
    layout: Layout,
    frame: Frame,
    notFound: NotFound,
    pending,
    signIn = '/sign-in',
    home = '/'
}: RouteOptions): RouteObject[] => {
    const found = pagesOf(pages, meta);
    const tier = (name: PageTier) => routesOf(found.filter((page) => page.tier === name), { pending });
    const signedIn = tier('protected');

    const tiers: RouteObject[] = [
        { children: tier('public') },
        { element: <GuestOnly home={home} />, children: tier('guest') },
        {
            element: <SignedIn signIn={signIn} />,
            children: Layout === undefined ? signedIn : [{ element: <Layout />, children: signedIn }]
        },
        { path: '*', element: NotFound === undefined ? <Navigate to={home} replace /> : <NotFound /> }
    ];
    return Frame === undefined ? tiers : [{ element: <Frame />, children: tiers }];
};

export const mount = (options: AppOptions) => {
    configure(options);
    const { useTransitions, onError, ...init } = options.router ?? {};
    const router = createBrowserRouter(appRoutes(options), init);
    const root = options.root ?? document.getElementById('root');
    if(root === null) return router;

    const app = <RouterProvider router={router} useTransitions={useTransitions} onError={onError} />;
    createRoot(root).render(<StrictMode>{options.wrap?.(app) ?? app}</StrictMode>);
    return router;
};
