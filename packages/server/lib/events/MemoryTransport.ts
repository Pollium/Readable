import { Transport, TransportListener, TransportListeners } from './Transport';

// One process, no network: what a single instance, a test or a browser worker needs.
export class MemoryTransport implements Transport{
    #listeners = new TransportListeners();

    async publish(channel: string, message: string){
        queueMicrotask(() => this.#listeners.deliver(channel, message));
    }

    async subscribe(channel: string, onMessage: TransportListener){
        this.#listeners.add(channel, onMessage);
    }

    async close(){
        this.#listeners.clear();
    }
}
