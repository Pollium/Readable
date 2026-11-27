import Application from '../../lib/app/Application';
import BaseGateway from '../../lib/gateway/Gateway';
import { ModuleDiscovery } from '../../lib/app/discovery';
import { decodeFrame, encodeFrame, Frame } from '@pollium/readable-contracts/gateway';
import { FastifyInstance } from 'fastify';
import { randomBytes } from 'node:crypto';
import { connect, Socket } from 'node:net';
import { expect } from 'vitest';

export interface Served{
    app: FastifyInstance;
    application: Application;
    port: number;
    url: (path: string) => string;
}

export interface Received{
    frame: Frame;
    bytes?: Uint8Array;
}

export interface Peer{
    socket: WebSocket;
    received: Received[];
    frames: () => Frame[];
    opened: Promise<void>;
    closed: Promise<{ code: number; reason: string }>;
    send: (frame: object, bytes?: Uint8Array) => void;
}

const served: Application[] = [];
const peers: Array<WebSocket | Socket> = [];

export const serve = async (gateways: Array<new () => BaseGateway>): Promise<Served> => {
    const application = new Application({
        port: 0,
        corsOrigins: [],
        log: { level: 'silent', pretty: false },
        discover: async () => ({ ...ModuleDiscovery.merge([]), gateways })
    });
    served.push(application);

    const app = await application.build({ queues: false });
    await app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = app.server.address() as { port: number };

    return {
        app,
        application,
        port,
        url: (path) => `ws://127.0.0.1:${port}${path}`
    };
};

export const peer = (url: string, protocols?: string | string[]): Peer => {
    const socket = new WebSocket(url, protocols);
    socket.binaryType = 'arraybuffer';
    peers.push(socket);

    const received: Received[] = [];
    socket.addEventListener('message', (event: MessageEvent) => {
        const decoded = decodeFrame(event.data as string | ArrayBuffer);
        if(decoded !== undefined) received.push(decoded);
    });

    return {
        socket,
        received,
        frames: () => received.map(({ frame }) => frame),
        opened: new Promise((resolve, reject) => {
            socket.addEventListener('open', () => resolve());
            socket.addEventListener('error', () => reject(new Error('the socket did not open')));
        }),
        closed: new Promise((resolve) => {
            socket.addEventListener('close', (event: CloseEvent) => resolve({ code: event.code, reason: event.reason }));
        }),
        send: (frame, bytes) => socket.send(encodeFrame(frame, bytes))
    };
};

export const opened = async (url: string, protocols?: string | string[]): Promise<Peer> => {
    const opening = peer(url, protocols);
    await opening.opened;
    return opening;
};

export const nextFrame = async (client: Peer, count = 1): Promise<Frame> => {
    await expect.poll(() => client.received.length).toBeGreaterThanOrEqual(count);
    return client.received[count - 1].frame;
};

// A socket that completes the handshake and then reads or answers nothing unless told to.
export const silentPeer = async (port: number, path: string): Promise<Socket> => {
    const socket = connect(port, '127.0.0.1');
    peers.push(socket);

    await new Promise<void>((resolve, reject) => {
        socket.once('error', reject);
        socket.once('connect', () => {
            socket.write([
                `GET ${path} HTTP/1.1`,
                `Host: 127.0.0.1:${port}`,
                'Upgrade: websocket',
                'Connection: Upgrade',
                `Sec-WebSocket-Key: ${randomBytes(16).toString('base64')}`,
                'Sec-WebSocket-Version: 13',
                '',
                ''
            ].join('\r\n'));
        });
        socket.once('data', (chunk: Buffer) => {
            if(chunk.toString().startsWith('HTTP/1.1 101')) resolve();
            else reject(new Error(chunk.toString()));
        });
    });

    return socket;
};

export const closeServed = async () => {
    for(const socket of peers.splice(0)){
        if(socket instanceof WebSocket) socket.close();
        else socket.destroy();
    }
    // One at a time: two apps in one process share broadcast, and closing it twice at once fails.
    for(const application of served.splice(0)) await application.stop();
};
