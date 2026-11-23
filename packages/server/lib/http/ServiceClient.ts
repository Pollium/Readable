import { Endpoint } from '@pollium/readable-contracts/routing';
import { call, CallOptions, Host } from './call';

export default class ServiceClient{
    #host: Host;

    constructor(host: Host){
        this.#host = host;
    }

    call<I, O>(endpoint: Endpoint<I, O>, options?: CallOptions<I>): Promise<O>{
        return call(this.#host, endpoint, options);
    }
}
