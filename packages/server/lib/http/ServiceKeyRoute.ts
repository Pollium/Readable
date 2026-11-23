import { AuthError } from '../auth/errors';
import { MiddlewareFn } from '../decorators/middleware/Middleware';
import { timingSafeEqual } from 'node:crypto';

export const ServiceKeyRoute = (header: string, expected: string): MiddlewareFn => (req) => {
    const presented = req.headers[header];
    if(typeof presented !== 'string' || presented === '') throw AuthError.Unauthorized();

    const left = Buffer.from(presented);
    const right = Buffer.from(expected);
    if(left.length !== right.length || !timingSafeEqual(left, right)){
        throw AuthError.Unauthorized();
    }
};
