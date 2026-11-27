export interface Gateway<Frames extends object = object, Messages extends object = object>{
    readonly channel: string;
    readonly __frames?: (messages: Messages) => Frames;
}

export const gateway = <Frames extends object, Messages extends object = Record<never, never>>(
    channel: string
): Gateway<Frames, Messages> => ({ channel });

export const SocketClose = {
    ShuttingDown: 1001,
    SessionExpired: 4401,
    AccessRevoked: 4403,
    Unauthenticated: 4401,
    Forbidden: 4403
} as const;

export type FrameId = string | number;

// One grammar both ways. A frame with `id` asks and is answered by a frame with `re` set to that id;
// a frame with neither is a message. A client puts its fields beside `type`, a server under `data`.
export interface Frame{
    type?: string;
    id?: FrameId;
    re?: FrameId;
    data?: unknown;
    error?: string;
    sessionId?: string;
    [field: string]: unknown;
}

export interface DecodedFrame{
    frame: Frame;
    bytes?: Uint8Array;
}

export class Binary<T = unknown>{
    constructor(readonly data: T, readonly bytes: Uint8Array){}
}

export const binary = <T>(data: T, bytes: Uint8Array): Binary<T> => new Binary(data, bytes);

export const isFrameId = (value: unknown): value is FrameId =>
    typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value));

const HEADER_LENGTH_BYTES = 4;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// A binary frame is [u32 big-endian header length][UTF-8 JSON header][raw bytes].
export const encodeFrame = (header: object, bytes?: Uint8Array): string | Uint8Array<ArrayBuffer> => {
    const text = JSON.stringify(header);
    if(bytes === undefined) return text;

    const head = encoder.encode(text);
    const frame = new Uint8Array(HEADER_LENGTH_BYTES + head.length + bytes.length);
    new DataView(frame.buffer).setUint32(0, head.length, false);
    frame.set(head, HEADER_LENGTH_BYTES);
    frame.set(bytes, HEADER_LENGTH_BYTES + head.length);
    return frame;
};

const parsed = (text: string): Frame | undefined => {
    try{
        const value: unknown = JSON.parse(text);
        return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Frame : undefined;
    }catch{
        return undefined;
    }
};

const bytesOf = (raw: ArrayBuffer | ArrayBufferView): Uint8Array =>
    raw instanceof ArrayBuffer ? new Uint8Array(raw) : new Uint8Array(raw.buffer, raw.byteOffset, raw.byteLength);

// A binary frame whose length prefix cannot be a header is read as JSON text, as gateways read every
// frame before binary frames existed. JSON text starts with `{`, which as a length is past any frame.
export const decodeFrame = (raw: string | ArrayBuffer | ArrayBufferView): DecodedFrame | undefined => {
    if(typeof raw === 'string'){
        const frame = parsed(raw);
        return frame === undefined ? undefined : { frame };
    }

    const all = bytesOf(raw);
    const length = all.length < HEADER_LENGTH_BYTES
        ? Number.POSITIVE_INFINITY
        : new DataView(all.buffer, all.byteOffset, all.byteLength).getUint32(0, false);
    if(length > all.length - HEADER_LENGTH_BYTES) return decodeFrame(decoder.decode(all));

    const frame = parsed(decoder.decode(all.subarray(HEADER_LENGTH_BYTES, HEADER_LENGTH_BYTES + length)));
    return frame === undefined ? undefined : { frame, bytes: all.subarray(HEADER_LENGTH_BYTES + length) };
};

export const reconnectDelay = (attempt: number): number => {
    const ceiling = Math.min(10_000, 500 * 2 ** attempt);
    return ceiling / 2 + Math.random() * ceiling / 2;
};

const CODE = /^[^:\s]+::[^:\s]+/;

// A gateway that refuses a socket closes it with 4000 + the refusal's status and the error code as
// the reason; the closes it sends later give a phrase instead.
export const isRefusal = (reason: string | undefined): boolean => CODE.test(reason ?? '');

export const refusalCode = (status: number): number => status >= 400 && status < 600 ? 4000 + status : 4500;
