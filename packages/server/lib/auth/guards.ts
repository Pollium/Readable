import BaseController from '../http/Controller';
import { verifiedSession, Principal, TokenPayload } from './sessions';
import { bearerToken, principalOf, signIn, socketToken } from './authentication';
import { MiddlewareFn, Middleware } from '../http/middleware';
import { AuthError } from '../app/errors';
import { principalId } from './params';
import { parseId } from '../http/params';
import { FastifyRequest } from 'fastify';

export type MembershipAssertion = (scopeId: string, userId: string) => Promise<unknown>;

export const bearerSession = async (req: FastifyRequest): Promise<TokenPayload | null> => {
    const token = bearerToken(req);

    return token === undefined ? null : verifiedSession(token);
};

export const bearerPrincipal = async (req: FastifyRequest): Promise<Principal | null> => {
    const token = bearerToken(req);

    return token === undefined ? null : principalOf(token, req);
};

export const AuthenticatedRoute: MiddlewareFn = async (req) => {
    const token = bearerToken(req);
    if(token === undefined) throw AuthError.Unauthorized();

    await signIn(req, token);
};

export const OptionalAuthenticatedRoute: MiddlewareFn = async (req) => {
    const token = bearerToken(req);
    if(token !== undefined) await signIn(req, token);
};

@Middleware(AuthenticatedRoute)
export abstract class AuthenticatedController extends BaseController{}

export const ParamGuardRoute = (param: string, assert: MembershipAssertion): MiddlewareFn => async (req, reply) => {
    await AuthenticatedRoute(req, reply);
    const scopeId = parseId((req.params as Record<string, string | undefined>)[param]);
    await assert(scopeId, principalId(req));
};

export const SocketAuthenticatedRoute: MiddlewareFn = async (req) => {
    const token = socketToken(req);
    if(token === undefined) throw AuthError.Unauthorized();

    await signIn(req, token);
};

export const SocketOptionalAuthenticatedRoute: MiddlewareFn = async (req) => {
    const token = socketToken(req);
    if(token !== undefined) await signIn(req, token);
};
