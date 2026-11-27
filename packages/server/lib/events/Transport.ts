import { logger } from '../app/logger';

export type TransportListener = (message: string) => void;

// What carries the event bus and broadcast between the instances of an app. A transport delivers every
// message to every subscriber of its channel, the instance that published it included.
export interface Transport{
    publish(channel: string, message: string): Promise<void>;
    subscribe(channel: string, onMessage: TransportListener): Promise<void>;
    close(): Promise<void>;
}

export class TransportListeners{
    #byChannel = new Map<string, TransportListener[]>();

    // True for the first listener of a channel, which is when a transport starts listening on it.
    add(channel: string, listener: TransportListener): boolean{
        const listeners = this.#byChannel.get(channel);
        if(listeners){
            listeners.push(listener);
            return false;
        }

        this.#byChannel.set(channel, [listener]);
        return true;
    }

    has(channel: string): boolean{
        return this.#byChannel.has(channel);
    }

    deliver(channel: string, message: string){
        for(const listener of this.#byChannel.get(channel) ?? []){
            try{
                listener(message);
            }catch(error){
                logger.error(`Transport::ListenerFailed:${channel}`, error);
            }
        }
    }

    clear(){
        this.#byChannel.clear();
    }
}
