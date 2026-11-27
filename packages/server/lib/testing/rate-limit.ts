import RedisStore from '@fastify/rate-limit/store/RedisStore.js';
import LocalStore from '@fastify/rate-limit/store/LocalStore.js';
import { FastifyRateLimitStore } from '@fastify/rate-limit';

export const rateLimitStore: FastifyRateLimitStore = RedisStore.prototype;

// The store an app without Redis counts in.
export const memoryRateLimitStore: FastifyRateLimitStore = LocalStore.prototype;
