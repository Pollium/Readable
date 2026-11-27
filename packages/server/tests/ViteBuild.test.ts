import { readableConfig } from '../lib/app/vite';
import { build } from 'vite';
import { ChildProcess, execFile, spawn } from 'node:child_process';
import { mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:net';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const server = join(import.meta.dirname, '..');
const fixture = join(import.meta.dirname, 'fixtures/built');
const dist = join(fixture, 'dist');

let child: ChildProcess | undefined;
let base: string;

const freePort = () => new Promise<number>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
        const { port } = probe.address() as { port: number };
        probe.close(() => resolve(port));
    });
});

// The app depends on readable as it would from npm: the package as it is published, built into the
// app's own node_modules, so only ssr.noExternal puts it in the bundle.
const install = async () => {
    const installed = join(fixture, 'node_modules/@pollium/readable');
    const { publishConfig, ...manifest } = JSON.parse(await readFile(join(server, 'package.json'), 'utf8'));
    await rm(join(fixture, 'node_modules'), { recursive: true, force: true });
    await mkdir(installed, { recursive: true });
    await promisify(execFile)(join(server, '../../node_modules/.bin/tsdown'), ['--no-dts', '--log-level', 'silent', '--out-dir', join(installed, 'dist')], { cwd: server });
    await writeFile(join(installed, 'package.json'), JSON.stringify({ ...manifest, exports: publishConfig.exports }));
};

const bundled = async (): Promise<string> => {
    const files = await readdir(dist, { recursive: true });
    const sources = await Promise.all(files.filter((file) => file.endsWith('.js')).map((file) => readFile(join(dist, file), 'utf8')));
    return sources.join('\n');
};

const started = async (url: string) => {
    for(let attempt = 0; attempt < 100; attempt++){
        if(child?.exitCode !== null) throw new Error(`the built server exited with ${child?.exitCode}`);
        const ok = await fetch(url).then((res) => res.ok, () => false);
        if(ok) return;
        await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error('the built server never answered');
};

beforeAll(async () => {
    await install();
    await build({ ...readableConfig({ root: fixture, logLevel: 'silent' }, fixture), configFile: false });

    const port = await freePort();
    base = `http://127.0.0.1:${port}`;
    child = spawn(process.execPath, [join(dist, 'server.js')], {
        cwd: fixture,
        env: { PATH: process.env.PATH, PORT: String(port), DATABASE_URL: 'sqlite::memory:', LOG_LEVEL: 'error' },
        stdio: ['ignore', 'inherit', 'inherit']
    });
    await started(`${base}/health`);
}, 120_000);

afterAll(async () => {
    child?.kill();
    await rm(join(fixture, 'node_modules'), { recursive: true, force: true });
    await rm(dist, { recursive: true, force: true });
});

describe('vite build with readableConfig', () => {
    it('bundles src/server.ts into dist/server.js with readable inside and the dependencies left to Node', async () => {
        const output = await bundled();

        expect(output).not.toMatch(/from\s*["']@pollium\/readable/);
        expect(output).toMatch(/from\s*["']fastify["']/);
        expect(output).toMatch(/from\s*["']typeorm["']/);
    });

    it('runs on Node with the modules the glob found, the body validated and the models on SQLite', async () => {
        const created = await fetch(`${base}/notes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'built', tags: ['vite'], extra: true })
        });
        const refused = await fetch(`${base}/notes`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 1, tags: [] })
        });
        const listed = await fetch(`${base}/notes`);

        expect(created.status).toBe(201);
        expect(await created.json()).toMatchObject({ data: { title: 'built', tags: ['vite'] } });
        expect(refused.status).toBe(400);
        expect(await refused.json()).toMatchObject({ error: 'Request::ValidationFailed' });
        expect((await listed.json() as { data: unknown[] }).data).toEqual([
            expect.not.objectContaining({ extra: true })
        ]);
    });
});
