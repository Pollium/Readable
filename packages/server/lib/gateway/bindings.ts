import { ClassMetadata } from '../app/metadata';
import { createParamDecorator } from '../http/params';
import { Frame } from '@pollium/readable-contracts/gateway';
import { FastifyRequest } from 'fastify';
import type { LiveConnection } from './Connection';

export interface ChannelOptions{
    maxPayload?: number;
    pingIntervalMs?: number;
    compression?: boolean | { threshold?: number };
    refusal?: 'http' | 'close';
}

export interface ChannelDeclaration{
    path: string;
    options: ChannelOptions;
}

export interface Binding{
    event: 'connect' | 'disconnect' | 'message';
    type?: string;
    handlerName: string | symbol;
}

export interface Invocation{
    connection: LiveConnection;
    frame: Frame | undefined;
    bytes: Uint8Array | undefined;
}

const channels = new WeakMap<object, ChannelDeclaration>();
export const bindings = new ClassMetadata<Binding>();
export const invocations = new WeakMap<FastifyRequest, Invocation>();

export const channelOf = (ctor: object): ChannelDeclaration | undefined => channels.get(ctor);

export const Channel = (path: string, options: ChannelOptions = {}): ClassDecorator => {
    return (target) => {
        channels.set(target, { path, options });
    };
};

const on = (event: Binding['event'], type?: string): MethodDecorator => {
    return (target, handlerName) => {
        bindings.append(target.constructor, { event, type, handlerName });
    };
};

export const OnConnect = () => on('connect');
export const OnDisconnect = () => on('disconnect');
export const OnMessage = (type: string) => on('message', type);
export const Payload = (): ParameterDecorator => createParamDecorator((req) => invocations.get(req)?.frame);
export const Socket = (): ParameterDecorator => createParamDecorator((req) => invocations.get(req)?.connection.socket);
export const Bytes = (): ParameterDecorator => createParamDecorator((req) => invocations.get(req)?.bytes);
