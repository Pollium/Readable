import { ConfigError } from './errors';

export interface ReadableRedisConfig{
    host: string;
    port: number;
}

export interface ReadableStorageConfig{
    endpoint: string;
    region: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
    publicUrl: string;
}

export interface ReadableDatabaseConfig{
    url: string;
    schema: string | undefined;
    synchronize: boolean;
    timestamptz?: boolean;
}

export interface ReadableConfig{
    name: string;
    jwtSecret: string | null;
    redis: ReadableRedisConfig;
    storage: ReadableStorageConfig | null;
}

let current: ReadableConfig | undefined;

export const requiredEnv = (key: string): string => {
    const value = process.env[key];
    if(value === undefined || value === '') throw ConfigError.MissingEnv(key);
    return value;
};

export const optionalEnv = (key: string): string | undefined => {
    const value = process.env[key];
    return value === undefined || value === '' ? undefined : value;
};

export const configure = (next: ReadableConfig) => {
    current = next;
};

export const readableConfig = (): ReadableConfig => {
    if(!current) throw ConfigError.MissingEnv('readable');
    return current;
};

export const jwtSecret = (): string => {
    const secret = readableConfig().jwtSecret;
    if(secret === null) throw ConfigError.MissingEnv('JWT_SECRET');
    return secret;
};

export const storageConfig = (): ReadableStorageConfig => {
    const storage = readableConfig().storage;
    if(storage === null) throw ConfigError.MissingEnv('STORAGE');
    return storage;
};

export const serviceConfig = (corsFallback: string) => ({
    port: Number(requiredEnv('PORT')),
    host: optionalEnv('HOST') ?? '0.0.0.0',
    corsOrigins: (optionalEnv('CORS_ORIGIN') ?? corsFallback)
        .split(',')
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ''),
    database: {
        url: requiredEnv('DATABASE_URL'),
        schema: optionalEnv('DATABASE_SCHEMA'),
        synchronize: optionalEnv('DATABASE_SYNCHRONIZE') !== 'false'
    } satisfies ReadableDatabaseConfig,
    log: {
        level: optionalEnv('LOG_LEVEL') ?? 'info',
        pretty: optionalEnv('LOG_PRETTY') === 'true'
    }
});

export const redisFromEnv = (): ReadableRedisConfig => ({
    host: requiredEnv('REDIS_HOST'),
    port: Number(requiredEnv('REDIS_PORT'))
});

export const storageFromEnv = (): ReadableStorageConfig => ({
    endpoint: requiredEnv('STORAGE_ENDPOINT'),
    region: optionalEnv('STORAGE_REGION') ?? 'us-east-1',
    accessKey: requiredEnv('STORAGE_ACCESS_KEY'),
    secretKey: requiredEnv('STORAGE_SECRET_KEY'),
    bucket: requiredEnv('STORAGE_BUCKET'),
    publicUrl: requiredEnv('STORAGE_PUBLIC_URL')
});
