import { settings } from '../app/config';
import { useSyncExternalStore } from 'react';

type Listener = () => void;

const keyOf = (): string => `${settings().name}.session`;

const stored = (): string | null => {
    try{
        return localStorage.getItem(keyOf());
    }catch{
        return null;
    }
};

const store = (token: string | null) => {
    try{
        if(token === null) localStorage.removeItem(keyOf());
        else localStorage.setItem(keyOf(), token);
    }catch{
        return;
    }
};

class Session{
    #token: string | null | undefined;
    readonly #listeners = new Set<Listener>();
    readonly #endings = new Set<Listener>();

    constructor(){
        if(typeof window !== 'undefined') window.addEventListener('storage', this.#onStorage);
    }

    get token(): string | null{
        if(this.#token === undefined) this.#token = stored();
        return this.#token;
    }

    start(token: string){
        store(token);
        this.#set(token);
    }

    end(token = this.token){
        if(token === null || token !== this.token) return;
        store(null);
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
        if(event.key !== keyOf() || event.newValue === this.token) return;
        if(event.newValue !== null) return this.#set(event.newValue);

        this.#set(null);
        this.#endings.forEach((ending) => ending());
    };
}

export const session = new Session();

export const useSession = (): string | null =>
    useSyncExternalStore(session.subscribe, () => session.token, () => null);
