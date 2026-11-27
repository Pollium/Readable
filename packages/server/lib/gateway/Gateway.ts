import ConnectionsRegistry from './ConnectionRegistry';
import { hostFor } from './ChannelHost';
import { channelOf } from './bindings';
import { GatewayError } from '../app/errors';
import { WebsocketPluginOptions } from '@fastify/websocket';
import { FastifyInstance } from 'fastify';

export {
    Channel,
    OnConnect,
    OnDisconnect,
    OnMessage,
    Payload,
    Socket,
    Bytes
} from './bindings';
export { Connection } from './Connection';
export type { RequestOptions } from './Connection';

export const websocketOptions: WebsocketPluginOptions = {
    options: { maxPayload: 1024 * 1024 }
};

export default abstract class BaseGateway{
    #connections = new ConnectionsRegistry();

    protected get connections(): ConnectionsRegistry{
        return this.#connections;
    }

    register(app: FastifyInstance){
        const channel = channelOf(this.constructor);
        if(!channel) throw GatewayError.MissingChannel();

        const host = hostFor(app, channel.path, this.#connections);
        host.add(this);
        this.#connections = host.registry;
    }

}
