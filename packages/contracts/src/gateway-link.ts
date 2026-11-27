import { defineErrors, GatewayErrors, RuntimeError } from './errors';
import {
    Binary,
    decodeFrame,
    encodeFrame,
    Frame,
    FrameId,
    isFrameId,
    isRefusal,
    reconnectDelay,
    SocketClose
} from './gateway';

const GatewayError = defineErrors(GatewayErrors);

const SOCKET_CONNECTING = 0;
const SOCKET_OPEN = 1;
const PEER_ERROR_STATUS = 502;

export type LinkStatus = 'connecting' | 'open' | 'reconnecting' | 'closed';

// The part of a WHATWG WebSocket a link drives: the browser's, Node's global one, or a test's fake.
// The handlers take `any` because each runtime types its events its own way.
export interface LinkSocket{
    readonly readyState: number;
    readonly bufferedAmount?: number;
    binaryType: string;
    onopen: ((event: any) => void) | null;
    onmessage: ((event: any) => void) | null;
    onclose: ((event: any) => void) | null;
    send(data: string | Uint8Array<ArrayBuffer>): void;
    close(code?: number, reason?: string): void;
}

export type FrameHandler = (data: unknown, bytes?: Uint8Array) => void;
export type AnswerHandler = (data: unknown, bytes?: Uint8Array) => unknown;
export type ErrorHandler = (error: string, sessionId: string | undefined) => void;
export type CloseVerdict = 'retry' | 'halt';

export interface LinkSendOptions{
    bytes?: Uint8Array;
    queue?: boolean;
}

export interface LinkRequestOptions{
    bytes?: Uint8Array;
    timeoutMs?: number;
}

export interface LinkOptions{
    queue?: boolean;
    queueLimit?: number;
    requestTimeoutMs?: number;
}

interface Pending{
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout> | undefined;
    sent: boolean;
}

type Raw = string | Uint8Array<ArrayBuffer>;

interface Queued{
    raw: Raw;
    id?: FrameId;
}

interface Join{
    raw: string;
    leave: string | undefined;
    holders: number;
}

const subscribed = <T>(handlers: Set<T>, handler: T): (() => void) => {
    handlers.add(handler);
    return () => {
        handlers.delete(handler);
    };
};

const fieldsOf = (data: unknown): object => data as object;

const reserves = (data: unknown): boolean =>
    data !== null && typeof data === 'object' && (Object.hasOwn(data, 'id') || Object.hasOwn(data, 're'));

export abstract class GatewayLink{
    #socket: LinkSocket | null = null;
    #status: LinkStatus = 'connecting';
    #attempts = 0;
    #attemptsBeforeOpen = 0;
    #retry: ReturnType<typeof setTimeout> | null = null;
    #closed = false;
    #lastId = 0;
    readonly #options: Required<LinkOptions>;
    readonly #queue: Queued[] = [];
    readonly #pending = new Map<FrameId, Pending>();
    readonly #joins = new Map<string, Join>();
    readonly #frames = new Map<string, Set<FrameHandler>>();
    readonly #answers = new Map<string, AnswerHandler>();
    readonly #statuses = new Set<(status: LinkStatus) => void>();
    readonly #errors = new Set<ErrorHandler>();

