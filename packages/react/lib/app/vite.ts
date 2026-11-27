import { autoValidateForm } from '../forms/auto-validate-form';
import typia from '@typia/unplugin/vite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { mergeConfig, ProxyOptions, UserConfig } from 'vite';

// Vitest reads `test`; Readable fills it without importing Vitest, so a web with no tests needs none.
export type ReadableUserConfig = UserConfig & {
    test?: Record<string, unknown>;
};

export interface WebConfigOptions{
    api?: string;
    apiPrefix?: string;
    proxy?: Record<string, ProxyOptions>;
    root?: string;
}

const escaped = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Without apiPrefix the web calls /api and the api's routes have no prefix, so the proxy takes /api off.
// With it, the api's routes carry the prefix themselves, so the proxy sends the path as it is.
const apiProxyOf = (api: string, apiPrefix: string | undefined): Record<string, ProxyOptions> => {
    const prefix = apiPrefix?.replace(/\/+$/, '');
    return {
        [`^${escaped(prefix ?? '/api')}/`]: {
            target: api,
            changeOrigin: true,
            ws: true,
            ...prefix === undefined ? { rewrite: (path: string) => path.replace(/^\/api/, '') } : {}
        }
    };
};

export const readableConfig = (
    overrides: ReadableUserConfig = {},
    { api = 'http://localhost:3000', apiPrefix, proxy = {}, root = process.cwd() }: WebConfigOptions = {}
): ReadableUserConfig => {
    const setup = join(root, 'tests/setup.ts');
    const tsconfig = ['tsconfig.app.json', 'tsconfig.json'].map((name) => join(root, name)).find(existsSync);
    const extra = Object.fromEntries(Object.entries(proxy).map(([path, options]) => [path, { target: api, changeOrigin: true, ...options }]));

    return mergeConfig<ReadableUserConfig, ReadableUserConfig>({
        plugins: [
            autoValidateForm(),
            typia({ tsconfig, cache: true })
        ],
        resolve: {
            alias: {
                '@': join(root, 'src')
            },
            dedupe: ['react', 'react-dom', 'react-router', 'react-router-dom']
        },
        server: {
            proxy: { ...apiProxyOf(api, apiPrefix), ...extra }
        },
        test: {
            environment: 'happy-dom',
            execArgv: ['--no-experimental-webstorage'],
            include: ['src/**/*.test.{ts,tsx}'],
            setupFiles: existsSync(setup) ? [setup] : []
        }
    }, overrides) as ReadableUserConfig;
};
