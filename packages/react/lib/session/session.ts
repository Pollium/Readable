import { settings, WebSettings } from '../app/config';
import { useSyncExternalStore } from 'react';

type Listener = () => void;

const stored = (key: string): string | null => {
    try{
        return localStorage.getItem(key);
    }catch{
        return null;
    }
};

const store = (key: string, token: string | null) => {
    try{
        if(token === null) localStorage.removeItem(key);
        else localStorage.setItem(key, token);
    }catch{
        return;
    }
};

// An app that kept its token under another key keeps its users signed in: the first read takes the
// token from there once, and the old keys are emptied so a later sign-out cannot bring it back.
const restored = ({ sessionKey: key, legacyKeys }: WebSettings): string | null => {
    const token = stored(key);
    if(token !== null) return token;

    const legacy = legacyKeys.map(stored).find((found) => found !== null && found !== '') ?? null;
    if(legacy === null) return null;

    store(key, legacy);
    legacyKeys.forEach((old) => store(old, null));
    return legacy;
};

class Session{
    #read: WebSettings | null = null;
    #token: string | null = null;
    readonly #listeners = new Set<Listener>();
    readonly #endings = new Set<Listener>();

    constructor(){
        if(typeof window !== 'undefined') window.addEventListener('storage', this.#onStorage);
    }

    // Read again after every configure(), which may name another key.
    get token(): string | null{
        const current = settings();
        if(current !== this.#read){
            this.#read = current;
            this.#token = restored(current);
        }
        return this.#token;
    }

    start(token: string){
        this.#read = settings();
        store(this.#read.sessionKey, token);
        this.#set(token);
    }

    end(token = this.token){
        if(token === null || token !== this.token) return;
        store(settings().sessionKey, null);
        this.#set(null);
        this.#endings.forEach((ending) => ending());
    }

    subscribe = (listener: Listener): (() => void) => {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    };

    onEnd(ending: Listener): () => void{
        this.#endings.add(ending);
        return () => {
            this.#endings.delete(ending);
        };
    }

    #set(token: string | null){
        this.#token = token;
        this.#listeners.forEach((listener) => listener());
    }

    #onStorage = (event: StorageEvent) => {
        if(event.key !== settings().sessionKey || event.newValue === this.token) return;
        if(event.newValue !== null) return this.#set(event.newValue);

        this.#set(null);
        this.#endings.forEach((ending) => ending());
    };
}

export const session = new Session();

export const useSession = (): string | null =>
    useSyncExternalStore(session.subscribe, () => session.token, () => null);
