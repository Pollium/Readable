import { OutgoingRequest, settings } from '../app/config';
import { session } from '../session/session';
import { parsed, refusal, unwrap } from './answer';
import { ApiError } from './ApiError';
import { headersOf } from './call';

export interface UploadProgress{
    loaded: number;
    total: number;
}

export interface UploadOptions{
    method?: string;
    headers?: Readonly<Record<string, string>>;
    onProgress?: (progress: UploadProgress) => void;
    signal?: AbortSignal;
}

export type UploadBody = Blob | ArrayBuffer | ArrayBufferView | FormData | URLSearchParams | string;

const sizeOf = (body: UploadBody): number => {
    if(body instanceof Blob) return body.size;
    if(body instanceof ArrayBuffer || ArrayBuffer.isView(body)) return body.byteLength;
    return 0;
};

const isOn = (url: string, api: string): boolean => url === api || url.startsWith(`${api}/`) || url.startsWith(`${api}?`);

interface Sending{
    url: string;
    init: OutgoingRequest;
    total: number;
    onApi: boolean;
    token: string | null;
    onProgress?: (progress: UploadProgress) => void;
}

const sent = ({ url, init, total, onApi, token, onProgress }: Sending): Promise<unknown> => new Promise((resolve, reject) => {
    const signal = init.signal ?? undefined;
    if(signal?.aborted) return reject(signal.reason);

    const xhr = new XMLHttpRequest();
    const abort = () => xhr.abort();
    const done = (answer: unknown) => {
        signal?.removeEventListener('abort', abort);
        resolve(answer);
    };
    const failed = (cause: unknown) => {
        signal?.removeEventListener('abort', abort);
        reject(cause);
    };

    xhr.open(init.method, url);
    xhr.withCredentials = init.credentials === 'include';
    for(const [name, value] of Object.entries(init.headers)) xhr.setRequestHeader(name, value);

    xhr.upload.onprogress = (event: ProgressEvent) => onProgress?.({
        loaded: event.loaded,
        total: event.lengthComputable ? event.total : total
    });
    xhr.onload = () => {
        const payload = parsed(xhr.responseText);
        if(xhr.status >= 200 && xhr.status < 300) return done(onApi ? unwrap(payload) : payload);
        failed(refusal(xhr.status, xhr.statusText, payload, token));
    };
    xhr.onerror = () => failed(new ApiError(0, 'Network::Unreachable'));
    xhr.onabort = () => failed(signal?.reason ?? new DOMException('The upload was aborted', 'AbortError'));

    signal?.addEventListener('abort', abort, { once: true });
    xhr.send(init.body as XMLHttpRequestBodyInit);
});

// fetch cannot tell how much of a body has gone out, so an upload that shows progress goes over XHR.
// Only a url on the api carries the session and the app's request hook: a presigned url on a store
// refuses a request that is signed twice, or a header its CORS rules do not name.
export const upload = async <O = unknown>(
    url: string,
    body: UploadBody,
    { method = 'PUT', headers, onProgress, signal }: UploadOptions = {}
): Promise<O> => {
    const config = settings();
    const api = config.apiUrl;
    const target = url.startsWith('/') && !url.startsWith('//') ? `${api}${url}` : url;
    const onApi = isOn(target, api);
    const token = onApi ? session.token : null;
    const init: OutgoingRequest = {
        method,
        headers: headersOf(body instanceof FormData ? 'form' : 'raw', undefined, token, headers),
        body: body as BodyInit,
        credentials: onApi ? config.credentials : 'omit',
        signal
    };
    if(onApi && config.onRequest !== null) await config.onRequest(init, target);

    return await sent({ url: target, init, total: sizeOf(body), onApi, token, onProgress }) as O;
};
