import { settings } from '../app/config';
import { session } from '../session/session';
import { SocketClose } from '@pollium/readable-contracts/gateway';
import { CloseVerdict, GatewayLink, LinkSocket, LinkStatus } from '@pollium/readable-contracts/gateway-link';

export type {
    AnswerHandler,
    ErrorHandler,
    FrameHandler,
    LinkRequestOptions as RequestOptions,
    LinkSendOptions as SendOptions
} from '@pollium/readable-contracts/gateway-link';

export type ChannelStatus = LinkStatus;

export class SocketChannel extends GatewayLink{
    readonly #path: string;
    #token: string | null = null;
    readonly #unsubscribe: () => void;

    constructor(path: string){
        super();
        this.#path = path;
        window.addEventListener('online', this.#recover);
        document.addEventListener('visibilitychange', this.#onVisibility);
        this.#unsubscribe = session.subscribe(this.#onSession);
        this.connect();
    }

    close(){
        window.removeEventListener('online', this.#recover);
        document.removeEventListener('visibilitychange', this.#onVisibility);
        this.#unsubscribe();
        super.close();
    }

    protected open(): LinkSocket{
        const token = session.token;
        this.#token = token;
        const url = `${settings().apiUrl.replace(/^http/, 'ws')}${this.#path}`;
        return token === null ? new WebSocket(url) : new WebSocket(url, token);
    }

    // A close for an expired session ends that session, unless another one has started since.
    protected afterClose(code: number, reason: string): CloseVerdict{
        if(code !== SocketClose.SessionExpired) return super.afterClose(code, reason);

        const token = this.#token;
        if(token !== null && token !== session.token) return 'retry';
        this.#token = null;
        if(token !== null) session.end(token);
        return 'halt';
    }

    #onSession = () => {
        if(session.token !== this.#token) this.reconnect();
    };

    #onVisibility = () => {
        if(document.visibilityState === 'visible') this.recover();
    };

    #recover = () => {
        this.recover();
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
