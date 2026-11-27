import { readableConfig } from '../lib/app/vite';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let root: string;
let bare: string;

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'readable-vite-'));
    bare = await mkdtemp(join(tmpdir(), 'readable-vite-bare-'));
    await mkdir(join(root, 'tests'));
    await writeFile(join(root, 'tests/setup.ts'), '');
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(bare, { recursive: true, force: true });
});

const pluginNames = (config: ReturnType<typeof readableConfig>) =>
    (config.plugins ?? []).flat().map((plugin) => (plugin as { name: string }).name);

describe('readableConfig', () => {
    it('gives an app the body validation, typia, and aliases into its src and tests', () => {
        const config = readableConfig({}, root);

        expect(pluginNames(config)).toEqual(['readable:auto-validate-body', 'unplugin-typia']);
        expect(config.resolve?.alias).toEqual({ '@': join(root, 'src'), '@tests': join(root, 'tests') });
    });

    it('lets vite run readable, so readable loads the app modules without a loader', () => {
        const config = readableConfig({}, root);

        expect(config.ssr?.noExternal).toEqual(['@pollium/readable']);
        expect(config.test?.server?.deps?.inline).toEqual(['@pollium/readable']);
    });

    it('builds src/server.ts for Node into dist, reading an import of a type as Vitest does', () => {
        expect(readableConfig({}, root).build).toEqual({
            ssr: join(root, 'src/server.ts'),
            outDir: join(root, 'dist'),
            target: 'node22',
            rollupOptions: { shimMissingExports: true }
        });
    });

    it('runs the tests under src with the app setup, when the app has one', () => {
        expect(readableConfig({}, root).test).toMatchObject({
            include: ['src/**/*.test.ts'],
            setupFiles: [join(root, 'tests/setup.ts')],
            hookTimeout: 60_000
        });
        expect(readableConfig({}, bare).test?.setupFiles).toEqual([]);
    });

    it('keeps what an app adds on top', () => {
        const config = readableConfig({ test: { restoreMocks: true } }, root);

        expect(config.test).toMatchObject({ restoreMocks: true, include: ['src/**/*.test.ts'] });
    });
});
