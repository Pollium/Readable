import { call, isComplete, pathOf, searchOf, Target } from '../http/call';
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
    dependsOn?: AnyQuery | readonly AnyQuery[];
}

export type Pending = false | null | undefined | '' | 0;

export const keyOf = (endpoint: Pick<Endpoint, 'method' | 'path'>, { path, query }: Target): string =>
    `${endpoint.method} ${pathOf(endpoint.path, path)}${searchOf(query)}`;

const unsubscribed = () => undefined;

export const useQuery = <O, T = O>(
    endpoint: Endpoint<never, O>,
    target: Target | Pending = {},
    { select, enabled = true, dependsOn }: QueryOptions<O, T> = {}
): Query<T, O> => {
    const upstream = [dependsOn ?? []].flat();
    const failed = upstream.find((query) => query.error !== undefined && query.data === null);
    const waiting = upstream.some((query) => query.loading && query.data === null);
    const ready = enabled && failed === undefined && !waiting && Boolean(target)
        && isComplete(endpoint.path, (target || {}).path);
    const key = ready ? keyOf(endpoint, target || {}) : null;

    if(key !== null){
        cache.ensure(key, pathOf(endpoint.path, (target || {}).path), () => call(endpoint, target || {}));
    }

    const subscribe = useCallback(
        (listener: () => void) => key === null ? unsubscribed : cache.subscribe(key, listener),
        [key]
    );
    const snapshot = useSyncExternalStore(subscribe, () => cache.snapshot(key), () => cache.snapshot(key));

    useEffect(() => {
        if(key !== null) void cache.fetch(key);
    }, [key]);

    const data = snapshot.landed ? snapshot.data as O : null;

    return {
        data: data === null ? null : select === undefined ? data as O & T : select(data),
        loading: waiting || (ready && (snapshot.fetching || (!snapshot.landed && snapshot.error === undefined))),
        error: failed?.error ?? (ready ? snapshot.error : undefined),
        reload: () => {
            if(failed !== undefined) return failed.reload();
            if(key !== null) void cache.fetch(key, true);
        },
        set: (value: O) => {
            if(key !== null) cache.set(key, value);
        }
    };
};
