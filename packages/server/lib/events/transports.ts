import { optionalEnv, readableConfig } from '../app/config';
import { dialectOf } from '../database/dialect';
import { Transport } from './Transport';
import { MemoryTransport } from './MemoryTransport';
import { PostgresTransport } from './PostgresTransport';
import { RedisTransport } from './RedisTransport';

let chosen: Transport | undefined;
let fallback: Transport | undefined;

// Redis when the app has one, else the Postgres database it already opens, else one process.
const fromConfig = (): Transport => {
    if(readableConfig().redis) return new RedisTransport();

    const url = optionalEnv('DATABASE_URL');
    if(url !== undefined && dialectOf(url) === 'postgres'){
        return new PostgresTransport({ url, schema: optionalEnv('DATABASE_SCHEMA') });
    }

    return new MemoryTransport();
};

export const useTransport = (next: Transport) => {
    chosen = next;
};

export const transport = (): Transport => {
    if(chosen) return chosen;
    fallback ??= fromConfig();
    return fallback;
};

export const hasChosenTransport = (): boolean => chosen !== undefined;

// The transport an app chose stays chosen and reconnects when it is used again; the one made from the
// config is made again, from the config of that time.
export const closeTransport = async () => {
    const open = chosen ?? fallback;
    fallback = undefined;
    await open?.close();
};
