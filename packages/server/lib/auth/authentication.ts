import { JWTService, Principal, verifiedSession } from './sessions';
import { AuthError } from '../app/errors';
import { FastifyRequest } from 'fastify';

export type Authenticate = (token: string, req: FastifyRequest) => Promise<Principal | null>;
export type SignTestToken = (as: string) => string | Promise<string>;

export interface AuthenticationOptions{
    authenticate?: Authenticate;
    signTestToken?: SignTestToken;
}

export const jwtAuthenticate: Authenticate = async (token, req) => {
    const session = await verifiedSession(token);
    req.sessionExpiresAt = session.exp;

    return { userId: session.sub };
};

export const jwtTestToken: SignTestToken = (userId) => new JWTService().sign(userId);

let authenticate = jwtAuthenticate;
let signTestToken = jwtTestToken;

export const configureAuthentication = (options: AuthenticationOptions = {}) => {
    authenticate = options.authenticate ?? jwtAuthenticate;
    signTestToken = options.signTestToken ?? jwtTestToken;
};

export const testTokenFor = (as: string): Promise<string> => Promise.resolve(signTestToken(as));

export const principalOf = async (token: string, req: FastifyRequest): Promise<Principal> => {
    const principal = token === '' ? null : await authenticate(token, req);
    if(principal === null) throw AuthError.InvalidToken();

    return principal;
};

export const signIn = async (req: FastifyRequest, token: string): Promise<Principal> => {
    const principal = await principalOf(token, req);
    req.principal = principal;
    req.token = token;

    return principal;
};

export const bearerToken = (req: FastifyRequest): string | undefined => {
    const scheme = 'Bearer ';
    const header = req.headers.authorization;

    return header?.startsWith(scheme) ? header.slice(scheme.length).trim() : undefined;
};

const firstSubprotocol = (header: string | undefined): string | undefined => {
    const token = header?.split(',')[0]?.trim();
    return token || undefined;
};

const queryToken = (query: unknown): string | undefined => {
    const token = (query as { token?: unknown } | undefined)?.token;
    return typeof token === 'string' && token.trim() !== '' ? token.trim() : undefined;
};

export const socketToken = (req: FastifyRequest): string | undefined =>
    firstSubprotocol(req.headers['sec-websocket-protocol']) ?? queryToken(req.query);
