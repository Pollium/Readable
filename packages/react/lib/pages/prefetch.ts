import { matchPath } from 'react-router-dom';

type Loader = () => Promise<unknown>;

const loaders = new Map<string, Loader[]>();
const requested = new Map<string, Promise<void>>();

export const registerLoader = (path: string, load: Loader) => {
    loaders.set(path, [...loaders.get(path) ?? [], load]);
};

const patternOf = (path: string): string | undefined => loaders.has(path)
    ? path
    : [...loaders.keys()].find((pattern) => matchPath({ path: pattern, end: true }, path) !== null);

export const prefetchPage = (path: string): Promise<void> => {
    const pattern = patternOf(path);
    if(pattern === undefined) return Promise.resolve();

    const pending = requested.get(pattern);
    if(pending !== undefined) return pending;

    const loading = Promise.all(loaders.get(pattern)?.map((load) => load()) ?? [])
        .then(() => undefined)
        .catch(() => {
            requested.delete(pattern);
        });
    requested.set(pattern, loading);
    return loading;
};
