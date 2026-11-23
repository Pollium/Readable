import { createParamDecorator } from '../decorators/controllers/Params';
import { AuthError } from './errors';
import { FastifyRequest } from 'fastify';

const sessionExpiresAt = (req: FastifyRequest): number => {
    if(req.sessionExpiresAt === undefined) throw AuthError.Unauthorized();

    return req.sessionExpiresAt;
};

export const SessionExpiresAt = (): ParameterDecorator => createParamDecorator(sessionExpiresAt);
