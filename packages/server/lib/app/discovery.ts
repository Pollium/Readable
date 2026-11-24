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

export class ModuleDiscovery{
    constructor(private readonly modulesDir: string, private readonly load: ModuleLoader){}

    async discover(): Promise<Discovered>{
        const names = (await readdir(this.modulesDir, { withFileTypes: true }))
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name)
            .sort();

        const discovered: Discovered = {
            controllers: [], entities: [], events: [], queues: [], gateways: [], tools: []
        };

        for(const name of names){
            const controllers = await this.#loadDefaults<new () => BaseController>(name, 'controllers');
            discovered.controllers.push(...controllers.map((Controller) => ({
                prefix: getControllerPrefix(Controller) ?? `/${name}`,
                Controller
            })));
            discovered.entities.push(...await this.#loadDefaults<Function>(name, 'models'));
            discovered.events.push(...await this.#loadDefaults<new () => object>(name, 'events'));
            discovered.queues.push(...await this.#loadDefaults<new () => BaseQueue<unknown>>(name, 'queues'));
            discovered.gateways.push(...await this.#loadDefaults<new () => BaseGateway>(name, 'gateways'));
            discovered.tools.push(...await this.#loadDefaults<new () => object>(name, 'tools'));
        }

        return discovered;
    }

    static merge(parts: Discovered[]): Discovered{
        const discovered: Discovered = {
            controllers: [], entities: [], events: [], queues: [], gateways: [], tools: []
        };

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

    async #loadDefaults<T>(moduleName: string, category: string): Promise<T[]>{
        const dir = join(this.modulesDir, moduleName, category);

        let files: string[];
        try{
            files = await readdir(dir);
        }catch{
            return [];
        }

        const loaded: T[] = [];
        for(const file of files.sort()){
            if(!file.endsWith('.ts') || file.endsWith('.d.ts')) continue;
            const imported = await this.load(pathToFileURL(join(dir, file)).href);
            if(imported.default) loaded.push(imported.default as T);
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
