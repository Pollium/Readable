import { binary, Binary, decodeFrame, encodeFrame } from '@pollium/readable-contracts/gateway';
import { describe, expect, it } from 'vitest';

const header = (frame: Uint8Array): unknown => {
    const length = new DataView(frame.buffer, frame.byteOffset).getUint32(0, false);
    return JSON.parse(new TextDecoder().decode(frame.subarray(4, 4 + length)));
};

describe('the gateway frame codec', () => {
    it('writes a frame without bytes as JSON text', () => {
        expect(encodeFrame({ type: 'note.watch', notebookId: 'nb1' })).toBe('{"type":"note.watch","notebookId":"nb1"}');
    });

    it('writes a frame with bytes as a big-endian header length, the JSON header, then the bytes', () => {
        const frame = encodeFrame({ type: 'chunk', data: { op: 7 } }, new Uint8Array([1, 2, 3])) as Uint8Array;
        const text = '{"type":"chunk","data":{"op":7}}';

        expect(Array.from(frame.subarray(0, 4))).toEqual([0, 0, 0, text.length]);
        expect(header(frame)).toEqual({ type: 'chunk', data: { op: 7 } });
        expect(Array.from(frame.subarray(4 + text.length))).toEqual([1, 2, 3]);
    });

    it('reads back what it wrote, from bytes, a buffer or a view into a larger one', () => {
        const frame = encodeFrame({ type: 'chunk', re: 3, data: null }, new Uint8Array([9, 8])) as Uint8Array;
        const padded = new Uint8Array(frame.length + 6);
        padded.set(frame, 3);

        for(const raw of [frame, frame.slice().buffer, padded.subarray(3, 3 + frame.length)]){
            const decoded = decodeFrame(raw);
            expect(decoded?.frame).toEqual({ type: 'chunk', re: 3, data: null });
            expect(Array.from(decoded?.bytes ?? [])).toEqual([9, 8]);
        }
    });

    it('carries a header in any UTF-8 and empty bytes', () => {
        const decoded = decodeFrame(encodeFrame({ type: 'nota', data: 'ñandú ☃' }, new Uint8Array()));

        expect(decoded?.frame).toEqual({ type: 'nota', data: 'ñandú ☃' });
        expect(decoded?.bytes?.length).toBe(0);
    });

    it('reads a binary frame that only holds JSON text as that text', () => {
        const raw = new TextEncoder().encode('{"type":"echo","text":"hola"}');

        expect(decodeFrame(raw)).toEqual({ frame: { type: 'echo', text: 'hola' } });
    });

    it('refuses what is not a JSON object', () => {
        for(const raw of ['not json', '[1,2]', 'null', '"text"', new Uint8Array([0, 0, 0, 2, 0x5b, 0x5d]), new Uint8Array([1])]){
            expect(decodeFrame(raw)).toBeUndefined();
        }
    });

    it('wraps data with bytes so a handler can answer with both', () => {
        const bytes = new Uint8Array([1]);
        const answer = binary({ ok: true }, bytes);

        expect(answer).toBeInstanceOf(Binary);
        expect(answer).toMatchObject({ data: { ok: true }, bytes });
    });
});
