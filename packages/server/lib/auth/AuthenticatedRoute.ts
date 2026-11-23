import { MiddlewareFn } from '../http/middleware';
import { bearerSession } from './bearerPrincipal';
import { AuthError } from '../errors';

export const AuthenticatedRoute: MiddlewareFn = async (req) => {
    const session = await bearerSession(req);
    if(session === null) throw AuthError.Unauthorized();

    req.principal = { userId: session.sub };
    req.sessionExpiresAt = session.exp;
};
