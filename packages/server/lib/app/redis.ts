import { readableConfig } from './config';
import { ConfigError } from './errors';
import { Redis, RedisOptions } from 'ioredis';

let client: Redis | undefined;

export const hasRedis = (): boolean => readableConfig().redis !== null;

export const redisOptions = (): RedisOptions => {
    const redis = readableConfig().redis;
    if(redis === null) throw ConfigError.MissingEnv('REDIS_HOST');

    const { host, port } = redis;
    return { host, port };
};

export const createRedis = (options: RedisOptions = {}): Redis => new Redis({ ...redisOptions(), ...options });

const connect = (): Redis => {
    client ??= createRedis({ lazyConnect: true });
    return client;
};

export const redis = new Proxy({} as Redis, {
    get(_target, prop){
        const value = Reflect.get(connect(), prop);
        return typeof value === 'function' ? value.bind(connect()) : value;
    }
});
