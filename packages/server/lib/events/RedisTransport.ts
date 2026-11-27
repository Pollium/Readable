import { createRedis } from '../app/redis';
import { Transport, TransportListener, TransportListeners } from './Transport';
import { Redis, RedisOptions } from 'ioredis';

// Redis pub/sub. Without options it connects where the app's config says Redis is.
export class RedisTransport implements Transport{
    #listeners = new TransportListeners();
    #publisher?: Redis;
    #subscriber?: Redis;

    constructor(private readonly options?: RedisOptions){}

    async publish(channel: string, message: string){
        this.#publisher ??= this.#connect();
        await this.#publisher.publish(channel, message);
    }

    async subscribe(channel: string, onMessage: TransportListener){
        const first = this.#listeners.add(channel, onMessage);
        this.#subscriber ??= this.#listen();
        if(first) await this.#subscriber.subscribe(channel);
    }

    async close(){
        const open = [this.#publisher, this.#subscriber];
        this.#publisher = undefined;
        this.#subscriber = undefined;
        this.#listeners.clear();
        await Promise.all(open.map((connection) => connection?.quit()));
    }

    #connect(): Redis{
        return this.options === undefined ? createRedis() : new Redis(this.options);
    }

    #listen(): Redis{
        const subscriber = this.#connect();
        subscriber.on('message', (channel: string, message: string) => this.#listeners.deliver(channel, message));
        return subscriber;
    }
}
