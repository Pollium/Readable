import { ClassMetadata } from '../app/metadata';
import { createRedis } from '../app/redis';
import { readableConfig } from '../app/config';
import { logger } from '../app/logger';
import { EventError } from '../app/errors';
import { Redis } from 'ioredis';
import { randomBytes } from 'node:crypto';

export interface EventBinding{
    event: string;
    handlerName: string | symbol;
}

declare global{
    interface EventMap{}
}

type Handler = (payload: unknown) => unknown;

const origin = randomBytes(8).toString('hex');

interface Envelope{
    origin: string;
    event: string;
    payload: unknown;
}

class EventBus{
    #handlers = new Map<string, Handler[]>();
    #inFlight = new Set<Promise<unknown>>();
    #publisher?: Redis;
    #subscriber?: Redis;
    #remote = process.env.VITEST === undefined;

    subscribe(event: string, handler: Handler){
        const handlers = this.#handlers.get(event) ?? [];
        handlers.push(handler);
        this.#handlers.set(event, handlers);
        if(this.#remote) this.#listen();
    }

    on<K extends keyof EventMap & string>(event: K, handler: (payload: EventMap[K]) => unknown){
        this.subscribe(event, (payload) => handler(payload as EventMap[K]));
    }

    emit<K extends keyof EventMap>(event: K, payload: EventMap[K]){
        this.#dispatch(event, payload);
        if(!this.#remote) return;
        void this.#publish(event, payload);
    }

    async settled(){
        while(this.#inFlight.size > 0){
            await Promise.all(this.#inFlight);
        }
    }

    async close(){
        await this.#publisher?.quit();
        await this.#subscriber?.quit();
        this.#publisher = undefined;
        this.#subscriber = undefined;
    }

    #dispatch(event: string, payload: unknown){
        for(const handler of this.#handlers.get(event) ?? []){
            const work = Promise.resolve()
                .then(() => handler(payload))
                .catch((error: unknown) => {
                    logger.error(`EventBus::HandlerFailed:${event}`, error);
                });

            this.#inFlight.add(work);
            work.finally(() => this.#inFlight.delete(work));
        }
    }

    async #publish(event: string, payload: unknown){
        try{
            this.#publisher ??= this.#connect();
            const envelope: Envelope = { origin, event, payload };
            await this.#publisher.publish(this.#channel, JSON.stringify(envelope));
        }catch(error){
            logger.error('EventBus::PublishFailed', error);
        }
    }

    #listen(){
        if(this.#subscriber) return;

        try{
            this.#subscriber = this.#connect();
        }catch{
            return;
        }

        void this.#subscriber.subscribe(this.#channel);
        this.#subscriber.on('message', (_channel: string, message: string) => {
            let envelope: Envelope;
            try{
                envelope = JSON.parse(message) as Envelope;
            }catch(error){
                logger.error('EventBus::InvalidEnvelope', error);
                return;
            }

            if(envelope.origin === origin) return;
            this.#dispatch(envelope.event, envelope.payload);
        });
    }

    get #channel(): string{
        return `${readableConfig().name}:events`;
    }

    #connect(): Redis{
        return createRedis();
    }
}

export const eventBus = new EventBus();

const groupByClass = new WeakMap<object, string>();
const eventsByClass = new ClassMetadata<EventBinding>();

export const DefineEventGroup = (group: string): ClassDecorator => {
    return (target) => {
        groupByClass.set(target, group);
    };
};

export const getEventGroup = (ctor: object): string | undefined => {
    return groupByClass.get(ctor);
};

export const Event = (event: string): MethodDecorator => {
    return (target, handlerName) => {
        eventsByClass.append(target.constructor, { event, handlerName });
    };
};

export const getEvents = (ctor: object): EventBinding[] => {
    return eventsByClass.get(ctor);
};

type EventHandler = (payload: unknown) => unknown;

export const registerEventGroup = (GroupClass: new () => object) => {
    const group = getEventGroup(GroupClass);
    if(!group) throw EventError.UndefinedGroup();

    const instance = new GroupClass() as Record<string | symbol, EventHandler>;

    for(const { event, handlerName } of getEvents(GroupClass)){
        eventBus.subscribe(`${group}.${event}`, instance[handlerName].bind(instance));
    }
};
