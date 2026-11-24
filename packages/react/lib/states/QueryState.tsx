import { Query } from '../query/useQuery';
import { PageOf } from '@pollium/readable-contracts/http';
import { ReactNode } from 'react';

export interface QueryStateProps<T>{
    query: Pick<Query<T>, 'data' | 'loading' | 'error' | 'reload'>;
    loading?: ReactNode;
    failed?: (error: Error, retry: () => void) => ReactNode;
    stale?: (error: Error, retry: () => void) => ReactNode;
    empty?: ReactNode;
    isEmpty?: (data: T) => boolean;
    reloading?: boolean;
    children: (data: T) => ReactNode;
}

const isBlank = (data: unknown): boolean => {
    if(Array.isArray(data)) return data.length === 0;
    const items = (data as Partial<PageOf<unknown>> | null)?.items;
    return Array.isArray(items) && items.length === 0;
};

export const QueryState = <T,>({
    query,
    loading = null,
    failed,
    stale,
    empty,
    isEmpty = isBlank,
    reloading = false,
    children
}: QueryStateProps<T>): ReactNode => {
    if(query.loading && (reloading || query.data === null)) return loading;
    if(query.error !== undefined && query.data === null) return failed?.(query.error, query.reload) ?? null;
    if(query.data === null) return null;
    if(empty !== undefined && isEmpty(query.data)) return empty;

    return (
        <>
            {children(query.data)}
            {query.error === undefined ? null : stale?.(query.error, query.reload)}
        </>
    );
};
