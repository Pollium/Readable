import { isComplete, pathOf, request, searchOf, Target } from '../http/call';
import { useSession } from '../session/session';
import { cache } from './cache';
import { Endpoint } from '@pollium/readable-contracts/routing';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

export interface Query<T, O = T>{
    data: T | null;
    loading: boolean;
    error: Error | undefined;
    reload: () => void;
    set: (data: O) => void;
}

export type AnyQuery = Query<unknown, never>;

export interface QueryOptions<O, T>{
    select?: (data: O) => T;
    enabled?: boolean;
    fresh?: boolean;
    dependsOn?: AnyQuery | readonly AnyQuery[];
}

export type Pending = false | null | undefined | '' | 0;

const headersKey = (headers: Target['headers']): string => headers === undefined
    ? ''
    : ` ${JSON.stringify(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)))}`;

export const keyOf = (endpoint: Pick<Endpoint, 'method' | 'path'>, { path, query, headers }: Target): string =>
    `${endpoint.method} ${pathOf(endpoint.path, path)}${searchOf(query)}${headersKey(headers)}`;

const unsubscribed = () => undefined;

export const useQuery = <O, T = O>(
    endpoint: Endpoint<never, O>,
    target: Target | Pending = {},
    { select, enabled = true, fresh = false, dependsOn }: QueryOptions<O, T> = {}
): Query<T, O> => {
    const upstream = [dependsOn ?? []].flat();
    const failed = upstream.find((query) => query.error !== undefined && query.data === null);
    const waiting = upstream.some((query) => query.loading && query.data === null);
    const ready = enabled && failed === undefined && !waiting && Boolean(target)
        && isComplete(endpoint.path, (target || {}).path);
    const key = ready ? keyOf(endpoint, target || {}) : null;

    if(key !== null){
        cache.ensure(key, pathOf(endpoint.path, (target || {}).path), () => request(endpoint, target || {}));
    }

    const subscribe = useCallback(
        (listener: () => void) => key === null ? unsubscribed : cache.subscribe(key, listener),
        [key]
    );
    const snapshot = useSyncExternalStore(subscribe, () => cache.snapshot(key), () => cache.snapshot(key));
    const token = useSession();

    useEffect(() => {
        if(key !== null) void cache.fetch(key, { maxAge: fresh ? 0 : 30_000 });
    }, [key, token, fresh]);

    const upstreamReload = failed?.reload;
    const reload = useCallback(() => {
        if(upstreamReload !== undefined) return upstreamReload();
        if(key !== null) void cache.fetch(key, { force: true });
    }, [key, upstreamReload]);
    const set = useCallback((value: O) => {
        if(key !== null) cache.set(key, value);
    }, [key]);

    const data = snapshot.landed && snapshot.data !== undefined ? snapshot.data as O : null;

    return {
        data: data === null ? null : select === undefined ? data as O & T : select(data),
        loading: waiting || (ready && (snapshot.fetching || (!snapshot.landed && snapshot.error === undefined))),
        error: failed?.error ?? (ready ? snapshot.error : undefined),
        reload,
        set
    };
};
