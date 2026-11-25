import { autoValidateForm } from '../forms/auto-validate-form';
import typia from '@typia/unplugin/vite';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { mergeConfig, ViteUserConfig } from 'vitest/config';

export interface WebConfigOptions{
    api?: string;
    root?: string;
}

export const readableConfig = (
    overrides: ViteUserConfig = {},
    { api = 'http://localhost:3000', root = process.cwd() }: WebConfigOptions = {}
): ViteUserConfig => {
    const setup = join(root, 'tests/setup.ts');
    const tsconfig = ['tsconfig.app.json', 'tsconfig.json'].map((name) => join(root, name)).find(existsSync);

    return mergeConfig<ViteUserConfig, ViteUserConfig>({
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
            proxy: {
                '^/api/': {
                    target: api,
                    changeOrigin: true,
                    ws: true,
                    rewrite: (path: string) => path.replace(/^\/api/, '')
                }
            }
        },
        test: {
            environment: 'happy-dom',
            execArgv: ['--no-experimental-webstorage'],
            include: ['src/**/*.test.{ts,tsx}'],
            setupFiles: existsSync(setup) ? [setup] : []
        }
    }, overrides);
};
