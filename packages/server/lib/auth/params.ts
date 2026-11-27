import { AuthError } from '../app/errors';
import { createParamDecorator, parseId } from '../http/params';
import { FastifyRequest } from 'fastify';

export interface OwnedResolver<T>{
    getOwned(userId: string, id: string): Promise<T>;
}

export const principalId = (req: FastifyRequest): string => {
    if(!req.principal) throw AuthError.Unauthorized();
    return req.principal.userId;
};

export const CurrentUser = (): ParameterDecorator => createParamDecorator(principalId);

export const CurrentPrincipal = (): ParameterDecorator => createParamDecorator((req) => req.principal);

export const Token = (): ParameterDecorator => createParamDecorator((req) => req.token);

const sessionExpiresAt = (req: FastifyRequest): number => {
    if(req.sessionExpiresAt === undefined) throw AuthError.Unauthorized();

    return req.sessionExpiresAt;
};

export const SessionExpiresAt = (): ParameterDecorator => createParamDecorator(sessionExpiresAt);

export const Owned = <T>(Service: new () => OwnedResolver<T>, param = 'id'): ParameterDecorator =>
    createParamDecorator((req) => {
        const userId = principalId(req);
        const id = parseId((req.params as Record<string, string>)[param]);
        return new Service().getOwned(userId, id);
    });
