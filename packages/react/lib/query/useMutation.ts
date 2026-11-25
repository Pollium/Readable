import { toError } from '../http/ApiError';
import { ArgsOf, CallArgs, pathOf, PathValues, request } from '../http/call';
import { cache } from './cache';
import { Endpoint } from '@pollium/readable-contracts/routing';
import { useState } from 'react';

type Resource = Pick<Endpoint, 'path'>;

export interface MutationOptions<O>{
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

export const invalidate = (...resources: readonly Resource[]): Promise<void> => {
    const patterns = resources.map(patternOf);
    return cache.refresh((path) => patterns.some((pattern) => pattern.test(path)));
};

export const refreshAfter = (
    method: string,
    changed: string,
    invalidates: readonly Resource[] = []
): Promise<void> => {
    const patterns = invalidates.map(patternOf);
    const onBranch = (path: string) => isAncestor(path, changed)
        || (method !== 'DELETE' && (path === changed || isAncestor(changed, path)));

    return cache.refresh((path) => onBranch(path) || patterns.some((pattern) => pattern.test(path)));
};

export const useMutation = <I, O>(
    endpoint: Endpoint<I, O>,
    { path, invalidates, onSuccess }: MutationOptions<O> = {}
): Mutation<I, O> => {
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | undefined>(undefined);

    const run = async (...[args]: ArgsOf<I>): Promise<O> => {
        const merged: CallArgs<unknown> = { ...args, path: { ...path, ...args?.path } };
        setLoading(true);
        setError(undefined);

        try{
            const data = await request(endpoint, merged) as O;
            void refreshAfter(endpoint.method, pathOf(endpoint.path, merged.path), invalidates);
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
