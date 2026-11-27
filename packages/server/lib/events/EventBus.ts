import { ClassMetadata } from '../app/metadata';
import { readableConfig } from '../app/config';
import { logger } from '../app/logger';
import { EventError } from '../app/errors';
import { Transport } from './Transport';
import { hasChosenTransport, transport } from './transports';
import { randomBytes } from 'node:crypto';

export interface EventBinding{
    event: string;
    handlerName: string | symbol;
}

declare global{
    interface EventMap{}
}

interface Envelope{
    origin: string;
    event: string;
    payload: unknown;
}

type Handler = (payload: unknown) => unknown;
const origin = randomBytes(8).toString('hex');
const groupByClass = new WeakMap<object, string>();
const eventsByClass = new ClassMetadata<EventBinding>();

class EventBus{
    #handlers = new Map<string, Handler[]>();
    #inFlight = new Set<Promise<unknown>>();
    // Under Vitest the bus stays in the process, so parallel test files never hear each other's events,
    // unless the test chose a transport itself.
    #underTest = process.env.VITEST !== undefined;
    #listening?: object;

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
        this.#listening = undefined;
    }

    get #remote(): boolean{
        return !this.#underTest || hasChosenTransport();
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
            const envelope: Envelope = { origin, event, payload };
            await transport().publish(this.#channel, JSON.stringify(envelope));
        }catch(error){
            logger.error('EventBus::PublishFailed', error);
        }
    }

    // A round per listen: after close() the transport may still deliver to the old listener, which then
    // stays quiet, so an event is never dispatched twice.
    #listen(){
        if(this.#listening) return;

        let target: Transport;
        try{
            target = transport();
        }catch{
            return;
        }

        const round = {};
        this.#listening = round;
        void target.subscribe(this.#channel, (message) => {
            if(this.#listening === round) this.#receive(message);
        }).catch((error: unknown) => {
            logger.error('EventBus::SubscribeFailed', error);
        });
    }

    #receive(message: string){
        let envelope: Envelope;
        try{
            envelope = JSON.parse(message) as Envelope;
        }catch(error){
            logger.error('EventBus::InvalidEnvelope', error);
            return;
        }

        if(envelope.origin === origin) return;
        this.#dispatch(envelope.event, envelope.payload);
    }

    get #channel(): string{
        return `${readableConfig().name}:events`;
    }
}

export const eventBus = new EventBus();

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

export const registerEventGroup = (GroupClass: new () => object) => {
    const group = getEventGroup(GroupClass);
    if(!group) throw EventError.UndefinedGroup();

    const instance = new GroupClass() as Record<string | symbol, Handler>;

    for(const { event, handlerName } of getEvents(GroupClass)){
        eventBus.subscribe(`${group}.${event}`, instance[handlerName].bind(instance));
    }
};
