import { MiddlewareFn } from '../decorators/middleware/Middleware';
import { AuthError } from '../errors';
import { verifiedSession } from './verifiedSession';

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
