import { ClassMetadata } from '../app/metadata';
import { HttpMethod, Endpoint } from '@pollium/readable-contracts/routing';
import { Paginated, RawResponse, RedirectResponse } from './responses';
import { getParamResolvers } from './params';
import { getMiddleware, getRateLimit } from './middleware';
import { RouteError } from '../app/errors';
import { FastifyReply, FastifyRequest, RouteGenericInterface, FastifyInstance } from 'fastify';

export interface RouteDefinition{
    path: string;
    method: HttpMethod;
    handlerName: string | symbol;
    absolute: boolean;
    bodyLimit?: number;
}

export interface RouteOptions{
    method?: HttpMethod;
    bodyLimit?: number;
}

export interface StatusBinding{
    handlerName: string | symbol;
    code: number;
}

export type Handler = (
    req: FastifyRequest<RouteGenericInterface>,
    reply: FastifyReply
) => unknown;

const prefixByController = new WeakMap<object, string>();
const statusByHandler = new ClassMetadata<StatusBinding>();
export const routesByController = new ClassMetadata<RouteDefinition>();

export const Controller = (prefix: string): ClassDecorator => {
    return (target) => {
        prefixByController.set(target, prefix);
    };
};

export const getControllerPrefix = (ctor: object): string | undefined => {
    return prefixByController.get(ctor);
};

export const Route = <I, O>(
    route: string | Endpoint<I, O>,
    options: HttpMethod | RouteOptions = 'GET'
): MethodDecorator => {
    return (target, handlerName) => {
        const { method = 'GET', bodyLimit } = typeof options === 'string' ? { method: options } : options;
        const definition = typeof route === 'string'
            ? { path: route, method, absolute: false }
            : { path: route.path, method: route.method, absolute: true };

        routesByController.append(target.constructor, { ...definition, bodyLimit, handlerName });
    };
};

export const Status = (code: number): MethodDecorator => {
    return (target, handlerName) => {
        statusByHandler.append(target.constructor, { handlerName, code });
    };
};

export const getStatus = (
    ctor: object, 
    handlerName: string | symbol
): number | undefined => {
    return statusByHandler
        .get(ctor)
        .find((binding) => binding.handlerName === handlerName)?.code;
};

export default abstract class BaseController{
    async register(app: FastifyInstance, prefix: string){
        const mount = async (scope: FastifyInstance) => {
            for(const route of routesByController.get(this.constructor)){
                const handler = this.#wrap(route.handlerName);
                const middlewares = getMiddleware(this.constructor, route.handlerName);
                const url = route.absolute ? this.#relativeTo(route.path, prefix) : route.path;

                scope.route({
                    method: route.method,
                    url,
                    bodyLimit: route.bodyLimit,
                    config: { rateLimit: getRateLimit(this.constructor, route.handlerName) },
                    preHandler: middlewares.map((mw) => async (req, reply) => await mw(req, reply)),
                    handler
                });
            }
        };

        if(prefix === ''){
            await mount(app);
            return;
        }

        await app.register(mount, { prefix });
    }

    #relativeTo(path: string, prefix: string){
        if(path !== prefix && !path.startsWith(`${prefix}/`)){
            throw RouteError.PrefixMismatch(path);
        }
        return path.slice(prefix.length) || '/';
    }

    #wrap(handlerName: string | symbol): Handler{
        const method = (Reflect.get(this, handlerName) as (...args: unknown[]) => unknown).bind(this);
        const override = getStatus(this.constructor, handlerName);
        const resolvers = getParamResolvers(this.constructor, handlerName);

        return async (req, reply) => {
            const boxes = await Promise.all(Array.from(resolvers, async (resolve) => {
                const arg = resolve === undefined ? undefined : resolve(req, reply);
                return { arg: arg instanceof Promise ? await arg : arg };
            }));
            const result = await method(...boxes.map((box) => box.arg));

            if(reply.sent) return;

            if(result instanceof RawResponse){
                return reply
                    .status(override ?? result.status)
                    .type(result.contentType)
                    .send(result.body);
            }

            if(result instanceof RedirectResponse){
                return reply.redirect(result.url, result.status);
            }

            if(result instanceof Paginated){
                return reply
                    .status(override ?? 200)
                    .send({
                        data: result.items,
                        meta: result.meta
                    });
            }

            if(result === undefined || result === null){
                return reply.status(override ?? 204).send();
            }

            return reply.status(override ?? 200).send({ data: result });
        };
    }
}
