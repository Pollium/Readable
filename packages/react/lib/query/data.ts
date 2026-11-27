import { cache } from './cache';
import { filled, idOf, isReady, keyOf, QueryTarget, sourceOf } from './source';
import { Endpoint } from '@pollium/readable-contracts/routing';

export type Rollback = () => void;

export type DataUpdate<O> = O | ((current: O | undefined) => O | undefined);

const unchanged: Rollback = () => undefined;

export const getData = <I, O>(endpoint: Endpoint<I, O>, given: QueryTarget<I> = {} as QueryTarget<I>): O | undefined => {
    const target = filled(given);
    if(!isReady(endpoint, target)) return undefined;

    const { landed, data } = cache.snapshot(keyOf(endpoint, target));
    return landed ? data as O : undefined;
};

// Answers a rollback that puts back what was there, unless something newer has landed since.
export const setData = <I, O>(endpoint: Endpoint<I, O>, given: QueryTarget<I>, update: DataUpdate<O>): Rollback => {
    const target = filled(given);
    const key = keyOf(endpoint, target);
    cache.ensure(key, sourceOf(endpoint, target));

    const saved = cache.saved(key);
    const current = saved?.snapshot.landed ? saved.snapshot.data as O : undefined;
    const next = typeof update === 'function' ? (update as (current: O | undefined) => O | undefined)(current) : update;
    if(next === undefined || next === current) return unchanged;

    cache.set(key, next);
    return () => cache.restore(key, saved, next);
};

export const updateData = <I, O>(endpoint: Endpoint<I, O>, update: (data: O, target: QueryTarget<I>) => O | undefined): Rollback => {
    const rollbacks = cache.keysOf(idOf(endpoint)).flatMap((key) => {
        const saved = cache.saved(key);
        if(saved === undefined || !saved.snapshot.landed || saved.snapshot.data === undefined) return [];

        const next = update(saved.snapshot.data as O, cache.targetOf(key) as QueryTarget<I>);
        if(next === undefined || next === saved.snapshot.data) return [];

        cache.set(key, next);
        return [() => cache.restore(key, saved, next)];
    });

    return () => rollbacks.forEach((rollback) => rollback());
};

export const removeData = <I, O>(endpoint: Endpoint<I, O>, given?: QueryTarget<I>) => {
    if(given === undefined) return cache.forget(cache.keysOf(idOf(endpoint)));

    const target = filled(given);
    if(isReady(endpoint, target)) cache.forget([keyOf(endpoint, target)]);
};

export const clearData = () => cache.forget(cache.keysOf());
