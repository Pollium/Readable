import { RateLimitOptions as RouteRateLimit } from '@fastify/rate-limit';

export type RateLimitWindow = `${number}${'s' | 'm' | 'h'}`;

export interface RateLimitOptions{
    max: number;
    window: RateLimitWindow;
}

export interface RateLimitBinding{
    handlerName: string | symbol;
    limit: RouteRateLimit;
}
