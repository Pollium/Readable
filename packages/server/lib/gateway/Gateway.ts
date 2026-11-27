import ConnectionsRegistry, { OutboundMessage } from './ConnectionRegistry';
import { ChannelHost, hostFor, hostsOf, RoomSendOptions } from './ChannelHost';
import { channelOf } from './bindings';
import { GatewayError } from '../app/errors';
import { WebsocketPluginOptions } from '@fastify/websocket';
import { FastifyInstance } from 'fastify';

export {
    Channel,
    OnConnect,
    OnDisconnect,
    OnMessage,
    OnShutdown,
    Payload,
    Socket,
    Bytes
} from './bindings';
export type { ChannelOptions } from './bindings';
export { Connection } from './Connection';
export type { RequestOptions } from './Connection';
export type { RoomSendOptions } from './ChannelHost';

export const websocketOptions: WebsocketPluginOptions = {
    options: { maxPayload: 1024 * 1024 }
};

// Runs every gateway's @OnShutdown() and closes its sockets with 1001; Application.stop() calls it
// before the server closes, and an app that drives Fastify itself calls it before app.close().
export const closeGateways = async (app: FastifyInstance) => {
    await Promise.all(hostsOf(app).map((host) => host.shutdown()));
};

export default abstract class BaseGateway{
    #connections = new ConnectionsRegistry();
    #host: ChannelHost | undefined;

    protected get connections(): ConnectionsRegistry{
        return this.#connections;
    }

    register(app: FastifyInstance){
        const channel = channelOf(this.constructor);
        if(!channel) throw GatewayError.MissingChannel();

        const host = hostFor(app, channel.path, this.#connections);
        host.add(this, channel.options);
        this.#connections = host.registry;
        this.#host = host;
    }

    // Sends to the room's members here and, through broadcast, on every other instance of the app.
    async toRoom(room: string, message: OutboundMessage<unknown>, options: RoomSendOptions = {}){
        if(this.#host !== undefined) return this.#host.toRoom(room, message, options);

        const { except, bytes } = options;
        if(except === undefined) this.#connections.sendToRoom(room, message, bytes);
        else this.#connections.sendToRoomExcept(room, except, message, bytes);
    }
}
