import { readableConfig } from '../lib/app/vite';
import manifest from '../package.json' with { type: 'json' };
import base from '../tsconfig.app.json' with { type: 'json' };
import { readdirSync } from 'node:fs';
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

    it('keeps the prefix when the api\'s routes carry it', () => {
        const kept = readableConfig({}, { root, api: 'http://localhost:4100', apiPrefix: '/api' }).server?.proxy;

        expect(kept?.['^/api/']).toEqual({ target: 'http://localhost:4100', changeOrigin: true, ws: true });
        expect(Object.keys(readableConfig({}, { root, apiPrefix: '/v1.0/' }).server?.proxy ?? {})).toEqual(['^/v1\\.0/']);
    });

    it('sends the other paths it is given to the api as well', () => {
        const proxy = readableConfig({}, { root, api: 'http://localhost:4100', proxy: { '/socket.io': { ws: true } } }).server?.proxy;

        expect(proxy?.['/socket.io']).toEqual({ target: 'http://localhost:4100', changeOrigin: true, ws: true });
        expect(proxy).toHaveProperty(['^/api/']);
    });

    it('keeps the proxies a web adds itself', () => {
        const proxy = readableConfig({ server: { proxy: { '/storage': { target: 'http://localhost:9000' } } } }, { root }).server?.proxy;

        expect(Object.keys(proxy ?? {})).toEqual(['^/api/', '/storage']);
    });

    it('runs the tests under src in a browser, with the setup when there is one', () => {
        expect(readableConfig({}, { root }).test).toMatchObject({
            environment: 'happy-dom',
            execArgv: ['--no-experimental-webstorage'],
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

    it('works with Vite 7 and 8, and needs Vitest only for tests', () => {
        expect(manifest.peerDependencies.vite).toBe('^7.3 || ^8');
        expect(manifest.peerDependenciesMeta.vite.optional).toBe(true);
        expect(manifest.peerDependenciesMeta.vitest.optional).toBe(true);
    });

    it('lets a web import every module by its path, those with JSX too', () => {
        const tsx = readdirSync(join(process.cwd(), 'lib'), { recursive: true, encoding: 'utf8' })
            .filter((file) => file.endsWith('.tsx'))
            .map((file) => file.replace(/\.tsx$/, ''));

        for(const module of tsx) expect(manifest.exports).toHaveProperty([`./${module}`], `./lib/${module}.tsx`);
    });

    it('ships the agent guide beside the code it describes', () => {
        expect(manifest.files).toContain('AGENTS.md');
    });
});
