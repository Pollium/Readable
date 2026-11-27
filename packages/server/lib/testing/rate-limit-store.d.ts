declare module '@fastify/rate-limit/store/RedisStore.js'{
    import { FastifyRateLimitStore } from '@fastify/rate-limit';

    const RedisStore: {
        prototype: FastifyRateLimitStore;
    };

    export default RedisStore;
}

declare module '@fastify/rate-limit/store/LocalStore.js'{
    import { FastifyRateLimitStore } from '@fastify/rate-limit';

    const LocalStore: {
        prototype: FastifyRateLimitStore;
    };

    export default LocalStore;
}
