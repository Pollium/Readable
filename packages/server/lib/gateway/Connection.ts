import { invocations } from './bindings';
import { GatewayError, RuntimeError } from '../app/errors';
import { createParamDecorator } from '../http/params';
import { Principal } from '../auth/sessions';
import { Binary, encodeFrame, Frame, FrameId } from '@pollium/readable-contracts/gateway';
import { WebSocket } from '@fastify/websocket';
import { FastifyRequest } from 'fastify';
import { randomUUID } from 'node:crypto';

export interface RequestOptions{
    timeoutMs?: number;
    bytes?: Uint8Array;
}

export interface Connection<Data extends object = Record<string, unknown>>{
    readonly id: string;
    readonly principal: Principal | undefined;
    readonly data: Data;
    readonly socket: WebSocket;
    readonly req: FastifyRequest;
    send(type: string, data?: unknown, bytes?: Uint8Array): boolean;
    request<T = unknown>(type: string, data?: unknown, options?: RequestOptions): Promise<T>;
    close(code?: number, reason?: string): void;
}

export const Connection = (): ParameterDecorator => createParamDecorator((req) => invocations.get(req)?.connection);

interface Pending{
    resolve: (value: unknown) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout> | undefined;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const PEER_ERROR_STATUS = 502;

export class LiveConnection<Data extends object = Record<string, unknown>> implements Connection<Data>{
    readonly id = randomUUID();
    readonly data = {} as Data;
    #lastId = 0;
    readonly #pending = new Map<FrameId, Pending>();

    constructor(readonly socket: WebSocket, readonly req: FastifyRequest){}

    get principal(): Principal | undefined{
        return this.req.principal;
    }

    get isOpen(): boolean{
        return this.socket.readyState === this.socket.OPEN;
    }

    send(type: string, data?: unknown, bytes?: Uint8Array): boolean{
        return this.write(encodeFrame({ type, data }, bytes));
    }

    request<T = unknown>(type: string, data?: unknown, { timeoutMs = DEFAULT_TIMEOUT_MS, bytes }: RequestOptions = {}): Promise<T>{
        const id = ++this.#lastId;

        return new Promise<T>((resolve, reject) => {
            if(!this.write(encodeFrame({ type, id, data }, bytes))) return reject(GatewayError.Closed());

            const timer = timeoutMs > 0 ? setTimeout(() => this.#expire(id), timeoutMs) : undefined;
            this.#pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
        });
    }

    close(code?: number, reason?: string){
        this.socket.close(code, reason);
    }

    write(raw: string | Uint8Array): boolean{
        if(!this.isOpen) return false;

        this.socket.send(raw);
        return true;
    }

    settle(frame: Frame, id: FrameId, bytes: Uint8Array | undefined){
        const pending = this.#pending.get(id);
        if(pending === undefined) return;

        this.#forget(id, pending);
        if(typeof frame.error === 'string') pending.reject(new RuntimeError(frame.error, PEER_ERROR_STATUS));
        else pending.resolve(bytes === undefined ? frame.data : new Binary(frame.data, bytes));
    }

    terminated(){
        for(const [id, pending] of this.#pending){
            this.#forget(id, pending);
            pending.reject(GatewayError.Closed());
        }
    }

    #expire(id: FrameId){
        const pending = this.#pending.get(id);
        if(pending === undefined) return;

        this.#forget(id, pending);
        pending.reject(GatewayError.Timeout());
    }

    #forget(id: FrameId, pending: Pending){
        this.#pending.delete(id);
        if(pending.timer !== undefined) clearTimeout(pending.timer);
    }

}
