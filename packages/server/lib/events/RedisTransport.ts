import { createRedis } from '../app/redis';
import { Transport, TransportListener, TransportListeners } from './Transport';
import { Redis, RedisOptions } from 'ioredis';

// Redis pub/sub. Without options it connects where the app's config says Redis is.
export class RedisTransport implements Transport{
    #listeners = new TransportListeners();
    #publisher?: Redis;
    #subscriber?: Redis;
    #ready?: Promise<void>;

    constructor(private readonly options?: RedisOptions){}

    async publish(channel: string, message: string){
        this.#publisher ??= this.#connect();
        await this.#publisher.publish(channel, message);
    }

    async subscribe(channel: string, onMessage: TransportListener){
        const first = this.#listeners.add(channel, onMessage);
        this.#subscriber ??= this.#listen();
        if(!first) return;
        // A SUBSCRIBE sent while ioredis still checks a new connection with INFO puts it in subscriber
        // mode first, and that check, then the subscription, fail. Every subscription waits for ready.
        if(this.#subscriber.status !== 'ready') await this.#ready;
        await this.#subscriber.subscribe(channel);
    }

    async close(){
        const open = [this.#publisher, this.#subscriber];
        this.#publisher = undefined;
        this.#subscriber = undefined;
        this.#ready = undefined;
        this.#listeners.clear();
        await Promise.all(open.map((connection) => connection?.quit()));
    }

    #connect(): Redis{
        return this.options === undefined ? createRedis() : new Redis(this.options);
    }

    #listen(): Redis{
        const subscriber = this.#connect();
        subscriber.on('message', (channel: string, message: string) => this.#listeners.deliver(channel, message));
        this.#ready = subscriber.status === 'ready'
            ? Promise.resolve()
            : new Promise((resolve) => subscriber.once('ready', () => resolve()));
        return subscriber;
    }
}
