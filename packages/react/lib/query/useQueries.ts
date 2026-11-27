import { useSession } from '../session/session';
import { cache, Snapshot } from './cache';
import { gateOf, queryOf } from './gate';
import { filled, isReady, keyOf, QueryTarget, sourceOf } from './source';
import { Pending, Query, QueryOptions } from './useQuery';
import { Endpoint } from '@pollium/readable-contracts/routing';
import { useCallback, useEffect, useMemo, useRef, useSyncExternalStore } from 'react';

export type QueriesOptions<O, T> = Omit<QueryOptions<O, T>, 'pollMs'>;

const same = (a: readonly Snapshot[], b: readonly Snapshot[]): boolean =>
    a.length === b.length && a.every((snapshot, index) => snapshot === b[index]);

// One query per target, read with one subscription; each target waits on its own.
export const useQueries = <I, O, T = O>(
    endpoint: Endpoint<I, O>,
    targets: readonly (QueryTarget<I> | Pending)[],
    { select, enabled = true, fresh = false, dependsOn, staleMs = 30_000, keepMs, retry }: QueriesOptions<O, T> = {}
): Query<T, O>[] => {
    const gate = gateOf(dependsOn, enabled);
    const keys = targets.map((given) => {
        const target = given && filled(given);
        if(!gate.open || !target || !isReady(endpoint, target)) return null;

        const key = keyOf(endpoint, target);
        cache.ensure(key, sourceOf(endpoint, target), { keepMs, retry });
        return key;
    });
    // The hooks below follow the keys by their text, the same whenever the keys are.
    const joined = JSON.stringify(keys);

    const subscribe = useCallback((listener: () => void) => {
        const offs = keys.flatMap((key) => key === null ? [] : [cache.subscribe(key, listener)]);
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
        for(const key of keys){
            if(key !== null) void cache.fetch(key, { maxAge });
        }
    }, [joined, token, maxAge]);

    const upstreamReload = gate.failed?.reload;
    const handles = useMemo(() => keys.map((key) => ({
        reload: () => {
            if(upstreamReload !== undefined) return upstreamReload();
            if(key !== null) void cache.fetch(key, { force: true });
        },
        set: (value: O) => {
            if(key !== null) cache.set(key, value);
        }
    })), [joined, upstreamReload]);

    return snapshots.map((snapshot, index) =>
        queryOf(snapshot, keys[index] !== null, gate, select, handles[index].reload, handles[index].set));
};
