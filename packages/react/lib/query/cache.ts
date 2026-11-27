import { toError } from '../http/ApiError';
import { session } from '../session/session';

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

interface Entry extends Source{
    snapshot: Snapshot;
    fetchedAt: number;
    run: number;
    pending: Promise<void> | null;
    listeners: Set<() => void>;
    idleSince: number;
}

const EMPTY: Snapshot = { data: undefined, error: undefined, fetching: false, landed: false };

class QueryCache{
    readonly #entries = new Map<string, Entry>();

    ensure(key: string, source: Source){
        if(this.#entries.has(key)) return;
        this.#sweep();
        this.#entries.set(key, { ...source, snapshot: EMPTY, fetchedAt: 0, run: 0, pending: null, listeners: new Set(), idleSince: Date.now() });
    }

    snapshot(key: string | null): Snapshot{
        return key === null ? EMPTY : this.#entries.get(key)?.snapshot ?? EMPTY;
    }

    subscribe(key: string, listener: () => void): () => void{
        const entry = this.#entries.get(key);
        entry?.listeners.add(listener);
        return () => {
            if(entry === undefined) return;
            entry.listeners.delete(listener);
            if(entry.listeners.size === 0) entry.idleSince = Date.now();
        };
    }

    fetch(key: string, { force = false, maxAge = 30_000 }: { force?: boolean; maxAge?: number } = {}): Promise<void>{
        const entry = this.#entries.get(key);
        if(entry === undefined) return Promise.resolve();
        if(!force && entry.pending !== null) return entry.pending;
        if(!force && Date.now() - entry.fetchedAt < maxAge) return Promise.resolve();

        const run = ++entry.run;
        this.#update(entry, { fetching: true });
        entry.pending = entry.load().then(
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

    #reset(key: string, entry: Entry){
        entry.run += 1;
        entry.pending = null;
        entry.fetchedAt = 0;
        this.#update(entry, EMPTY);
        if(entry.listeners.size > 0) void this.fetch(key, { force: true });
    }

    #sweep(){
        for(const [key, entry] of this.#entries){
            const idle = entry.listeners.size === 0 && entry.pending === null;
            if(idle && Date.now() - entry.idleSince > 300_000) this.#entries.delete(key);
        }
    }

    #update(entry: Entry, change: Partial<Snapshot>){
        entry.snapshot = { ...entry.snapshot, ...change };
        entry.listeners.forEach((listener) => listener());
    }
}

export const cache = new QueryCache();

session.onEnd(() => cache.clear());
