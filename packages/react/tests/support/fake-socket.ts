import { decodeFrame, encodeFrame } from '@pollium/readable-contracts/gateway';
import { vi } from 'vitest';

export interface SentBinary{
    frame: object | undefined;
    bytes: number[];
}

export class FakeSocket{
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 3;
    static opened: FakeSocket[] = [];

    readyState = FakeSocket.CONNECTING;
    binaryType = 'blob';
    readonly sent: unknown[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string | ArrayBuffer }) => void) | null = null;
    onclose: ((event: { code: number; reason: string }) => void) | null = null;

    constructor(readonly url: string, readonly protocol?: string){
        FakeSocket.opened.push(this);
    }

    open(){
        this.readyState = FakeSocket.OPEN;
        this.onopen?.();
    }

    receive(frame: object, bytes?: Uint8Array){
        const raw = encodeFrame(frame, bytes);
        this.onmessage?.({ data: typeof raw === 'string' ? raw : raw.buffer });
    }

    send(raw: string | Uint8Array){
        if(typeof raw === 'string'){
            this.sent.push(JSON.parse(raw));
            return;
        }
        const decoded = decodeFrame(raw);
        this.sent.push({ frame: decoded?.frame, bytes: Array.from(decoded?.bytes ?? []) } satisfies SentBinary);
    }

    close(code = 1000, reason = ''){
        if(this.readyState === FakeSocket.CLOSED) return;
        this.readyState = FakeSocket.CLOSED;
        this.onclose?.({ code, reason });
    }
}

export const fakeSockets = () => {
    FakeSocket.opened = [];
    vi.stubGlobal('WebSocket', FakeSocket);
    return {
        get last(): FakeSocket{
            return FakeSocket.opened[FakeSocket.opened.length - 1];
        },
        get opened(): FakeSocket[]{
            return FakeSocket.opened;
        }
    };
};
