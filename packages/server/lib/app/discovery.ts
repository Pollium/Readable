import BaseGateway from '../gateway/Gateway';
import BaseQueue from '../queues/BaseQueue';
import BaseController, { getControllerPrefix } from '../http/Controller';
import { readdir } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';

export interface MountedController{
    prefix: string;
    Controller: new () => BaseController;
}

export interface Discovered{
    controllers: MountedController[];
    entities: Function[];
    events: Array<new () => object>;
    queues: Array<new () => BaseQueue<unknown>>;
    gateways: Array<new () => BaseGateway>;
    tools: Array<new () => object>;
}

export type ModuleLoader = (url: string) => Promise<{ default?: unknown }>;

// What import.meta.glob returns: a loader per file when lazy, the module itself when eager.
export type GlobbedModules = Record<string, unknown>;

const CATEGORIES = ['controllers', 'models', 'events', 'queues', 'gateways', 'tools'] as const;

type Category = typeof CATEGORIES[number];

interface GlobbedFile{
    folder: number;
    moduleName: string;
    category: Category;
    file: string;
    entry: unknown;
}

// Source and the output of a build both count; a declaration, a source map or a test never does.
export const isModuleFile = (file: string): boolean => {
    return /\.(?:ts|js)$/.test(file) && !file.endsWith('.d.ts') && !/\.test\./.test(file);
};

const emptyDiscovered = (): Discovered => ({
    controllers: [], entities: [], events: [], queues: [], gateways: [], tools: []
});

const collect = (discovered: Discovered, moduleName: string, category: Category, found: unknown[]) => {
    if(category === 'controllers'){
        discovered.controllers.push(...(found as Array<new () => BaseController>).map((Controller) => ({
            prefix: getControllerPrefix(Controller) ?? `/${moduleName}`,
            Controller
        })));
        return;
    }

    (category === 'models' ? discovered.entities : discovered[category] as unknown[]).push(...found);
};

export class ModuleDiscovery{
    constructor(private readonly modulesDir: string, private readonly load: ModuleLoader){}

    async discover(): Promise<Discovered>{
        const names = (await readdir(this.modulesDir, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();

        const discovered = emptyDiscovered();

        for(const name of names){
            for(const category of CATEGORIES){
                collect(discovered, name, category, await this.#loadDefaults(name, category));
            }
        }

        return discovered;
    }

    static merge(parts: Discovered[]): Discovered{
        const discovered = emptyDiscovered();

        for(const part of parts){
            discovered.controllers.push(...part.controllers);
            discovered.entities.push(...part.entities);
            discovered.events.push(...part.events);
            discovered.queues.push(...part.queues);
            discovered.gateways.push(...part.gateways);
            discovered.tools.push(...part.tools);
        }

        return discovered;
    }

    async #loadDefaults(moduleName: string, category: Category): Promise<unknown[]>{
        const dir = join(this.modulesDir, moduleName, category);

        let files: string[];
        try{
            files = await readdir(dir);
        }catch{
            return [];
        }

        const loaded: unknown[] = [];
        for(const file of files.sort()){
            if(!isModuleFile(file)) continue;
            const imported = await this.load(pathToFileURL(join(dir, file)).href);
            if(imported.default) loaded.push(imported.default);
        }
        return loaded;
    }
}

export const discoverIn = async (
    srcDir: string,
    folders: string[] = ['modules'],
    load: ModuleLoader = (url) => import(url)
): Promise<Discovered> => {
    return ModuleDiscovery.merge(await Promise.all(
        folders.map((folder) => new ModuleDiscovery(join(srcDir, folder), load).discover())
    ));
};

export const discoverFrom = (
    metaUrl: string,
    load: ModuleLoader,
    folders: string[] = ['modules']
): Promise<Discovered> => discoverIn(join(dirname(fileURLToPath(metaUrl)), '..'), folders, load);

// The folder a key's module sits in, matched on the end of its path, so the glob may be written from
// src/server.ts (`./modules/...`), from a folder below src (`../modules/...`) or from the project root
// (`/src/modules/...`). The longest folder that matches wins.
const folderIndex = (prefix: string, folders: string[]): number => {
    let found = -1;
    folders.forEach((folder, at) => {
        const matches = prefix === folder || prefix.endsWith(`/${folder}`);
        if(matches && (found < 0 || folder.length > folders[found].length)) found = at;
    });
    return found;
};

const globbedFile = (key: string, entry: unknown, folders: string[]): GlobbedFile | null => {
    const parts = key.split('/');
    if(parts.length < 4) return null;

    const [moduleName, category, file] = parts.slice(-3);
    const folder = folderIndex(parts.slice(0, -3).join('/'), folders);
    if(folder < 0 || !CATEGORIES.includes(category as Category) || !isModuleFile(file)) return null;

    return { folder, moduleName, category: category as Category, file, entry };
};

const compare = (a: string, b: string): number => (a < b ? -1 : Number(a > b));

const inDiscoveryOrder = (a: GlobbedFile, b: GlobbedFile): number => {
    return a.folder - b.folder
        || compare(a.moduleName, b.moduleName)
        || CATEGORIES.indexOf(a.category) - CATEGORIES.indexOf(b.category)
        || compare(a.file, b.file);
};

const defaultOf = async (entry: unknown): Promise<unknown> => {
    const loaded = typeof entry === 'function' ? await (entry as () => Promise<unknown>)() : entry;
    return (loaded as { default?: unknown } | null | undefined)?.default;
};

// The same folders and the same order as reading them from disk, from the record import.meta.glob made,
// so a bundled server, which has no source folders to read, finds its modules.
export const discoverModules = async (modules: GlobbedModules, folders: string[] = ['modules']): Promise<Discovered> => {
    const files = Object.entries(modules)
        .map(([key, entry]) => globbedFile(key, entry, folders))
        .filter((file) => file !== null)
        .sort(inDiscoveryOrder);

    const discovered = emptyDiscovered();
    for(const { moduleName, category, entry } of files){
        const exported = await defaultOf(entry);
        if(exported) collect(discovered, moduleName, category, [exported]);
    }
    return discovered;
};