    constructor(options: LinkOptions = {}){
        this.#options = {
            queue: options.queue ?? false,
            queueLimit: options.queueLimit ?? 256,
            requestTimeoutMs: options.requestTimeoutMs ?? 30_000
        };
    }

    protected abstract open(): LinkSocket;

    // A refusal for who the socket is, or what it may do, does not change by asking again.
    protected afterClose(code: number, reason: string): CloseVerdict{
        if(code === SocketClose.Unauthenticated) return 'halt';
        return code === SocketClose.Forbidden && isRefusal(reason) ? 'halt' : 'retry';
    }

    get status(): LinkStatus{
        return this.#status;
    }

    get bufferedAmount(): number{
        return this.#socket?.bufferedAmount ?? 0;
    }

    send(type: string, data?: unknown, { bytes, queue = this.#options.queue }: LinkSendOptions = {}): boolean{
        const raw = encodeFrame({ type, ...fieldsOf(data) }, bytes);
        if(this.#status === 'open') return this.#write(raw);
        return queue && this.#enqueue({ raw });
    }

    request<T = unknown>(type: string, data?: unknown, options: LinkRequestOptions = {}): Promise<T>{
        if(reserves(data)) return Promise.reject(GatewayError.MalformedFrame('id'));

        const id = ++this.#lastId;
        const raw = encodeFrame({ type, ...fieldsOf(data), id }, options.bytes);
        return new Promise<T>((resolve, reject) => {
            const pending: Pending = { resolve: resolve as (value: unknown) => void, reject, timer: undefined, sent: false };
            if(this.#status === 'open'){
                if(!this.#write(raw)) return reject(GatewayError.Closed());
                pending.sent = true;
            }else if(!this.#queueing()){
                return reject(GatewayError.Closed());
            }else if(!this.#enqueue({ raw, id })){
                return reject(GatewayError.QueueFull());
            }

            const timeoutMs = options.timeoutMs ?? this.#options.requestTimeoutMs;
            if(timeoutMs > 0) pending.timer = setTimeout(() => this.#expire(id), timeoutMs);
            this.#pending.set(id, pending);
        });
    }

    // Sent on every open before anything queued, until the returned function leaves; a join held twice
    // is sent once and left with its last holder. `leave` names the message sent with the same fields.
    join(type: string, data?: unknown, leave?: string): () => void{
        const key = JSON.stringify([type, data ?? null, leave ?? null]);
        const held = this.#joins.get(key);
        if(held !== undefined){
            held.holders += 1;
        }else{
            const raw = JSON.stringify({ type, ...fieldsOf(data) });
            this.#joins.set(key, {
                raw,
                leave: leave === undefined ? undefined : JSON.stringify({ type: leave, ...fieldsOf(data) }),
                holders: 1
            });
            if(this.#status === 'open') this.#write(raw);
        }

        let left = false;
        return () => {
            if(left) return;
            left = true;
            this.#leave(key);
        };
    }

    on(type: string, handler: FrameHandler): () => void{
        const handlers = this.#frames.get(type) ?? new Set<FrameHandler>();
        this.#frames.set(type, handlers);
        return subscribed(handlers, handler);
    }

    answer(type: string, handler: AnswerHandler): () => void{
        this.#answers.set(type, handler);
        return () => {
            if(this.#answers.get(type) === handler) this.#answers.delete(type);
        };
    }

    onStatus(handler: (status: LinkStatus) => void): () => void{
        handler(this.#status);
        return subscribed(this.#statuses, handler);
    }

    onError(handler: ErrorHandler): () => void{
        return subscribed(this.#errors, handler);
    }

    reconnect(){
        if(this.#closed) return;
        this.#drop();
        this.#attempts = 0;
        this.#connect();
    }

    recover(){
        if(this.#closed || this.#status === 'closed') return;
        const state = this.#socket?.readyState;
        if(state === SOCKET_OPEN || state === SOCKET_CONNECTING) return;
        this.#attempts = 0;
        this.#connect();
    }

    close(){
        this.#closed = true;
        this.#clearRetry();
        this.#setStatus('closed');
        this.#drop();
        this.#rejectAll(GatewayError.Closed());
    }

    protected connect(){
        this.#connect();
    }

    #connect(){
        if(this.#closed) return;
        this.#clearRetry();
        this.#setStatus(this.#attempts === 0 ? 'connecting' : 'reconnecting');

        const socket = this.open();
        socket.binaryType = 'arraybuffer';
        this.#socket = socket;
        socket.onopen = () => this.#onOpen(socket);
        socket.onmessage = (event: { data: unknown }) => this.#receive(event.data);
        socket.onclose = (event: { code: number; reason?: string }) => this.#onClose(socket, event.code, event.reason ?? '');
    }

    #onOpen(socket: LinkSocket){
        if(socket !== this.#socket) return;
        this.#attemptsBeforeOpen = this.#attempts;
        this.#attempts = 0;

        for(const join of this.#joins.values()) this.#write(join.raw);
        for(const queued of this.#queue.splice(0)){
            this.#write(queued.raw);
            const pending = queued.id === undefined ? undefined : this.#pending.get(queued.id);
            if(pending !== undefined) pending.sent = true;
        }
        this.#setStatus('open');
    }

    #onClose(socket: LinkSocket, code: number, reason: string){
        if(socket !== this.#socket) return;
        this.#socket = null;
        if(this.#closed) return;

        const refused = isRefusal(reason);
        if(this.afterClose(code, reason) === 'halt') return this.#halt(code, reason);
        this.#rejectSent(refused ? new RuntimeError(reason, code - 4000) : GatewayError.Closed());

        // A refused socket was open for an instant; the backoff goes on from where it was.
        if(refused) this.#attempts = this.#attemptsBeforeOpen;
        this.#setStatus('reconnecting');
        const delay = reconnectDelay(this.#attempts);
        this.#attempts += 1;
        this.#retry = setTimeout(() => this.#connect(), delay);
    }

    #halt(code: number, reason: string){
        this.#setStatus('closed');
        const refused = isRefusal(reason);
        this.#rejectAll(refused ? new RuntimeError(reason, code - 4000) : GatewayError.Closed());
        if(refused) this.#errors.forEach((handler) => handler(reason, undefined));
    }

    #receive(raw: unknown){
        if(typeof raw !== 'string' && !(raw instanceof ArrayBuffer) && !ArrayBuffer.isView(raw)) return;

        const decoded = decodeFrame(raw);
        if(decoded === undefined) return;

        const { frame, bytes } = decoded;
        if(isFrameId(frame.re)) return this.#settle(frame, frame.re, bytes);
        if(typeof frame.type === 'string' && isFrameId(frame.id)){
            void this.#answerRequest(frame.type, frame.id, frame.data, bytes);
            return;
        }

        const { type, data, error, sessionId } = frame;
        const session = typeof sessionId === 'string' ? sessionId : undefined;
        if(typeof error === 'string') return this.#errors.forEach((handler) => handler(error, session));
        if(typeof type !== 'string') return;
        // A text frame reaches its handlers as (data) alone, as it always has.
        this.#frames.get(type)?.forEach((handler) => bytes === undefined ? handler(data) : handler(data, bytes));
    }

    #settle(frame: Frame, id: FrameId, bytes: Uint8Array | undefined){
        const pending = this.#pending.get(id);
        if(pending === undefined) return;

        this.#forget(id, pending);
        if(typeof frame.error === 'string') pending.reject(new RuntimeError(frame.error, PEER_ERROR_STATUS));
        else pending.resolve(bytes === undefined ? frame.data : new Binary(frame.data, bytes));
    }

    async #answerRequest(type: string, id: FrameId, data: unknown, bytes: Uint8Array | undefined){
        const reply = (fields: object, replyBytes?: Uint8Array) => this.#write(encodeFrame({ type, re: id, ...fields }, replyBytes));

        const handler = this.#answers.get(type);
        if(handler === undefined) return reply({ error: GatewayError.UnknownMessageType().message });

        try{
            const result = await handler(data, bytes);
            if(result instanceof Binary) reply({ data: result.data ?? null }, result.bytes);
            else reply({ data: result ?? null });
        }catch(error){
            reply({ error: error instanceof Error ? error.message : GatewayError.Internal().message });
        }
    }

    #leave(key: string){
        const join = this.#joins.get(key);
        if(join === undefined) return;

        join.holders -= 1;
        if(join.holders > 0) return;
        this.#joins.delete(key);
        if(join.leave !== undefined && this.#status === 'open') this.#write(join.leave);
    }

    #write(raw: Raw): boolean{
        if(this.#socket?.readyState !== SOCKET_OPEN) return false;
        this.#socket.send(raw);
        return true;
    }

    #queueing(): boolean{
        return !this.#closed && (this.#status === 'connecting' || this.#status === 'reconnecting');
    }

    #enqueue(queued: Queued): boolean{
        if(!this.#queueing() || this.#queue.length >= this.#options.queueLimit) return false;
        this.#queue.push(queued);
        return true;
    }

    #expire(id: FrameId){
        const pending = this.#pending.get(id);
        if(pending === undefined) return;

        this.#forget(id, pending);
        const queued = this.#queue.findIndex((entry) => entry.id === id);
        if(queued !== -1) this.#queue.splice(queued, 1);
        pending.reject(GatewayError.Timeout());
    }

    #forget(id: FrameId, pending: Pending){
        this.#pending.delete(id);
        if(pending.timer !== undefined) clearTimeout(pending.timer);
    }

    #rejectSent(error: Error){
        for(const [id, pending] of this.#pending){
            if(!pending.sent) continue;
            this.#forget(id, pending);
            pending.reject(error);
        }
    }

    #rejectAll(error: Error){
        this.#queue.splice(0);
        for(const [id, pending] of this.#pending){
            this.#forget(id, pending);
            pending.reject(error);
        }
    }

    #drop(){
        const socket = this.#socket;
        this.#socket = null;
        if(socket === null) return;

        socket.onopen = null;
        socket.onmessage = null;
        socket.onclose = null;
        socket.close();
        this.#rejectSent(GatewayError.Closed());
    }

    #setStatus(status: LinkStatus){
        if(status === this.#status) return;
        this.#status = status;
        this.#statuses.forEach((handler) => handler(status));
    }

    #clearRetry(){
        if(this.#retry === null) return;
        clearTimeout(this.#retry);
        this.#retry = null;
    }
}
