import { vi } from 'vitest';

export class FakeSocket{
    static readonly CONNECTING = 0;
    static readonly OPEN = 1;
    static readonly CLOSED = 3;
    static opened: FakeSocket[] = [];

    readyState = FakeSocket.CONNECTING;
    readonly sent: unknown[] = [];
    onopen: (() => void) | null = null;
    onmessage: ((event: { data: string }) => void) | null = null;
    onclose: ((event: { code: number }) => void) | null = null;

    constructor(readonly url: string, readonly protocol?: string){
        FakeSocket.opened.push(this);
    }

    open(){
        this.readyState = FakeSocket.OPEN;
        this.onopen?.();
    }

    receive(frame: object){
        this.onmessage?.({ data: JSON.stringify(frame) });
    }

    send(raw: string){
        this.sent.push(JSON.parse(raw));
    }

    close(code = 1000){
        if(this.readyState === FakeSocket.CLOSED) return;
        this.readyState = FakeSocket.CLOSED;
        this.onclose?.({ code });
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
