import { AppCopy } from '../errors/copy';
import { defineErrors } from '@pollium/readable-contracts/errors';

export interface OutgoingRequest extends RequestInit{
    method: string;
    headers: Record<string, string>;
}

export type RequestHook = (init: OutgoingRequest, url: string) => void | Promise<void>;

export interface WebOptions{
    name: string;
    apiUrl?: string | (() => string | null | undefined);
    copy?: AppCopy;
    sessionKey?: string;
    legacyKeys?: readonly string[];
    timeoutMs?: number;
    credentials?: RequestCredentials;
    onRequest?: RequestHook;
}

export interface WebSettings{
    name: string;
    readonly apiUrl: string;
    copy: AppCopy | null;
    sessionKey: string;
    legacyKeys: readonly string[];
    timeoutMs: number;
    credentials: RequestCredentials | undefined;
    onRequest: RequestHook | null;
}

const ConfigErrors = defineErrors({
    domain: 'Config',
    causes: {
        NotConfigured: 500
    }
});

let current: WebSettings | null = null;

const baseOf = (url: string | null | undefined): string =>
    (url?.trim() || `${window.location.origin}/api`).replace(/\/+$/, '');

export const configure = ({
    name,
    apiUrl,
    copy,
    sessionKey,
    legacyKeys = [],
    timeoutMs = 0,
    credentials,
    onRequest
}: WebOptions) => {
    // A function is read on every call, so an app can point at another api while it runs.
    const fixed = typeof apiUrl === 'function' ? null : baseOf(apiUrl);
    current = {
        name,
        get apiUrl(){
            return fixed ?? baseOf((apiUrl as () => string | null | undefined)());
        },
        copy: copy ?? null,
        sessionKey: sessionKey?.trim() || `${name}.session`,
        legacyKeys,
        timeoutMs,
        credentials,
        onRequest: onRequest ?? null
    };
};

export const settings = (): WebSettings => {
    if(current === null) throw ConfigErrors.NotConfigured('call mount() or configure() first');
    return current;
};
