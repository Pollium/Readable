import Application, { ApplicationOptions } from './Application';
import {
    configure,
    optionalEnv,
    redisFromEnv,
    serviceConfig,
    storageFromEnv
} from './config';
import { discoverIn } from './discovery';
import { DatabaseOptions, MigrationSource, createDataSource } from '../database/data-source';
import { SessionCutoffStore, useSessionCutoffs } from '../auth/sessions';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export interface ReadableOptions extends Pick<ApplicationOptions, 'publicPaths' | 'plugins' | 'afterDatabase' | 'afterMount'>{
    root?: string;
    name?: string;
    folders?: string[];
    timestamptz?: boolean;
    migrations?: MigrationSource;
    database?: DatabaseOptions;
    sessionCutoffs?: SessionCutoffStore;
}

const scopeOf = (root: string): string => {
    const { name } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { name: string };

    return name.startsWith('@') ? name.slice(1).split('/')[0] : name;
};

export const readable = ({
    root = process.cwd(),
    name,
    folders,
    timestamptz,
    migrations,
    database,
    sessionCutoffs,
    ...hooks
}: ReadableOptions = {}): Application => {
    const service = serviceConfig('');

    configure({
        name: name ?? scopeOf(root),
        jwtSecret: optionalEnv('JWT_SECRET') ?? null,
        redis: optionalEnv('REDIS_HOST') === undefined ? null : redisFromEnv(),
        storage: optionalEnv('STORAGE_ENDPOINT') === undefined ? null : storageFromEnv()
    });
    if(sessionCutoffs) useSessionCutoffs(sessionCutoffs);

    return new Application({
        port: service.port,
        corsOrigins: service.corsOrigins,
        log: service.log,
        discover: () => discoverIn(join(root, 'src'), folders),
        createDataSource: (entities) => createDataSource({ ...service.database, timestamptz }, entities, migrations, database),
        ...hooks
    });
};
