import { logger } from '../app/logger';
import { transport } from './transports';

type BroadcastHandler = (payload: unknown) => void | Promise<void>;

class Broadcast{
    #handlers = new Map<string, BroadcastHandler[]>();
    // A subscription made before close() keeps arriving while its transport lives; it answers only to the
    // round it was made in, so a channel subscribed again is not heard twice.
    #round = {};

    async publish(channel: string, payload: unknown){
        await transport().publish(channel, JSON.stringify(payload));
    }

    subscribe<T>(channel: string, handler: (payload: T) => void | Promise<void>){
        const handlers = this.#handlers.get(channel);
        if(handlers){
            handlers.push(handler as BroadcastHandler);
            return;
        }

        this.#handlers.set(channel, [handler as BroadcastHandler]);
        const round = this.#round;
        void transport().subscribe(channel, (message) => {
            if(round === this.#round) this.#deliver(channel, message);
        }).catch((error: unknown) => {
            logger.error(`Broadcast::SubscribeFailed:${channel}`, error);
        });
    }

    async close(){
        this.#handlers.clear();
        this.#round = {};
    }

    #deliver(channel: string, message: string){
        for(const handler of this.#handlers.get(channel) ?? []){
            const failed = (error: unknown) => logger.error(`Broadcast::HandlerFailed:${channel}`, error);
            try{
                const result = handler(JSON.parse(message));
                if(result instanceof Promise) result.catch(failed);
            }catch(error){
                failed(error);
            }
        }
    }
}

export const broadcast = new Broadcast();
