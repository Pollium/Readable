import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import websocket from '@fastify/websocket';
import BaseGateway, { websocketOptions } from '../gateway/Gateway';
import BaseQueue from '../queues/BaseQueue';
import { RuntimeError, ValidationError, RateLimitError, ServerError } from './errors';
import { ApiError } from '@pollium/readable-contracts/http';
import { LogLevel, logger } from './logger';
import { broadcast } from '../events/Broadcast';
import { closeTransport } from '../events/transports';
import { registerCompression } from './compression';
import { eventBus, registerEventGroup } from '../events/EventBus';
import { Discovered, MountedController } from './discovery';
import { redis } from './redis';
import Fastify, { LogController, FastifyInstance, FastifyBaseLogger } from 'fastify';
import { DataSource } from 'typeorm';

export interface BuildOptions{
    queues?: boolean;
}

export interface ApplicationLog{
    level: string;
    pretty: boolean;
}

export interface ApplicationOptions{
    port: number;
    corsOrigins: string[];
    publicPaths?: string[];
    log: ApplicationLog;
    discover: () => Promise<Discovered>;
    createDataSource?: (entities: Function[]) => DataSource;
    plugins?: (app: FastifyInstance) => Promise<void>;
    afterDatabase?: (dataSource: DataSource) => Promise<void>;
    afterMount?: (discovered: Discovered) => void;
}

export interface ListenTarget{
    start(): Promise<void>;
    stop(): Promise<void>;
}

export default class Application{
    #app!: FastifyInstance;
    #dataSource?: DataSource;
    #queues: BaseQueue<unknown>[] = [];
    #options: ApplicationOptions;

    constructor(options: ApplicationOptions){
        this.#options = options;
    }

    get dataSource(): DataSource | undefined{
        return this.#dataSource;
    }

    async build({ queues: startQueues = true }: BuildOptions = {}): Promise<FastifyInstance>{
        logger.configure({
            level: this.#options.log.level as LogLevel,
            pretty: this.#options.log.pretty
        });
        this.#app = Fastify({
            loggerInstance: logger.raw as FastifyBaseLogger,
            logController: new LogController({ disableRequestLogging: true }),
            trustProxy: ['loopback', 'linklocal', 'uniquelocal']
        });

        await this.#app.register(cors, {
            delegator: (req, resolve) => {
                const open = this.#options.publicPaths?.some((path) => req.url.startsWith(path)) ?? false;

                resolve(null, {
                    origin: open ? true : this.#options.corsOrigins,
                    credentials: !open,
                    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']
                });
            }
        });
        await this.#app.register(rateLimit, {
            global: false,
            redis,
            nameSpace: 'rl:',
            errorResponseBuilder: () => RateLimitError.TooManyRequests()
        });
        registerCompression(this.#app);
        if(this.#options.plugins) await this.#options.plugins(this.#app);

        const discovered = await this.#options.discover();

        await this.#openDatabase(discovered.entities);

        this.#registerErrorHandler();
        this.#registerRequestLogging();
        await this.#mountControllers(discovered.controllers);
        this.#app.get('/health', async () => ({ status: 'ok' }));
        await this.#openWebsocket(discovered.gateways);
        this.#mountGateways(discovered.gateways);
        discovered.events.forEach(registerEventGroup);
        this.#options.afterMount?.(discovered);
        if(startQueues) this.#startQueues(discovered.queues);

        return this.#app;
    }

    async start(){
        await this.build();
        await this.#app.listen({ port: this.#options.port, host: '0.0.0.0' });
    }

    async stop(){
        await this.#app.close();
        await Promise.all(this.#queues.map((queue) => queue.close()));
        await eventBus.close();
        await broadcast.close();
        await closeTransport();
        await this.#dataSource?.destroy();
    }

    async #openDatabase(entities: Function[]){
        if(!this.#options.createDataSource) return;

        this.#dataSource = this.#options.createDataSource(entities);
        await this.#dataSource.initialize();
        if(this.#options.afterDatabase) await this.#options.afterDatabase(this.#dataSource);
    }

    #registerErrorHandler(){
        this.#app.setErrorHandler((err, req, reply) => {
            const answer = err instanceof RuntimeError ? err : ServerError.Internal();

            if(answer.statusCode >= 500){
                logger.error(`${req.method} ${req.url}`, err, { scope: 'http', statusCode: answer.statusCode });
            }

            const payload: ApiError = { error: answer.message };
            if(err instanceof ValidationError) payload.errors = err.errors;

            reply.status(answer.statusCode).send(payload);
        });
    }

    #registerRequestLogging(){
        this.#app.addHook('onResponse', (req, reply, done) => {
            logger.debug(`${req.method} ${req.url}`, {
                scope: 'http',
                statusCode: reply.statusCode,
                ms: Math.round(reply.elapsedTime)
            });
            done();
        });
    }

    async #mountControllers(controllers: MountedController[]){
        for(const { prefix, Controller } of controllers){
            await new Controller().register(this.#app, prefix);
        }
    }

    async #openWebsocket(gateways: Array<new () => BaseGateway>){
        if(gateways.length === 0 || this.#app.hasDecorator('websocketServer')) return;

        await this.#app.register(websocket, websocketOptions);
    }

    #mountGateways(gateways: Array<new () => BaseGateway>){
        for(const Gateway of gateways){
            new Gateway().register(this.#app);
        }
    }

    #startQueues(queues: Array<new () => BaseQueue<unknown>>){
        for(const Queue of queues){
            const queue = new Queue();
            queue.startWorker();
            this.#queues.push(queue);
        }
    }
}

export const listen = (app: ListenTarget, failed = 'Failed to start server') => {
    app.start().catch((err) => {
        logger.error(failed, err);
        process.exit(1);
    });

    for(const signal of ['SIGTERM', 'SIGINT'] as const){
        process.on(signal, () => {
            app.stop().finally(() => process.exit(0));
        });
    }
};
