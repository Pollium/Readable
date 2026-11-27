import { Body, filledPath, isComplete, pathOf, request, searchOf, Target } from '../http/call';
import { Source } from './cache';
import { Endpoint } from '@pollium/readable-contracts/routing';

export type QueryTarget<I> = Target & Body<I>;

const headersKey = (headers: Target['headers']): string => headers === undefined
    ? ''
    : ` ${JSON.stringify(Object.entries(headers).sort(([a], [b]) => a.localeCompare(b)))}`;

const bodyKey = (body: unknown): string => body === undefined ? '' : ` ${JSON.stringify(body)}`;

export const keyOf = (
    endpoint: Pick<Endpoint, 'method' | 'path'>,
    { base = '', path, query, headers, body }: Target & { body?: unknown }
): string => `${endpoint.method} ${base}${pathOf(endpoint.path, path)}${searchOf(query)}${headersKey(headers)}${bodyKey(body)}`;

export const idOf = (endpoint: Pick<Endpoint, 'method' | 'path'>): string => `${endpoint.method} ${endpoint.path}`;

// The defaults are read once, so the answer is asked for and kept under the same path.
export const filled = <T extends Target>(target: T): T => ({ ...target, path: filledPath(target.path) });

export const isReady = (endpoint: Pick<Endpoint, 'path'>, target: Target): boolean => isComplete(endpoint.path, target.path);

export const sourceOf = (endpoint: Pick<Endpoint, 'method' | 'path'>, target: Target & { body?: unknown }): Source => ({
    endpoint: idOf(endpoint),
    path: pathOf(endpoint.path, target.path),
    base: target.base ?? '',
    target,
    load: () => request(endpoint, target)
});
