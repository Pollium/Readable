import { vi } from 'vitest';

type Handler = (() => void) | null;

export class FakeXhr{
    static sent: FakeXhr[] = [];

    method = '';
    url = '';
    headers: Record<string, string> = {};
    body: unknown = undefined;
    withCredentials = false;
    status = 0;
    statusText = '';
    responseText = '';
    upload: { onprogress: ((event: ProgressEvent) => void) | null } = { onprogress: null };
    onload: Handler = null;
    onerror: Handler = null;
    onabort: Handler = null;

    open(method: string, url: string){
        this.method = method;
        this.url = url;
    }

    setRequestHeader(name: string, value: string){
        this.headers[name] = value;
    }

    send(body: unknown){
        this.body = body;
        FakeXhr.sent.push(this);
    }

    abort(){
        this.onabort?.();
    }

    progress(loaded: number, total: number, lengthComputable = true){
        this.upload.onprogress?.({ loaded, total, lengthComputable } as ProgressEvent);
    }

    answer(status: number, body?: unknown, statusText = ''){
        this.status = status;
        this.statusText = statusText;
        this.responseText = body === undefined ? '' : typeof body === 'string' ? body : JSON.stringify(body);
        this.onload?.();
    }

    fail(){
        this.onerror?.();
    }
}

export const fakeXhr = () => {
    FakeXhr.sent = [];
    vi.stubGlobal('XMLHttpRequest', FakeXhr);
    return FakeXhr.sent;
};
