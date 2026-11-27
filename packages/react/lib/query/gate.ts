import { Snapshot } from './cache';
import { Query, Upstream } from './useQuery';

export interface Gate{
    open: boolean;
    waiting: boolean;
    failed: Upstream | undefined;
}

// A query waits for those it depends on, and fails with the first one that failed.
export const gateOf = (dependsOn: Upstream | readonly Upstream[] | undefined, enabled: boolean): Gate => {
    const upstream = [dependsOn ?? []].flat();
    const failed = upstream.find((query) => query.error !== undefined && query.data === null);
    const waiting = upstream.some((query) => query.loading && query.data === null);
    return { open: enabled && failed === undefined && !waiting, waiting, failed };
};

export const dataOf = <O,>(snapshot: Snapshot): O | null =>
    snapshot.landed && snapshot.data !== undefined ? snapshot.data as O : null;

export const queryOf = <O, T>(
    snapshot: Snapshot,
    ready: boolean,
    { waiting, failed }: Gate,
    select: ((data: O) => T) | undefined,
    reload: () => void,
    set: (data: O) => void
): Query<T, O> => {
    const data = dataOf<O>(snapshot);
    return {
        data: data === null ? null : select === undefined ? data as O & T : select(data),
        loading: waiting || (ready && (snapshot.fetching || (!snapshot.landed && snapshot.error === undefined))),
        fetching: ready && snapshot.fetching,
        error: failed?.error ?? (ready ? snapshot.error : undefined),
        reload,
        set
    };
};
