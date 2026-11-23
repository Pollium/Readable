import RedisStore from '@fastify/rate-limit/store/RedisStore.js';
import { FastifyRateLimitStore } from '@fastify/rate-limit';

export const rateLimitStore: FastifyRateLimitStore = RedisStore.prototype;
