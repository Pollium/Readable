import { settings } from '../app/config';
import { session } from '../session/session';
import { SocketClose } from '@pollium/readable-contracts/gateway';

export type ChannelStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

type Handler<T> = (value: T) => void;

interface Frame{
    type?: unknown;
    data?: unknown;
    error?: unknown;
    sessionId?: unknown;
}

export type ErrorHandler = (error: string, sessionId: string | undefined) => void;

const ENDS_SESSION: number[] = [SocketClose.SessionExpired, SocketClose.AccessRevoked];

const subscribed = <T>(handlers: Set<Handler<T>>, handler: Handler<T>): (() => void) => {
    handlers.add(handler);
    return () => {
        handlers.delete(handler);
    };
};

export class SocketChannel{
    readonly #path: string;
    #socket: WebSocket | null = null;
    #status: ChannelStatus = 'connecting';
    #attempts = 0;
    #retry: ReturnType<typeof setTimeout> | null = null;
    #closed = false;
    readonly #frames = new Map<string, Set<Handler<unknown>>>();
    readonly #statuses = new Set<Handler<ChannelStatus>>();
    readonly #errors = new Set<ErrorHandler>();

    constructor(path: string){
        this.#path = path;
        window.addEventListener('online', this.#recover);
        document.addEventListener('visibilitychange', this.#onVisibility);
        this.#connect();
    }

    send(type: string, data?: unknown): boolean{
        if(this.#socket?.readyState !== WebSocket.OPEN) return false;
        this.#socket.send(JSON.stringify({ type, ...data as object }));
        return true;
    }

    on(type: string, handler: Handler<unknown>): () => void{
        const handlers = this.#frames.get(type) ?? new Set<Handler<unknown>>();
        this.#frames.set(type, handlers);
        return subscribed(handlers, handler);
    }

    onStatus(handler: Handler<ChannelStatus>): () => void{
        handler(this.#status);
        return subscribed(this.#statuses, handler);
    }

    onError(handler: ErrorHandler): () => void{
        this.#errors.add(handler);
        return () => {
            this.#errors.delete(handler);
        };
    }

    close(){
        this.#closed = true;
        this.#clearRetry();
        window.removeEventListener('online', this.#recover);
        document.removeEventListener('visibilitychange', this.#onVisibility);
        this.#setStatus('closed');
        this.#socket?.close();
        this.#socket = null;
    }

    #connect(){
        if(this.#closed) return;
        this.#clearRetry();
        this.#setStatus(this.#attempts === 0 ? 'connecting' : 'reconnecting');

        const token = session.token;
        const url = `${settings().apiUrl.replace(/^http/, 'ws')}${this.#path}`;
        const socket = token === null ? new WebSocket(url) : new WebSocket(url, token);
        this.#socket = socket;

        socket.onopen = () => {
            this.#attempts = 0;
            this.#setStatus('open');
        };
        socket.onmessage = (event: MessageEvent) => this.#dispatch(event.data);
        socket.onclose = (event: CloseEvent) => this.#onClose(event.code, token);
    }

    #onClose(code: number, token: string | null){
        this.#socket = null;
        if(this.#closed) return;
        if(ENDS_SESSION.includes(code) && token !== null && token === session.token){
            session.end(token);
            this.#setStatus('closed');
            return;
        }

        this.#setStatus('reconnecting');
        const ceiling = Math.min(10_000, 500 * 2 ** this.#attempts);
        this.#attempts += 1;
        this.#retry = setTimeout(() => this.#connect(), ceiling / 2 + Math.random() * ceiling / 2);
    }

    #dispatch(raw: unknown){
        if(typeof raw !== 'string') return;

        let frame: Frame;
        try{
            frame = JSON.parse(raw) as Frame;
        }catch{
            return;
        }

        const { type, data, error, sessionId } = frame;
        const session = typeof sessionId === 'string' ? sessionId : undefined;
        if(typeof error === 'string') return this.#errors.forEach((handler) => handler(error, session));
        if(typeof type === 'string') this.#frames.get(type)?.forEach((handler) => handler(data));
    }

    #setStatus(status: ChannelStatus){
        if(status === this.#status) return;
        this.#status = status;
        this.#statuses.forEach((handler) => handler(status));
    }

    #clearRetry(){
        if(this.#retry === null) return;
        clearTimeout(this.#retry);
        this.#retry = null;
    }

    #onVisibility = () => {
        if(document.visibilityState === 'visible') this.#recover();
    };

    #recover = () => {
        if(this.#closed || this.#status === 'closed') return;
        const state = this.#socket?.readyState;
        if(state === WebSocket.OPEN || state === WebSocket.CONNECTING) return;
        this.#attempts = 0;
        this.#connect();
    };
}

interface Held{
    channel: SocketChannel;
    holders: number;
}

class Channels{
    readonly #held = new Map<string, Held>();

    acquire(path: string): SocketChannel{
        const held = this.#held.get(path) ?? { channel: new SocketChannel(path), holders: 0 };
        held.holders += 1;
        this.#held.set(path, held);
        return held.channel;
    }

    release(path: string){
        const held = this.#held.get(path);
        if(held === undefined) return;
        held.holders -= 1;
        if(held.holders > 0) return;
        held.channel.close();
        this.#held.delete(path);
    }

    peek(path: string): SocketChannel | undefined{
        return this.#held.get(path)?.channel;
    }
}

export const channels = new Channels();
