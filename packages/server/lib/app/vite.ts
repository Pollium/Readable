import typia from '@typia/unplugin/vite';
import { autoValidateBody } from '../http/auto-validate-body';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ViteUserConfig, mergeConfig } from 'vitest/config';

export const readableConfig = (overrides: ViteUserConfig = {}, root = process.cwd()): ViteUserConfig => {
    const setup = join(root, 'tests/setup.ts');

    return mergeConfig<ViteUserConfig, ViteUserConfig>({
        plugins: [
            autoValidateBody(),
            typia({ tsconfig: join(root, 'tsconfig.json'), cache: true })
        ],
        resolve: {
            alias: {
                '@': join(root, 'src'),
                '@tests': join(root, 'tests')
            }
        },
        ssr: { noExternal: ['@pollium/readable'] },
        test: {
            include: ['src/**/*.test.ts'],
            setupFiles: existsSync(setup) ? [setup] : [],
            hookTimeout: 60_000,
            server: { deps: { inline: ['@pollium/readable'] } }
        }
    }, overrides);
};
