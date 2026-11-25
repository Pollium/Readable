import { readableConfig } from '../lib/app/vite';
import manifest from '../package.json' with { type: 'json' };
import base from '../tsconfig.app.json' with { type: 'json' };
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let root: string;
let bare: string;

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'readable-web-'));
    bare = await mkdtemp(join(tmpdir(), 'readable-web-bare-'));
    await mkdir(join(root, 'tests'));
    await writeFile(join(root, 'tests/setup.ts'), '');
    await writeFile(join(root, 'tsconfig.app.json'), '{}');
});

afterAll(async () => {
    await rm(root, { recursive: true, force: true });
    await rm(bare, { recursive: true, force: true });
});

const pluginNames = (config: ReturnType<typeof readableConfig>) =>
    (config.plugins ?? []).flat().map((plugin) => (plugin as { name: string }).name);

describe('readableConfig', () => {
    it('gives a web its form validation, typia and the alias into its src', () => {
        const config = readableConfig({}, { root });

        expect(pluginNames(config)).toEqual(['readable:auto-validate-form', 'unplugin-typia']);
        expect(config.resolve?.alias).toEqual({ '@': join(root, 'src') });
        expect(config.resolve?.dedupe).toContain('react');
    });

    it('sends /api to the api while developing, sockets included', () => {
        const proxy = readableConfig({}, { root, api: 'http://localhost:4100' }).server?.proxy?.['^/api/'];

        expect(proxy).toMatchObject({ target: 'http://localhost:4100', ws: true });
        expect((proxy as { rewrite: (path: string) => string }).rewrite('/api/notes/live')).toBe('/notes/live');
    });

    it('runs the tests under src in a browser, with the setup when there is one', () => {
        expect(readableConfig({}, { root }).test).toMatchObject({
            environment: 'happy-dom',
            include: ['src/**/*.test.{ts,tsx}'],
            setupFiles: [join(root, 'tests/setup.ts')]
        });
        expect(readableConfig({}, { root: bare }).test?.setupFiles).toEqual([]);
    });

    it('keeps the plugins a web adds after its own', () => {
        const config = readableConfig({ plugins: [{ name: 'react' }], test: { restoreMocks: true } }, { root });

        expect(pluginNames(config)).toEqual(['readable:auto-validate-form', 'unplugin-typia', 'react']);
        expect(config.test).toMatchObject({ restoreMocks: true, environment: 'happy-dom' });
    });
});

describe('the published package', () => {
    it('leaves react and its router to the web, so both load one copy', () => {
        for(const shared of ['react', 'react-dom', 'react-router-dom']){
            expect(manifest.dependencies).not.toHaveProperty(shared);
            expect(manifest.peerDependencies).toHaveProperty(shared);
        }
    });

    it('ships a tsconfig a web extends in one line, with paths into its own folder', () => {
        expect(manifest.files).toContain('tsconfig.app.json');
        expect(manifest.exports['./tsconfig.json']).toBe('./tsconfig.app.json');
        expect(manifest.publishConfig.exports['./tsconfig.json']).toBe('./tsconfig.app.json');
        expect(base.compilerOptions.paths['@/*']).toEqual(['${configDir}/src/*']);
    });

    it('ships the agent guide beside the code it describes', () => {
        expect(manifest.files).toContain('AGENTS.md');
    });
});
