import { discoverFrom, discoverIn } from '../lib/app/discovery';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

class NoteController{}
class Note{}

let root: string;

beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'readable-discovery-'));
    await mkdir(join(root, 'core'));
    await mkdir(join(root, 'modules/notes/controllers'), { recursive: true });
    await mkdir(join(root, 'modules/notes/models'), { recursive: true });
    await writeFile(join(root, 'modules/notes/controllers/Note.ts'), '');
    await writeFile(join(root, 'modules/notes/models/Note.ts'), '');
    await writeFile(join(root, 'modules/notes/models/types.d.ts'), '');
});

afterAll(() => rm(root, { recursive: true, force: true }));

describe('discoverFrom', () => {
    it('loads every module file through the app, which knows how to read it', async () => {
        const loaded: string[] = [];
        const byFile: Record<string, unknown> = {
            'controllers/Note.ts': NoteController,
            'models/Note.ts': Note
        };

        const discovered = await discoverFrom(pathToFileURL(join(root, 'core/Application.ts')).href, async (url) => {
            const file = url.split('/modules/notes/')[1];
            loaded.push(file);
            return { default: byFile[file] };
        });

        expect(loaded).toEqual(['controllers/Note.ts', 'models/Note.ts']);
        expect(discovered.controllers).toEqual([{ prefix: '/notes', Controller: NoteController }]);
        expect(discovered.entities).toEqual([Note]);
    });

    it('loads built .js files as well, and never a declaration, a source map or a test', async () => {
        const built = join(root, 'built');
        await mkdir(join(built, 'modules/notes/controllers'), { recursive: true });
        for(const file of ['Note.js', 'Note.js.map', 'Note.d.ts', 'Draft.ts', 'Note.test.ts', 'Note.test.js']){
            await writeFile(join(built, 'modules/notes/controllers', file), '');
        }
        const loaded: string[] = [];

        await discoverIn(built, ['modules'], async (url) => {
            loaded.push(url.split('/controllers/')[1]);
            return { default: NoteController };
        });

        expect(loaded).toEqual(['Draft.ts', 'Note.js']);
    });
});
