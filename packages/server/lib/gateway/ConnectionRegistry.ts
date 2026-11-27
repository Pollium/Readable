import { Connection, LiveConnection } from './Connection';
import { encodeFrame } from '@pollium/readable-contracts/gateway';
import { WebSocket } from '@fastify/websocket';

export interface OutboundMessage<T>{
    type: string;
    data: T;
}

export interface RoomGrant{
    room: string;
    access: RoomAccess;
}

export type RoomAccess = () => Promise<unknown>;

// A socket from `@Socket()`, a connection from `@Connection()`, or a connection's id.
export type ConnectionTarget = WebSocket | Connection<object> | string;

export default class ConnectionsRegistry{
    #sockets = new Set<WebSocket>();
    #rooms = new Map<string, Set<WebSocket>>();
    #memberships = new WeakMap<WebSocket, Set<string>>();
    #access = new WeakMap<WebSocket, Map<string, RoomAccess>>();
    #connections = new WeakMap<WebSocket, LiveConnection>();
    #byId = new Map<string, LiveConnection>();

    add(socket: WebSocket, connection?: LiveConnection){
        this.#sockets.add(socket);
        if(connection === undefined) return;
        this.#connections.set(socket, connection);
        this.#byId.set(connection.id, connection);
    }

    remove(target: ConnectionTarget){
        const socket = this.#socketOf(target);
        if(socket === undefined) return;

        this.leaveAll(socket);
        this.#sockets.delete(socket);
        const connection = this.#connections.get(socket);
        if(connection !== undefined) this.#byId.delete(connection.id);
    }

    connection(id: string): Connection | undefined{
        return this.#byId.get(id);
    }

    join(target: ConnectionTarget, room: string, access?: RoomAccess){
        const socket = this.#socketOf(target);
        if(socket === undefined) return;

        let members = this.#rooms.get(room);
        if(!members){
            members = new Set();
            this.#rooms.set(room, members);
        }

        members.add(socket);

        const memberships = this.#memberships.get(socket) ?? new Set<string>();
        memberships.add(room);
        this.#memberships.set(socket, memberships);

        if(access === undefined) return;
        const granted = this.#access.get(socket) ?? new Map<string, RoomAccess>();
        granted.set(room, access);
        this.#access.set(socket, granted);
    }

    leave(target: ConnectionTarget, room: string){
        const socket = this.#socketOf(target);
        if(socket === undefined) return;

        const members = this.#rooms.get(room);
        members?.delete(socket);
        if(members?.size === 0) this.#rooms.delete(room);

        this.#memberships.get(socket)?.delete(room);
        this.#access.get(socket)?.delete(room);
    }

    leaveAll(target: ConnectionTarget){
        const socket = this.#socketOf(target);
        if(socket === undefined) return;

        for(const room of this.#memberships.get(socket) ?? []) this.leave(socket, room);

        this.#memberships.delete(socket);
        this.#access.delete(socket);
    }

    async reauthorize(target: ConnectionTarget){
        const socket = this.#socketOf(target);
        if(socket === undefined) return;

        for(const access of this.#access.get(socket)?.values() ?? []) await access();
    }

    has(room: string): boolean{
        return this.#rooms.has(room);
    }

    isIn(target: ConnectionTarget, room: string): boolean{
        const socket = this.#socketOf(target);
        return socket !== undefined && this.#rooms.get(room)?.has(socket) === true;
    }

    roomsOf(target: ConnectionTarget): string[]{
        const socket = this.#socketOf(target);
        return socket === undefined ? [] : [...this.#memberships.get(socket) ?? []];
    }

    members(room: string): Connection[]{
        return [...this.#rooms.get(room) ?? []].flatMap((socket) => {
            const connection = this.#connections.get(socket);
            return connection === undefined ? [] : [connection];
        });
    }

    broadcast(message: OutboundMessage<unknown>, bytes?: Uint8Array){
        this.#send(this.#sockets, message, bytes);
    }

    sendTo(target: ConnectionTarget, message: OutboundMessage<unknown>, bytes?: Uint8Array): boolean{
        const socket = this.#socketOf(target);
        if(socket === undefined) return false;

        return this.#write(socket, encodeFrame(message, bytes));
    }

    sendToRoom(room: string, message: OutboundMessage<unknown>, bytes?: Uint8Array){
        const members = this.#rooms.get(room);
        if(members) this.#send(members, message, bytes);
    }

    sendToRooms(rooms: string[], message: OutboundMessage<unknown>, bytes?: Uint8Array){
        this.#send(new Set(rooms.flatMap((room) => [...this.#rooms.get(room) ?? []])), message, bytes);
    }

    sendToRoomExcept(room: string, except: ConnectionTarget, message: OutboundMessage<unknown>, bytes?: Uint8Array){
        const skipped = this.#socketOf(except);
        const members = [...this.#rooms.get(room) ?? []].filter((socket) => socket !== skipped);
        this.#send(members, message, bytes);
    }

    #send(sockets: Iterable<WebSocket>, message: OutboundMessage<unknown>, bytes?: Uint8Array){
        const raw = encodeFrame(message, bytes);
        for(const socket of sockets) this.#write(socket, raw);
    }

    #write(socket: WebSocket, raw: string | Uint8Array): boolean{
        const connection = this.#connections.get(socket);
        if(connection !== undefined) return connection.write(raw);

        socket.send(raw);
        return true;
    }

    #socketOf(target: ConnectionTarget): WebSocket | undefined{
        if(typeof target === 'string') return this.#byId.get(target)?.socket;
        return target instanceof LiveConnection ? target.socket : target as WebSocket;
    }

    get size(): number{
        return this.#sockets.size;
    }
}
