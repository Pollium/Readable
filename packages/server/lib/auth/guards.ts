import BaseController from '../http/Controller';
import { verifiedSession, Principal, TokenPayload } from './sessions';
import { MiddlewareFn, Middleware } from '../http/middleware';
import { AuthError } from '../app/errors';
import { principalId } from './params';
import { parseId } from '../http/params';
import { FastifyRequest } from 'fastify';

export type MembershipAssertion = (scopeId: string, userId: string) => Promise<unknown>;

export const bearerSession = async (req: FastifyRequest): Promise<TokenPayload | null> => {
    const scheme = 'Bearer ';
    const header = req.headers.authorization;
    if(!header?.startsWith(scheme)) return null;

    return verifiedSession(header.slice(scheme.length).trim());
};

export const bearerPrincipal = async (req: FastifyRequest): Promise<Principal | null> => {
    const session = await bearerSession(req);

    return session === null ? null : { userId: session.sub };
};

export const AuthenticatedRoute: MiddlewareFn = async (req) => {
    const session = await bearerSession(req);
    if(session === null) throw AuthError.Unauthorized();

    req.principal = { userId: session.sub };
    req.sessionExpiresAt = session.exp;
};

@Middleware(AuthenticatedRoute)
export abstract class AuthenticatedController extends BaseController{}

export const ParamGuardRoute = (param: string, assert: MembershipAssertion): MiddlewareFn => async (req, reply) => {
    await AuthenticatedRoute(req, reply);
    const scopeId = parseId((req.params as Record<string, string | undefined>)[param]);
    await assert(scopeId, principalId(req));
};

export const SocketAuthenticatedRoute: MiddlewareFn = async (req) => {
    const token = tokenFromSubprotocol(req.headers['sec-websocket-protocol']) ?? tokenFromQuery(req.query);
    if(!token) throw AuthError.Unauthorized();

    const session = await verifiedSession(token);
    req.principal = { userId: session.sub };
    req.sessionExpiresAt = session.exp;
};

const tokenFromSubprotocol = (header: string | undefined): string | undefined => {
    const token = header?.split(',')[0]?.trim();
    return token || undefined;
};

const tokenFromQuery = (query: unknown): string | undefined => {
    const token = (query as { token?: string }).token?.trim();
    return token || undefined;
};
