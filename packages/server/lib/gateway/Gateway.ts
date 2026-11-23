import { ClassMetadata } from '../app/metadata';
import ConnectionsRegistry from './ConnectionRegistry';
import { createParamDecorator, getParamResolvers } from '../http/params';
import { RuntimeError, GatewayError } from '../app/errors';
import { getClassMiddleware } from '../http/middleware';
import { abortScope } from '../app/abort';
import { WebsocketPluginOptions, WebSocket } from '@fastify/websocket';
import { FastifyRequest, FastifyInstance, FastifyReply } from 'fastify';

interface Frame{
    type: string;
    [field: string]: unknown;
}

interface Binding{
    event: 'connect' | 'disconnect' | 'message';
    type?: string;
    handlerName: string | symbol;
}

const channels = new WeakMap<object, string>();
const bindings = new ClassMetadata<Binding>();
const invocations = new WeakMap<FastifyRequest, { socket: WebSocket; frame: Frame | undefined }>();

export const OnConnect = () => on('connect');
export const OnDisconnect = () => on('disconnect');
export const OnMessage = (type: string) => on('message', type);
export const Payload = (): ParameterDecorator => createParamDecorator((req) => invocations.get(req)?.frame);
export const Socket = (): ParameterDecorator => createParamDecorator((req) => invocations.get(req)?.socket);

export const websocketOptions: WebsocketPluginOptions = {
    options: { maxPayload: 1024 * 1024 }
};

export const Channel = (path: string): ClassDecorator => {
    return (target) => {
        channels.set(target, path);
    };
};

const on = (event: Binding['event'], type?: string): MethodDecorator => {
    return (target, handlerName) => {
        bindings.append(target.constructor, { event, type, handlerName });
    };
};

const parseFrame = (raw: string): Frame | undefined => {
    try{
        const frame = JSON.parse(raw) as Frame;
        return typeof frame?.type === 'string' ? frame : undefined;
    }catch{
        return undefined;
    }
};

export default abstract class BaseGateway{
    protected readonly connections = new ConnectionsRegistry();

    #authorizations = new WeakMap<FastifyRequest, () => Promise<void>>();

    register(app: FastifyInstance){
        const path = channels.get(this.constructor);
        if(!path) throw GatewayError.MissingChannel();

        const guards = getClassMiddleware(this.constructor);

        app.get(path, {
            websocket: true,
            preValidation: async (req: FastifyRequest, reply: FastifyReply) => {
                const authorize = async () => {
                    for(const guard of guards) await guard(req, reply);
                };
                await authorize();
                this.#authorizations.set(req, authorize);
            }
        }, (socket, req) => this.#onConnection(socket, req));
    }

    #onConnection(socket: WebSocket, req: FastifyRequest){
        const disconnected = new AbortController();
        this.connections.add(socket);
        const expiry = req.sessionExpiresAt === undefined
            ? undefined
            : setTimeout(() => socket.close(4401, 'session expired'), req.sessionExpiresAt * 1000 - Date.now());
        const reauthorizing = setInterval(() => {
            void this.#reauthorize(socket, req);
        }, 30_000);

        this.#runLifecycle('connect', socket, req);

        socket.on('message', (raw: Buffer) => {
            abortScope.run(disconnected.signal, () => this.#dispatch(socket, req, raw.toString()));
        });

        socket.on('close', () => {
            clearTimeout(expiry);
            clearInterval(reauthorizing);
            disconnected.abort();
            this.connections.remove(socket);
            this.#runLifecycle('disconnect', socket, req);
        });
    }

    async #reauthorize(socket: WebSocket, req: FastifyRequest){
        try{
            await this.#authorizations.get(req)?.();
            await this.connections.reauthorize(socket);
        }catch{
            socket.close(4403, 'access revoked');
        }
    }

    #runLifecycle(event: 'connect' | 'disconnect', socket: WebSocket, req: FastifyRequest){
        for(const binding of bindings.get(this.constructor)){
            if(binding.event !== event) continue;
            this.#invoke(binding.handlerName, socket, req, undefined).catch((error: unknown) => this.#fail(socket, error));
        }
    }

    async #dispatch(socket: WebSocket, req: FastifyRequest, raw: string){
        const frame = parseFrame(raw);
        if(!frame){
            this.#fail(socket, GatewayError.MalformedFrame());
            return;
        }

        const binding = bindings.get(this.constructor).find((candidate) => candidate.event === 'message' && candidate.type === frame.type);
        if(!binding){
            this.#fail(socket, GatewayError.UnknownMessageType(), frame);
            return;
        }

        try{
            const result = await this.#invoke(binding.handlerName, socket, req, frame);
            if(result === undefined || result === null) return;

            socket.send(JSON.stringify({
                type: frame.type,
                data: result
            }));
        }catch(error){
            if(abortScope.signal()?.aborted === true) return;
            this.#fail(socket, error, frame);
        }
    }

    async #invoke(handlerName: string | symbol, socket: WebSocket, req: FastifyRequest, frame: Frame | undefined): Promise<unknown>{
        const ctx = Object.create(req) as FastifyRequest;
        invocations.set(ctx, { socket, frame });

        const resolvers = getParamResolvers(this.constructor, handlerName);
        const args = await Promise.all(resolvers.map((resolve) => resolve(ctx)));
        const method = Reflect.get(this, handlerName) as (...args: unknown[]) => unknown;

        return method.apply(this, args);
    }

    #fail(socket: WebSocket, error: unknown, frame?: Frame){
        const answer = error instanceof RuntimeError ? error : GatewayError.Internal();
        const sessionId = frame?.sessionId;

        socket.send(JSON.stringify({
            error: answer.message,
            ...(typeof sessionId === 'string' ? { sessionId } : {})
        }));
    }
}
