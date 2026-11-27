import { GatewayLink, LinkOptions, LinkSocket } from '@pollium/readable-contracts/gateway-link';

export type {
    AnswerHandler,
    ErrorHandler,
    FrameHandler,
    LinkRequestOptions as RequestOptions,
    LinkSendOptions as SendOptions,
    LinkStatus as ClientStatus
} from '@pollium/readable-contracts/gateway-link';

export interface GatewayClientOptions extends LinkOptions{
    token?: string;
    protocols?: string[];
    headers?: Record<string, string>;
}

// A gateway's client for Node (a daemon, a worker, another service) on Node's own WebSocket. It
// speaks what the browser's channel speaks, and queues what it sends until it is connected.
export class GatewayClient extends GatewayLink{
    readonly #url: string;
    readonly #protocols: string[];
    readonly #headers: Record<string, string> | undefined;

    constructor(url: string, { token, protocols = [], headers, ...options }: GatewayClientOptions = {}){
        super({ queue: true, ...options });
        this.#url = url;
        this.#protocols = token === undefined ? protocols : [token, ...protocols];
        this.#headers = headers;
        this.connect();
    }

    protected open(): LinkSocket{
        return new WebSocket(this.#url, { protocols: this.#protocols, headers: this.#headers });
    }
}
