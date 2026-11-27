import ConnectionsRegistry from './ConnectionRegistry';
import { bindings, ChannelOptions, invocations } from './bindings';
import { LiveConnection } from './Connection';
import { GatewayError, RuntimeError } from '../app/errors';
import { getClassMiddleware, MiddlewareFn } from '../http/middleware';
import { getParamResolvers } from '../http/params';
import { abortScope } from '../app/abort';
import {
    Binary,
    decodeFrame,
    encodeFrame,
    Frame,
    FrameId,
    isFrameId,
    SocketClose
} from '@pollium/readable-contracts/gateway';
import { WebSocket } from '@fastify/websocket';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type BaseGateway from './Gateway';

interface Handler{
    gateway: BaseGateway;
    handlerName: string | symbol;
}

interface ServerOptions{
    maxPayload?: number;
    perMessageDeflate?: false | { threshold: number };
}

type WebSocketServer = FastifyInstance['websocketServer'];

const REAUTHORIZE_MS = 30_000;
const DEFLATE_THRESHOLD_BYTES = 1024;

const hosts = new WeakMap<object, Map<string, ChannelHost>>();
const upgrading = new WeakMap<object, ChannelHost>();
const patched = new WeakSet<WebSocketServer>();

// One ws server serves every route, so a channel's limit and compression are put on it for the
// length of its own handshake, which ws completes synchronously.
const patch = (wss: WebSocketServer) => {
    if(patched.has(wss)) return;
    patched.add(wss);

    const handleUpgrade = wss.handleUpgrade.bind(wss);
    wss.handleUpgrade = (request, socket, head, done) => {
        const overrides = upgrading.get(request)?.serverOptions();
        if(overrides === undefined) return handleUpgrade(request, socket, head, done);

        const previous = { maxPayload: wss.options.maxPayload, perMessageDeflate: wss.options.perMessageDeflate };
        Object.assign(wss.options, overrides);
        try{
            handleUpgrade(request, socket, head, done);
        }finally{
            Object.assign(wss.options, previous);
        }
    };
};

export const hostFor = (app: FastifyInstance, path: string, registry: ConnectionsRegistry): ChannelHost => {
    const paths = hosts.get(app.server) ?? new Map<string, ChannelHost>();
    hosts.set(app.server, paths);

    let host = paths.get(path);
    if(host === undefined){
        host = new ChannelHost(path, registry);
        paths.set(path, host);
        host.mount(app);
    }
    return host;
};

export class ChannelHost{
    readonly registry: ConnectionsRegistry;
    readonly #path: string;
    readonly #gateways: BaseGateway[] = [];
    readonly #handlers = new Map<string, Handler>();
    readonly #options: ChannelOptions = {};
    readonly #authorizations = new WeakMap<FastifyRequest, () => Promise<void>>();

    constructor(path: string, registry: ConnectionsRegistry){
        this.#path = path;
        this.registry = registry;
    }

    add(gateway: BaseGateway, options: ChannelOptions){
        this.#merge(options);
        for(const binding of bindings.get(gateway.constructor)){
            if(binding.event !== 'message' || binding.type === undefined) continue;
            if(this.#handlers.has(binding.type)) throw GatewayError.DuplicateMessageType(`${this.#path}:${binding.type}`);
            this.#handlers.set(binding.type, { gateway, handlerName: binding.handlerName });
        }
        this.#gateways.push(gateway);
    }

    mount(app: FastifyInstance){
        app.get(this.#path, {
            websocket: true,
            preValidation: (req: FastifyRequest, reply: FastifyReply) => this.#admit(req, reply)
        }, (socket, req) => this.#accept(socket, req));
    }

    serverOptions(): ServerOptions | undefined{
        const { maxPayload, compression } = this.#options;
        if(maxPayload === undefined && compression === undefined) return undefined;

        const options: ServerOptions = {};
        if(maxPayload !== undefined) options.maxPayload = maxPayload;
        if(compression !== undefined){
            options.perMessageDeflate = compression === false
                ? false
                : { threshold: compression === true ? DEFLATE_THRESHOLD_BYTES : compression.threshold ?? DEFLATE_THRESHOLD_BYTES };
        }
        return options;
    }

    async #admit(req: FastifyRequest, reply: FastifyReply){
        if(this.serverOptions() !== undefined){
            patch(req.server.websocketServer);
            upgrading.set(req.raw, this);
        }

        const guards = this.#guards();
        const authorize = async () => {
            for(const guard of guards) await guard(req, reply);
        };

        await authorize();
        this.#authorizations.set(req, authorize);
    }

    #accept(socket: WebSocket, req: FastifyRequest){

        const connection = new LiveConnection(socket, req);
        const disconnected = new AbortController();
        this.registry.add(socket, connection);
        const watches = this.#watch(connection);
        const ready = this.#lifecycle('connect', connection);

        socket.on('message', (raw: Buffer, isBinary: boolean) => {
            void abortScope.run(disconnected.signal, () => this.#receive(connection, raw, isBinary, ready));
        });

        socket.on('close', () => {
            watches.forEach((stop) => stop());
            disconnected.abort();
            connection.terminated();
            this.registry.remove(socket);
            void this.#lifecycle('disconnect', connection);
        });
    }

