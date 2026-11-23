import ClassMetadata from '../../utils/ClassMetadata';
import { Endpoint, HttpMethod } from '@pollium/readable-contracts/routing';
import { RouteDefinition } from '../../contracts/routing';

export const routesByController = new ClassMetadata<RouteDefinition>();

export const Route = <I, O>(
    route: string | Endpoint<I, O>,
    method: HttpMethod = 'GET'
): MethodDecorator => {
    return (target, handlerName) => {
        const definition = typeof route === 'string'
            ? { path: route, method, absolute: false }
            : { path: route.path, method: route.method, absolute: true };

        routesByController.append(target.constructor, { ...definition, handlerName });
    };
};
