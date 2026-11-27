import { ApiError, toError } from '../http/ApiError';
import { session } from '../session/session';

export type Retry = number | ((error: Error, attempt: number) => boolean);

export interface Keeping{
    keepMs?: number;
    retry?: Retry;
}

export interface Snapshot{
    data: unknown;
    error: Error | undefined;
    fetching: boolean;
    landed: boolean;
}

export interface Source{
    endpoint: string;
    path: string;
    base: string;
    target: object;
    load: () => Promise<unknown>;
}

export interface Saved{
    snapshot: Snapshot;
    fetchedAt: number;
}

interface Entry extends Source, Keeping{
    read: boolean;
    snapshot: Snapshot;
    fetchedAt: number;
    run: number;
    pending: Promise<void> | null;
    listeners: Set<() => void>;
    idleSince: number;
}

const EMPTY: Snapshot = { data: undefined, error: undefined, fetching: false, landed: false };

const KEEP_MS = 300_000;

// A count retries only what may answer otherwise the next time: no answer at all, or an api that was
// down, busy or limiting. A function decides for any error.
const retries = (retry: Retry | undefined, error: Error, attempt: number): boolean => {
    if(retry === undefined) return false;
    if(typeof retry === 'function') return retry(error, attempt);

    const transient = error instanceof ApiError
        && (error.status === 0 || error.status === 408 || error.status === 429 || error.status >= 500);
    return transient && attempt <= retry;
};

const delayOf = (attempt: number): number => Math.min(1_000 * 2 ** (attempt - 1), 30_000);

const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

class QueryCache{
    readonly #entries = new Map<string, Entry>();

    // An entry kept by several queries is kept as long as the longest of them asks.
    ensure(key: string, source: Source, { keepMs, retry }: Keeping = {}){
        const found = this.#entries.get(key);
        if(found !== undefined && !this.#expired(found)){
            if(keepMs !== undefined) found.keepMs = Math.max(found.keepMs ?? 0, keepMs);
            if(retry !== undefined) found.retry = retry;
            return;
        }

        this.#sweep();
        this.#entries.set(key, {
            ...source,
            keepMs,
            retry,
            read: false,
            snapshot: EMPTY,
            fetchedAt: 0,
            run: 0,
            pending: null,
            listeners: new Set(),
            idleSince: Date.now()
        });
    }

    snapshot(key: string | null): Snapshot{
        return key === null ? EMPTY : this.#entries.get(key)?.snapshot ?? EMPTY;
    }

    subscribe(key: string, listener: () => void): () => void{
        const entry = this.#entries.get(key);
        entry?.listeners.add(listener);
        if(entry !== undefined) entry.read = true;
        return () => {
            if(entry === undefined) return;
            entry.listeners.delete(listener);
            if(entry.listeners.size === 0) entry.idleSince = Date.now();
        };
    }

    fetch(key: string, { force = false, maxAge = 30_000, retry }: { force?: boolean; maxAge?: number; retry?: Retry } = {}): Promise<void>{
        const entry = this.#entries.get(key);
        if(entry === undefined) return Promise.resolve();
        if(!force && entry.pending !== null) return entry.pending;
        if(!force && entry.fetchedAt > 0 && Date.now() - entry.fetchedAt < maxAge) return Promise.resolve();

        const run = ++entry.run;
        this.#update(entry, { fetching: true });
        entry.pending = this.#load(entry, run, retry ?? entry.retry).then(
            (data) => {
                if(run !== entry.run) return;
                entry.fetchedAt = Date.now();
                this.#update(entry, { data, error: undefined, fetching: false, landed: true });
            },
            (cause: unknown) => {
                if(run !== entry.run) return;
                this.#update(entry, { error: toError(cause), fetching: false });
            }
        ).finally(() => {
            if(run === entry.run) entry.pending = null;
        });
        return entry.pending;
    }

    set(key: string, data: unknown){
        const entry = this.#entries.get(key);
        if(entry === undefined) return;
        entry.run += 1;
        entry.pending = null;
        entry.fetchedAt = Date.now();
        this.#update(entry, { data, error: undefined, fetching: false, landed: true });
    }

    saved(key: string): Saved | undefined{
        const entry = this.#entries.get(key);
        return entry === undefined ? undefined : { snapshot: entry.snapshot, fetchedAt: entry.fetchedAt };
    }

    // Puts back what was there before `written`, unless something newer has landed since.
    restore(key: string, saved: Saved | undefined, written: unknown){
        const entry = this.#entries.get(key);
        if(entry === undefined || !entry.snapshot.landed || entry.snapshot.data !== written) return;
        if(saved === undefined || !saved.snapshot.landed) return this.#reset(key, entry);

        entry.run += 1;
        entry.pending = null;
        entry.fetchedAt = saved.fetchedAt;
        this.#update(entry, { ...saved.snapshot, fetching: false });
        if(saved.snapshot.fetching && entry.listeners.size > 0) void this.fetch(key, { force: true });
    }

    keysOf(endpoint?: string): string[]{
        return [...this.#entries].filter(([, entry]) => endpoint === undefined || entry.endpoint === endpoint).map(([key]) => key);
    }

    targetOf(key: string): object | undefined{
        return this.#entries.get(key)?.target;
    }

    // A query on screen asks again at once; any other answer is dropped.
    forget(keys: readonly string[]){
        for(const key of keys){
            const entry = this.#entries.get(key);
            if(entry === undefined) continue;
            if(entry.listeners.size > 0) this.#reset(key, entry);
            else this.#entries.delete(key);
        }
    }

    async refresh(matches: (path: string, base: string) => boolean){
        const refreshing: Promise<void>[] = [];
        for(const [key, entry] of this.#entries){
            if(!matches(entry.path, entry.base)) continue;
            entry.fetchedAt = 0;
            if(entry.listeners.size > 0) refreshing.push(this.fetch(key, { force: true }));
        }
        await Promise.all(refreshing);
    }

    clear(){
        for(const entry of this.#entries.values()){
            entry.run += 1;
            entry.pending = null;
            entry.fetchedAt = 0;
            this.#update(entry, EMPTY);
        }
    }

    // Retries wait 1, 2, 4 s and so on, up to 30 s, and stop once a newer run has started.
    #load(entry: Entry, run: number, retry: Retry | undefined, attempt = 1): Promise<unknown>{
        return entry.load().catch(async (cause: unknown) => {
            if(run !== entry.run || !retries(retry, toError(cause), attempt)) throw cause;
            await wait(delayOf(attempt));
            if(run !== entry.run) throw cause;
            return this.#load(entry, run, retry, attempt + 1);
        });
    }

    // An answer nobody has read yet, such as a prefetched one, is kept for the default time.
    #expired(entry: Entry): boolean{
        const idle = entry.listeners.size === 0 && entry.pending === null;
        const keep = entry.read ? entry.keepMs ?? KEEP_MS : KEEP_MS;
        return idle && Date.now() - entry.idleSince >= keep;
    }

    #reset(key: string, entry: Entry){
        entry.run += 1;
        entry.pending = null;
        entry.fetchedAt = 0;
        this.#update(entry, EMPTY);
        if(entry.listeners.size > 0) void this.fetch(key, { force: true });
    }

    #sweep(){
        for(const [key, entry] of this.#entries){
            if(this.#expired(entry)) this.#entries.delete(key);
        }
    }

    #update(entry: Entry, change: Partial<Snapshot>){
        entry.snapshot = { ...entry.snapshot, ...change };
        entry.listeners.forEach((listener) => listener());
    }
}

export const cache = new QueryCache();

session.onEnd(() => cache.clear());
