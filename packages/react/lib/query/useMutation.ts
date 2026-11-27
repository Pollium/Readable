import { toError } from '../http/ApiError';
import { ArgsOf, CallArgs, pathOf, PathValues, request } from '../http/call';
import { cache } from './cache';
import { Endpoint } from '@pollium/readable-contracts/routing';
import { useState } from 'react';

type Resource = Pick<Endpoint, 'path'>;

export interface MutationOptions<O>{
    base?: string;
    path?: PathValues;
    invalidates?: readonly Resource[];
    onSuccess?: (data: O) => void;
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
    { base, path, invalidates, onSuccess }: MutationOptions<O> = {}
): Mutation<I, O> => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | undefined>(undefined);

    const run = async (...[args]: ArgsOf<I>): Promise<O> => {
        const merged: CallArgs<unknown> = { base, ...args, path: { ...path, ...args?.path } };
        setLoading(true);
        setError(undefined);

        try{
            const data = await request(endpoint, merged) as O;
            void refreshAfter(endpoint.method, pathOf(endpoint.path, merged.path), invalidates, merged.base);
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
