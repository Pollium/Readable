import jwt from 'jsonwebtoken';
import { jwtSecret } from '../app/config';
import { hasRedis, redis } from '../app/redis';
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
        token?: string;
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

// One process's cuts, for an app without Redis. A cut is kept as long as a session it revokes could
// still be valid, as in Redis.
export class MemorySessionCutoffStore implements SessionCutoffStore{
    #cuts = new Map<string, { at: number; until: number }>();

    async cutoffOf(userId: string): Promise<number | null>{
        const cut = this.#cuts.get(userId);
        if(cut === undefined) return null;
        if(cut.until > Date.now()) return cut.at;

        this.#cuts.delete(userId);
        return null;
    }

    async cut(userId: string, at = Math.floor(Date.now() / 1000)){
        this.#cuts.set(userId, { at, until: Date.now() + SESSION_TTL_SECONDS * 1000 });
    }
}

const redisCutoffs = new RedisSessionCutoffStore();
const memoryCutoffs = new MemorySessionCutoffStore();
let chosenCutoffs: SessionCutoffStore | undefined;

export const useSessionCutoffs = (store: SessionCutoffStore) => {
    chosenCutoffs = store;
};

const cutoffStore = (): SessionCutoffStore => chosenCutoffs ?? (hasRedis() ? redisCutoffs : memoryCutoffs);

// The store verifiedSession reads. It stays one object whichever store answers, so a test spies on it.
export const sessionCutoffs: SessionCutoffStore = {
    cutoffOf: (userId) => cutoffStore().cutoffOf(userId),
    cut: (userId, at) => cutoffStore().cut(userId, at)
};

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
