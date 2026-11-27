import { Target } from '../http/call';
import { useSession } from '../session/session';
import { cache, Snapshot } from './cache';
import { dataOf, gateOf } from './gate';
import { filled, isReady, keyOf, QueryTarget, sourceOf } from './source';
import { Pending, QueryOptions } from './useQuery';
import { PageOf } from '@pollium/readable-contracts/http';
import { Endpoint } from '@pollium/readable-contracts/routing';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

export interface Pages<T>{
    data: T[] | null;
    items: T[];
    total: number | null;
    loading: boolean;
    fetching: boolean;
    loadingMore: boolean;
    error: Error | undefined;
    hasMore: boolean;
    loadMore: () => void;
    reload: () => void;
    set: (items: T[] | ((items: T[]) => T[])) => void;
}

export interface PagesOptions extends Omit<QueryOptions<unknown, unknown>, 'select' | 'pollMs'>{
    limit?: number;
}

export type ItemOf<O> = O extends PageOf<infer T> ? T : never;

type Listener = () => void;

// How many pages the readers of a list have loaded, shared while any of them is on screen.
class Depths{
    readonly #depths = new Map<string, number>();
    readonly #listeners = new Map<string, Set<Listener>>();

    of(key: string | null): number{
        return key === null ? 1 : this.#depths.get(key) ?? 1;
    }

    set(key: string, depth: number){
        this.#depths.set(key, depth);
        this.#listeners.get(key)?.forEach((listener) => listener());
    }

    subscribe(key: string, listener: Listener): () => void{
        const listeners = this.#listeners.get(key) ?? new Set<Listener>();
        listeners.add(listener);
        this.#listeners.set(key, listeners);
        return () => {
            listeners.delete(listener);
            if(listeners.size > 0) return;
            this.#listeners.delete(key);
            this.#depths.delete(key);
        };
    }
}

const depths = new Depths();

const unsubscribed = () => undefined;

const pending = (snapshot: Snapshot): boolean => snapshot.fetching || (!snapshot.landed && snapshot.error === undefined);

const same = (a: readonly Snapshot[], b: readonly Snapshot[]): boolean =>
    a.length === b.length && a.every((snapshot, index) => snapshot === b[index]);

const pageTarget = <T extends Target>(target: T, limit: number, offset: number): T =>
    ({ ...target, query: { ...target.query, limit, offset } });

// The pages that have landed, from the first one on, and whether the api has more after them.
const progressOf = <T,>(snapshots: readonly Snapshot[], stride: number) => {
    const pages: PageOf<T>[] = [];
    for(const snapshot of snapshots){
        const page = dataOf<PageOf<T>>(snapshot);
        if(page === null) break;
        pages.push(page);
    }
    const last = pages.at(-1);
    return {
        pages,
        next: snapshots[pages.length] as Snapshot | undefined,
        hasMore: last !== undefined && last.meta.offset + stride < last.meta.total
    };
};

// The next page starts where the api said the first one ends, so a limit it lowered skips nothing.
export const usePages = <I, O extends PageOf<unknown>>(
    endpoint: Endpoint<I, O>,
    given: QueryTarget<I> | Pending = {} as QueryTarget<I>,
    { limit = 50, enabled = true, fresh = false, dependsOn, staleMs = 30_000, keepMs, retry }: PagesOptions = {}
): Pages<ItemOf<O>> => {
    type T = ItemOf<O>;
    const target = given && filled(given);
    const gate = gateOf(dependsOn, enabled);
    const ready = gate.open && Boolean(target) && isReady(endpoint, target || {});
    const listKey = ready ? keyOf(endpoint, pageTarget(target || {}, limit, 0)) : null;

    const subscribeDepth = useCallback(
        (listener: Listener) => listKey === null ? unsubscribed : depths.subscribe(listKey, listener),
        [listKey]
    );
    const depth = useSyncExternalStore(subscribeDepth, () => depths.of(listKey), () => 1);

    const keys: string[] = [];
    let stride = limit;
    for(let index = 0; ready && index < depth; index += 1){
        const paged = pageTarget(target || {}, index === 0 ? limit : stride, index * stride);
        const key = keyOf(endpoint, paged);
        cache.ensure(key, sourceOf(endpoint, paged), { keepMs, retry });
        keys.push(key);
        if(index === 0) stride = dataOf<PageOf<T>>(cache.snapshot(key))?.meta.limit || limit;
    }
    // The hooks below follow the keys by their text, the same whenever the keys are.
    const joined = JSON.stringify(keys);

    const subscribe = useCallback((listener: Listener) => {
        const offs = keys.map((key) => cache.subscribe(key, listener));
        return () => offs.forEach((off) => off());
    }, [joined]);
    const last = useRef<readonly Snapshot[]>([]);
    const read = () => {
        const next = keys.map((key) => cache.snapshot(key));
        if(!same(next, last.current)) last.current = next;
        return last.current;
    };
    const snapshots = useSyncExternalStore(subscribe, read, read);
    const token = useSession();

    const maxAge = fresh ? 0 : staleMs;
    useEffect(() => {
        for(const key of keys) void cache.fetch(key, { maxAge });
    }, [joined, token, maxAge]);

    const { pages, hasMore } = progressOf<T>(snapshots, stride);
    const items = useMemo(() => pages.flatMap((page) => page.items), [snapshots]);

    const loadMore = useCallback(() => {
        if(listKey === null) return;
        const progress = progressOf<T>(keys.map((key) => cache.snapshot(key)), stride);
        if(progress.next !== undefined){
            if(!pending(progress.next)) void cache.fetch(keys[progress.pages.length], { force: true });
            return;
        }
        if(progress.hasMore) depths.set(listKey, keys.length + 1);
    }, [joined, listKey, stride]);

    const upstreamReload = gate.failed?.reload;
    const reload = useCallback(() => {
        if(upstreamReload !== undefined) return upstreamReload();
        for(const key of keys) void cache.fetch(key, { force: true });
    }, [joined, upstreamReload]);

    // The items are cut into the loaded pages again, so each holds what the api would answer at its
    // offset; what no longer fits is on the next page the api has.
    const set = useCallback((update: T[] | ((items: T[]) => T[])) => {
        const loaded = progressOf<T>(keys.map((key) => cache.snapshot(key)), stride).pages;
        if(loaded.length === 0) return;

        const current = loaded.flatMap((page) => page.items);
        const next = typeof update === 'function' ? update(current) : update;
        const total = Math.max(0, (loaded.at(-1)?.meta.total ?? 0) + next.length - current.length);
        loaded.forEach((page, index) => cache.set(keys[index], {
            ...page,
            items: next.slice(index * stride, (index + 1) * stride),
            meta: { ...page.meta, total }
        }));
    }, [joined, stride]);

    const first = snapshots[0];
    return {
        data: ready && pages.length > 0 ? items : null,
        items,
        total: pages.at(-1)?.meta.total ?? null,
        loading: gate.waiting || (ready && first !== undefined && pending(first)),
        fetching: ready && snapshots.some((snapshot) => snapshot.fetching),
        loadingMore: snapshots.slice(1).some(pending),
        error: gate.failed?.error ?? snapshots.find((snapshot) => snapshot.error !== undefined)?.error,
        hasMore,
        loadMore,
        reload,
        set
    };
};
