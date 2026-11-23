import { HttpMethod } from '@pollium/readable-contracts/routing';
import { FastifyReply, FastifyRequest, RouteGenericInterface } from 'fastify';

export interface RouteDefinition{
    path: string;
    method: HttpMethod;
    handlerName: string | symbol;
    absolute: boolean;
}

export interface StatusBinding{
    handlerName: string | symbol;
    code: number;
}

export type Handler = (
    req: FastifyRequest<RouteGenericInterface>,
    reply: FastifyReply
) => unknown;