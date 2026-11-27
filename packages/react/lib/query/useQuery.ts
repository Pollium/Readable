import { useSession } from '../session/session';
import { cache, Retry } from './cache';
import { dataOf, gateOf, queryOf } from './gate';
import { poll } from './poll';
import { filled, isReady, keyOf, QueryTarget, sourceOf } from './source';
import { Endpoint } from '@pollium/readable-contracts/routing';
import { useCallback, useEffect, useSyncExternalStore } from 'react';

export interface Query<T, O = T>{
    data: T | null;
    loading: boolean;
    fetching: boolean;
    error: Error | undefined;
    reload: () => void;
    set: (data: O) => void;
}

export type Upstream = Pick<Query<unknown>, 'data' | 'loading' | 'error' | 'reload'>;

export type Poll<O> = number | false | ((data: O | null) => number | false);

export interface QueryOptions<O, T>{
    select?: (data: O) => T;
    enabled?: boolean;
    fresh?: boolean;
    dependsOn?: Upstream | readonly Upstream[];
    staleMs?: number;
    keepMs?: number;
    pollMs?: Poll<O>;
    retry?: Retry;
}

export type Pending = false | null | undefined | '' | 0;

export interface FetchOptions{
    staleMs?: number;
    retry?: Retry;
}

export { keyOf };
export type { QueryTarget };

const unsubscribed = () => undefined;

export const prefetch = async <I, O>(endpoint: Endpoint<I, O>, given: QueryTarget<I> = {} as QueryTarget<I>): Promise<O | null> => {
    const target = filled(given);
    if(!isReady(endpoint, target)) return null;

    const key = keyOf(endpoint, target);
    cache.ensure(key, sourceOf(endpoint, target));
    await cache.fetch(key);

    const { data, error, landed } = cache.snapshot(key);
    return landed && error === undefined ? data as O : null;
};

// Like prefetch it answers what it read, but it throws what the api refused, or a missing path param,
// where prefetch answers null.
export const fetchQuery = async <I, O>(
    endpoint: Endpoint<I, O>,
    given: QueryTarget<I> = {} as QueryTarget<I>,
    { staleMs = 30_000, retry }: FetchOptions = {}
): Promise<O> => {
    const target = filled(given);
    const key = keyOf(endpoint, target);
    cache.ensure(key, sourceOf(endpoint, target));

    const before = cache.snapshot(key);
    await cache.fetch(key, { maxAge: staleMs, retry });
    const after = cache.snapshot(key);
    if(after !== before && after.error !== undefined) throw after.error;
    return after.data as O;
};

export const useQuery = <I, O, T = O>(
    endpoint: Endpoint<I, O>,
    given: QueryTarget<I> | Pending = {} as QueryTarget<I>,
    { select, enabled = true, fresh = false, dependsOn, staleMs = 30_000, keepMs, pollMs = false, retry }: QueryOptions<O, T> = {}
): Query<T, O> => {
    const target = given && filled(given);
    const gate = gateOf(dependsOn, enabled);
    const ready = gate.open && Boolean(target) && isReady(endpoint, target || {});
    const key = ready ? keyOf(endpoint, target || {}) : null;

    if(key !== null) cache.ensure(key, sourceOf(endpoint, target || {}), { keepMs, retry });

    const subscribe = useCallback(
        (listener: () => void) => key === null ? unsubscribed : cache.subscribe(key, listener),
        [key]
    );
    const snapshot = useSyncExternalStore(subscribe, () => cache.snapshot(key), () => cache.snapshot(key));
    const token = useSession();

    const maxAge = fresh ? 0 : staleMs;
    useEffect(() => {
        if(key !== null) void cache.fetch(key, { maxAge });
    }, [key, token, maxAge]);

    const every = typeof pollMs === 'function' ? pollMs(dataOf<O>(snapshot)) : pollMs;
    useEffect(() => {
        if(key === null || every === false || every <= 0 || snapshot.fetching) return;
        return poll(key, every);
    }, [key, every, snapshot]);

    const upstreamReload = gate.failed?.reload;
    const reload = useCallback(() => {
        if(upstreamReload !== undefined) return upstreamReload();
        if(key !== null) void cache.fetch(key, { force: true });
    }, [key, upstreamReload]);
    const set = useCallback((value: O) => {
        if(key !== null) cache.set(key, value);
    }, [key]);

    return queryOf(snapshot, ready, gate, select, reload, set);
};
