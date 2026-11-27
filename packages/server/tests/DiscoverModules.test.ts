/// <reference types="vite/client" />
import 'reflect-metadata';
import Application from '../lib/app/Application';
import { readable } from '../lib/app/readable';
import { discoverIn, discoverModules } from '../lib/app/discovery';
import { DefineEventGroup } from '../lib/events/EventBus';
import { Controller } from '../lib/http/Controller';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it, vi } from 'vitest';

class NoteController{}
@Controller('/drafts')
class DraftController{}
class Note{}
class Draft{}
@DefineEventGroup('notes')
class NoteEvents{}
class SearchTool{}

// One module tree, the way a glob from src/server.ts names it, with what discovery must skip too.
const tree: Record<string, unknown> = {
    './modules/notes/models/Note.ts': Note,
    './modules/notes/controllers/Note.ts': NoteController,
    './modules/notes/events/NoteEvents.ts': NoteEvents,
    './modules/drafts/models/Draft.ts': Draft,
    './modules/drafts/controllers/Draft.ts': DraftController,
    './modules/notes/controllers/Note.test.ts': class{},
    './modules/notes/controllers/Note.d.ts': class{},
    './modules/notes/services/Notes.ts': class{},
    './modules/notes/controllers/helpers/Shared.ts': class{},
    './engines/search/tools/Search.ts': SearchTool
};

const lazily = (record: Record<string, unknown>) => Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, vi.fn(async () => ({ default: value }))])
);

const eagerly = (record: Record<string, unknown>) => Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, { default: value }])
);

let root: string | undefined;

afterAll(async () => {
    if(root) await rm(root, { recursive: true, force: true });
});

describe('discoverModules', () => {
    it('finds what discovery finds in the same folders, in the same order', async () => {
        const discovered = await discoverModules(lazily(tree));

        expect(discovered.controllers).toEqual([
            { prefix: '/drafts', Controller: DraftController },
            { prefix: '/notes', Controller: NoteController }
        ]);
        expect(discovered.entities).toEqual([Draft, Note]);
        expect(discovered.events).toEqual([NoteEvents]);
        expect(discovered.tools).toEqual([]);
    });

    it('never loads a file outside the six folders, a test or a declaration', async () => {
        const record = lazily(tree);

        await discoverModules(record);

        for(const skipped of ['Note.test.ts', 'Note.d.ts', 'services/Notes.ts', 'helpers/Shared.ts', 'engines/']){
            const [, loader] = Object.entries(record).find(([key]) => key.includes(skipped))!;
            expect(loader).not.toHaveBeenCalled();
        }
    });

    it('takes an eager glob as well as a lazy one', async () => {
        const discovered = await discoverModules(eagerly(tree));

        expect(discovered.entities).toEqual([Draft, Note]);
    });

    it('reads the folders it is given, in their order, and keys written from below src or from the root', async () => {
        const discovered = await discoverModules(lazily({
            '/src/modules/notes/models/Note.ts': Note,
            '../engines/search/tools/Search.ts': SearchTool,
            '../engines/search/models/Draft.ts': Draft
        }), ['engines', 'modules']);

        expect(discovered.entities).toEqual([Draft, Note]);
        expect(discovered.tools).toEqual([SearchTool]);
    });

    it('agrees with reading the folders from disk', async () => {
        root = await mkdtemp(join(tmpdir(), 'readable-glob-'));
        const byPath = new Map<string, unknown>();
        for(const [key, value] of Object.entries(tree)){
            const path = join(root, key);
            await mkdir(join(path, '..'), { recursive: true });
            await writeFile(path, '');
            byPath.set(path, value);
        }

        const fromDisk = await discoverIn(root, ['modules', 'engines'], async (url) => ({
            default: byPath.get(new URL(url).pathname)
        }));
        const fromGlob = await discoverModules(lazily(tree), ['modules', 'engines']);

        expect(fromGlob).toEqual(fromDisk);
    });
});

describe('readable({ modules })', () => {
    let application: Application | undefined;

    afterAll(() => application?.stop());

    it('mounts the modules a glob found instead of reading src', async () => {
        vi.stubEnv('PORT', '0');
        vi.stubEnv('DATABASE_URL', 'sqlite::memory:');
        vi.stubEnv('LOG_LEVEL', 'silent');
        const modules = import.meta.glob('./fixtures/notes/src/modules/*/*/*.ts');
        application = readable({ root: join(import.meta.dirname, 'fixtures/no-src'), name: 'notes', modules });

        const app = await application.build({ queues: false });
        const res = await app.inject({ method: 'GET', url: '/notes/latest' });
        vi.unstubAllEnvs();

        expect(res.json()).toEqual({ data: 'first' });
        expect(application.dataSource?.entityMetadatas.map((entity) => entity.name)).toEqual(['Note']);
    });
});
