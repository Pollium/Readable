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
    cut(userId: string, at?: number): Promise<void>;
}

export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export class JWTService{
    #algorithm = 'HS256' as const;

    sign(userId: string): string{
        return jwt.sign({ sub: String(userId) }, jwtSecret(), { algorithm: this.#algorithm, expiresIn: SESSION_TTL_SECONDS });
    }

    signUntil(userId: string, expiresAt: number): string{
        return jwt.sign({ sub: String(userId), exp: expiresAt }, jwtSecret(), { algorithm: this.#algorithm });
    }

    verify(token: string): TokenPayload{
        return jwt.verify(token, jwtSecret(), { algorithms: [this.#algorithm] }) as TokenPayload;
    }
}

export class RedisSessionCutoffStore implements SessionCutoffStore{
    #prefix = 'session:cutoff:';

    async cutoffOf(userId: string): Promise<number | null>{
        const value = await redis.get(`${this.#prefix}${userId}`);

        return value === null ? null : Number(value);
    }

    async cut(userId: string, at = Math.floor(Date.now() / 1000)){
        await redis.set(`${this.#prefix}${userId}`, String(at), 'EX', SESSION_TTL_SECONDS);
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
