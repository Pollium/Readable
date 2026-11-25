import { toError } from '../http/ApiError';
import { session } from '../session/session';

export interface Snapshot{
    data: unknown;
    error: Error | undefined;
    fetching: boolean;
    landed: boolean;
}

interface Entry{
    path: string;
    load: () => Promise<unknown>;
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

    ensure(key: string, path: string, load: () => Promise<unknown>){
        if(this.#entries.has(key)) return;
        this.#sweep();
        this.#entries.set(key, { path, load, snapshot: EMPTY, fetchedAt: 0, run: 0, pending: null, listeners: new Set(), idleSince: Date.now() });
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

    fetch(key: string, force = false): Promise<void>{
        const entry = this.#entries.get(key);
        if(entry === undefined) return Promise.resolve();
        if(!force && entry.pending !== null) return entry.pending;
        if(!force && Date.now() - entry.fetchedAt < 30_000) return Promise.resolve();

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

    async refresh(matches: (path: string) => boolean){
        const refreshing: Promise<void>[] = [];
        for(const [key, entry] of this.#entries){
            if(!matches(entry.path)) continue;
            entry.fetchedAt = 0;
            if(entry.listeners.size > 0) refreshing.push(this.fetch(key, true));
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
