import { RawBody, RawHeaders, RawResponse } from './responses';

export type Disposition = 'attachment' | 'inline';

export interface DownloadOptions{
    filename?: string;
    contentType?: string;
    disposition?: Disposition;
    length?: number;
    cache?: string;
    headers?: RawHeaders;
}

const lengthOf = (body: RawBody): number | undefined => {
    if(typeof body === 'string') return Buffer.byteLength(body);
    return body instanceof Uint8Array ? body.byteLength : undefined;
};

// RFC 5987 leaves ' ( ) * out of attr-char, and encodeURIComponent keeps them.
const encoded = (filename: string): string =>
    encodeURIComponent(filename).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);

// filename= is what a client without RFC 6266 support reads, so it holds only printable ASCII
// with no quote or backslash; filename*= carries the real name whenever that changed it. A % is
// sent both ways because some clients percent-decode filename=.
export const contentDisposition = (disposition: Disposition, filename?: string): string => {
    if(filename === undefined) return disposition;

    const fallback = filename.replace(/[^\x20-\x7e]|["\\]/g, '_');
    if(fallback === filename && !filename.includes('%')) return `${disposition}; filename="${filename}"`;

    return `${disposition}; filename="${fallback}"; filename*=UTF-8''${encoded(filename)}`;
};

export const download = (body: RawBody, options: DownloadOptions = {}): RawResponse => {
    const { filename, contentType = 'application/octet-stream', disposition, cache, headers = {} } = options;
    const length = options.length ?? lengthOf(body);

    return new RawResponse(body, contentType, 200, {
        'x-content-type-options': 'nosniff',
        ...(filename === undefined && disposition === undefined
            ? {}
            : { 'content-disposition': contentDisposition(disposition ?? 'attachment', filename) }),
        ...(length === undefined ? {} : { 'content-length': length }),
        ...(cache === undefined ? {} : { 'cache-control': cache }),
        ...headers
    });
};
