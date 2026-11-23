import jwt from 'jsonwebtoken';
import { jwtSecret } from '../app/config';
import { redis } from '../app/redis';
import { AuthError } from '../app/errors';

export interface Principal{
    userId: string;
}

export interface TokenPayload{
    sub: string;
    iat: number;
    exp: number;
}

declare module 'fastify'{
    interface FastifyRequest{
        principal?: Principal;
        sessionExpiresAt?: number;
    }
}

export interface SessionCutoffStore{
    cutoffOf(userId: string): Promise<number | null>;
    cut(userId: string): Promise<void>;
}

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;
const ALGORITHM = 'HS256';

export class JWTService{
    sign(userId: string): string{
        return jwt.sign({ sub: String(userId) }, jwtSecret(), { algorithm: ALGORITHM, expiresIn: SESSION_TTL_SECONDS });
    }

    signUntil(userId: string, expiresAt: number): string{
        return jwt.sign({ sub: String(userId), exp: expiresAt }, jwtSecret(), { algorithm: ALGORITHM });
    }

    verify(token: string): TokenPayload{
        return jwt.verify(token, jwtSecret(), { algorithms: [ALGORITHM] }) as TokenPayload;
    }
}

const PREFIX = 'session:cutoff:';

export class RedisSessionCutoffStore implements SessionCutoffStore{
    async cutoffOf(userId: string): Promise<number | null>{
        const value = await redis.get(`${PREFIX}${userId}`);

        return value === null ? null : Number(value);
    }

    async cut(userId: string){
        await redis.set(`${PREFIX}${userId}`, String(Math.floor(Date.now() / 1000)), 'EX', SESSION_TTL_SECONDS);
    }
}

export const sessionCutoffs: SessionCutoffStore = new RedisSessionCutoffStore();

const decoded = (token: string): TokenPayload => {
    try{
        return new JWTService().verify(token);
    }catch{
        throw AuthError.InvalidToken();
    }
};

export const verifiedSession = async (token: string): Promise<TokenPayload> => {
    const session = decoded(token);
    const cutoff = await sessionCutoffs.cutoffOf(session.sub);
    if(cutoff !== null && session.iat < cutoff) throw AuthError.InvalidToken();

    return session;
};
