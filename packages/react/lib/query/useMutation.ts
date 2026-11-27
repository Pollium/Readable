import { toError } from '../http/ApiError';
import { ArgsOf, CallArgs, filledPath, isComplete, pathOf, PathValues, request } from '../http/call';
import { cache } from './cache';
import { Rollback } from './data';
import { Endpoint } from '@pollium/readable-contracts/routing';
import { useState } from 'react';

type Resource = Pick<Endpoint, 'path'>;

export interface MutationCall{
    path: PathValues;
    query?: object;
}

export interface MutationOptions<O, I = never>{
    base?: string;
    path?: PathValues;
    invalidates?: readonly Resource[];
    onSuccess?: (data: O) => void;
    optimistic?: (input: I, call: MutationCall) => Rollback | void;
}

export interface Mutation<I, O>{
    run: (...args: ArgsOf<I>) => Promise<O>;
    loading: boolean;
    error: Error | undefined;
    reset: () => void;
}

const isAncestor = (path: string, of: string): boolean => of.startsWith(`${path}/`);

const patternOf = ({ path }: Resource): RegExp =>
    new RegExp(`^${path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:\w+/g, '[^/]+')}$`);

const matching = (resources: readonly Resource[]) => {
    const patterns = resources.map(patternOf);
    return (path: string) => patterns.length === 0 || patterns.some((pattern) => pattern.test(path));
};

export const invalidate = (...resources: readonly Resource[]): Promise<void> => cache.refresh(matching(resources));

export const markStale = (...resources: readonly Resource[]): void => cache.markStale(matching(resources));

export const refreshAfter = (
    method: string,
    changed: string,
    invalidates: readonly Resource[] = [],
    base = ''
): Promise<void> => {
    const patterns = invalidates.map(patternOf);
    const onBranch = (path: string) => isAncestor(path, changed)
        || (method !== 'DELETE' && (path === changed || isAncestor(changed, path)));

    return cache.refresh((path, entryBase) => (entryBase === base && onBranch(path)) || patterns.some((pattern) => pattern.test(path)));
};

export const useMutation = <I, O>(
    endpoint: Endpoint<I, O>,
    { base, path, invalidates, onSuccess, optimistic }: MutationOptions<O, I> = {}
): Mutation<I, O> => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | undefined>(undefined);

    const refresh = (merged: CallArgs<unknown>) =>
        refreshAfter(endpoint.method, pathOf(endpoint.path, merged.path), invalidates, merged.base);

    // An optimistic change shows before the request leaves. When the api refuses, it is rolled back
    // and the branch refreshes, so the api's answer replaces whatever the rollback could not restore.
    const sent = async (merged: CallArgs<unknown>): Promise<O> => {
        const rollback = optimistic?.(merged.body as I, { path: filledPath(merged.path), query: merged.query });
        try{
            return await request(endpoint, merged) as O;
        }catch(cause: unknown){
            if(typeof rollback === 'function'){
                rollback();
                if(isComplete(endpoint.path, merged.path)) void refresh(merged);
            }
            throw cause;
        }
    };

    const run = async (...[args]: ArgsOf<I>): Promise<O> => {
        const merged: CallArgs<unknown> = { base, ...args, path: { ...path, ...args?.path } };
        setLoading(true);
        setError(undefined);

        try{
            const data = await sent(merged);
            void refresh(merged);
            onSuccess?.(data);
            return data;
        }catch(cause: unknown){
            setError(toError(cause));
            throw cause;
        }finally{
            setLoading(false);
        }
    };

    return {
        run,
        loading,
        error,
        reset: () => setError(undefined)
    };
};
