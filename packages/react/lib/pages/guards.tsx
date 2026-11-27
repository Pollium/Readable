import { openedPage, PageMeta } from './meta';
import type { PageTier } from './routes';
import { useSession } from '../session/session';
import { ReactNode, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Navigate, Outlet, useLocation, useMatches } from 'react-router-dom';

export interface GuardContext{
    tier: PageTier;
    path: string;
    search: string;
    params: Readonly<Record<string, string | undefined>>;
    meta: PageMeta | undefined;
    session: string | null;
}

export type Verdict = string | null | undefined;

export type Guard = (context: GuardContext) => Verdict | PromiseLike<Verdict>;

export type TierGuards = Partial<Record<PageTier, readonly Guard[]>>;

type Outcome = { to: Verdict } | { error: unknown };

let round = 0;
const listeners = new Set<() => void>();

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
};

// Guards run again on every navigation and when the session changes. Something else they read, a team
// that was just deleted, asks for another round with this.
export const recheckGuards = () => {
    round += 1;
    listeners.forEach((listener) => listener());
};

export const isPending = <T,>(value: unknown): value is PromiseLike<T> =>
    typeof (value as PromiseLike<T> | null)?.then === 'function';

// The first guard that names a path wins. The answer stays synchronous while every guard answers at once,
// so a page whose guards all do draws without the pending state.
const decide = (guards: readonly Guard[], context: GuardContext, from = 0): Verdict | Promise<Verdict> => {
    for(let at = from; at < guards.length; at += 1){
        const verdict = guards[at](context);
        if(isPending<Verdict>(verdict)) return Promise.resolve(verdict).then((to) => to ? to : decide(guards, context, at + 1));
        if(verdict) return verdict;
    }
    return null;
};

interface GuardedProps{
    tier: PageTier;
    guards: readonly Guard[];
    pending?: ReactNode;
}

export const Guarded = ({ tier, guards, pending = null }: GuardedProps) => {
    const session = useSession();
    const { pathname, search } = useLocation();
    const matches = useMatches();
    const checks = useSyncExternalStore(subscribe, () => round, () => round);
    const key = `${checks} ${session ?? ''} ${pathname}${search}`;
    const verdict = useMemo(() => decide(guards, {
        tier,
        path: pathname,
        search,
        params: matches.at(-1)?.params ?? {},
        meta: openedPage(matches)?.meta,
        session
    }), [key]);
    const [settled, setSettled] = useState<{ key: string; outcome: Outcome } | null>(null);

    useEffect(() => {
        if(!isPending<Verdict>(verdict)) return;

        let live = true;
        verdict.then(
            (to) => live && setSettled({ key, outcome: { to } }),
            (error: unknown) => live && setSettled({ key, outcome: { error } })
        );
        return () => {
            live = false;
        };
    }, [verdict, key]);

    const outcome = isPending(verdict) ? settled?.key === key ? settled.outcome : undefined : { to: verdict };
    if(outcome === undefined) return pending;
    if('error' in outcome) throw outcome.error;

    const { to } = outcome;
    const here = to === pathname || to === `${pathname}${search}`;
    return !to || here ? <Outlet /> : <Navigate to={to} replace />;
};