    #watch(connection: LiveConnection): Array<() => void>{
        const { socket, req } = connection;
        const stops: Array<() => void> = [];

        if(req.sessionExpiresAt !== undefined){
            const expiry = setTimeout(() => socket.close(SocketClose.SessionExpired, 'session expired'), req.sessionExpiresAt * 1000 - Date.now());
            stops.push(() => clearTimeout(expiry));
        }

        const reauthorizing = setInterval(() => {
            void this.#reauthorize(connection);
        }, REAUTHORIZE_MS);
        stops.push(() => clearInterval(reauthorizing));

        const { pingIntervalMs } = this.#options;
        if(pingIntervalMs !== undefined && pingIntervalMs > 0){
            let answered = true;
            socket.on('pong', () => {
                answered = true;
            });
            const pinging = setInterval(() => {
                if(!answered) return socket.terminate();
                answered = false;
                socket.ping();
            }, pingIntervalMs);
            stops.push(() => clearInterval(pinging));
        }

        return stops;
    }

    async #reauthorize(connection: LiveConnection){
        try{
            await this.#authorizations.get(connection.req)?.();
            await this.registry.reauthorize(connection.socket);
        }catch{
            connection.close(SocketClose.AccessRevoked, 'access revoked');
        }
    }

    #lifecycle(event: 'connect' | 'disconnect', connection: LiveConnection): Promise<unknown>{
        const runs: Promise<unknown>[] = [];
        for(const gateway of this.#gateways){
            for(const binding of bindings.get(gateway.constructor)){
                if(binding.event !== event) continue;
                runs.push(this.#invoke(gateway, binding.handlerName, connection).catch((error: unknown) => this.#fail(connection, error)));
            }
        }
        return Promise.all(runs);
    }

    async #receive(connection: LiveConnection, raw: Buffer, isBinary: boolean, ready: Promise<unknown>){
        const decoded = decodeFrame(isBinary ? raw : raw.toString());
        if(decoded === undefined) return this.#fail(connection, GatewayError.MalformedFrame());

        const { frame, bytes } = decoded;
        if(isFrameId(frame.re)) return connection.settle(frame, frame.re, bytes);
        if(typeof frame.type !== 'string') return this.#fail(connection, GatewayError.MalformedFrame());

        // Every connect handler has run before a message is handled, so what one of them puts in the
        // connection's data is there for every gateway on the channel.
        await ready;
        await this.#dispatch(connection, frame.type, frame, bytes);
    }

    async #dispatch(connection: LiveConnection, type: string, frame: Frame, bytes: Uint8Array | undefined){
        const id = isFrameId(frame.id) ? frame.id : undefined;
        const handler = this.#handlers.get(type);
        if(handler === undefined) return this.#fail(connection, GatewayError.UnknownMessageType(), frame, id);

        try{
            const result = await this.#invoke(handler.gateway, handler.handlerName, connection, frame, bytes);
            if(id === undefined && (result === undefined || result === null)) return;
            this.#answer(connection, type, id, result);
        }catch(error){
            if(abortScope.signal()?.aborted === true) return;
            this.#fail(connection, error, frame, id);
        }
    }

    #answer(connection: LiveConnection, type: string, id: FrameId | undefined, result: unknown){
        const header = id === undefined ? { type } : { type, re: id };
        if(result instanceof Binary){
            connection.write(encodeFrame({ ...header, data: result.data ?? null }, result.bytes));
            return;
        }
        connection.write(encodeFrame({ ...header, data: result ?? null }));
    }

    async #invoke(
        gateway: BaseGateway,
        handlerName: string | symbol,
        connection: LiveConnection,
        frame?: Frame,
        bytes?: Uint8Array
    ): Promise<unknown>{
        const ctx = Object.create(connection.req) as FastifyRequest;
        invocations.set(ctx, { connection, frame, bytes });

        const resolvers = getParamResolvers(gateway.constructor, handlerName);
        const args = await Promise.all(resolvers.map((resolve) => resolve(ctx)));
        const method = Reflect.get(gateway, handlerName) as (...args: unknown[]) => unknown;

        return method.apply(gateway, args);
    }

    #fail(connection: LiveConnection, error: unknown, frame?: Frame, id?: FrameId){
        const answer = error instanceof RuntimeError ? error : GatewayError.Internal();
        const sessionId = frame?.sessionId;

        connection.write(JSON.stringify({
            ...(id === undefined ? {} : { type: frame?.type, re: id }),
            error: answer.message,
            ...(typeof sessionId === 'string' ? { sessionId } : {})
        }));
    }

    #guards(): MiddlewareFn[]{
        const guards = new Set<MiddlewareFn>();
        for(const gateway of this.#gateways){
            for(const guard of getClassMiddleware(gateway.constructor)) guards.add(guard);
        }
        return [...guards];
    }

    #merge(options: ChannelOptions){
        for(const [key, value] of Object.entries(options) as Array<[keyof ChannelOptions, unknown]>){
            if(value === undefined) continue;
            const current = this.#options[key];
            if(current !== undefined && JSON.stringify(current) !== JSON.stringify(value)){
                throw GatewayError.ConflictingOptions(`${this.#path}:${key}`);
            }
            Object.assign(this.#options, { [key]: value });
        }
    }

}
