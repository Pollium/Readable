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
        // `vite build` makes dist/server.js from src/server.ts, for Node. Dependencies stay imports Node
        // resolves from node_modules; readable is bundled, since a workspace links it as TypeScript.
        build: {
            ssr: join(root, 'src/server.ts'),
            outDir: join(root, 'dist'),
            target: 'node22',
            // Decorator metadata names a parameter's type, and a transform that sees one file at a time
            // keeps the import of an interface for it. Vitest reads that import as undefined; the
            // bundler would refuse it, so it reads it the same way.
            rollupOptions: { shimMissingExports: true }
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
