import { channels, ChannelStatus, RequestOptions, SendOptions } from './SocketChannel';
import { Binary, Gateway } from '@pollium/readable-contracts/gateway';
import { defineErrors, GatewayErrors } from '@pollium/readable-contracts/errors';
import { useCallback, useEffect, useRef, useState } from 'react';

const GatewayError = defineErrors(GatewayErrors);

export type FrameHandlers<Frames> = {
    readonly [Type in keyof Frames]?: (data: Frames[Type], bytes?: Uint8Array) => void;
};

type AnswerOf<Messages, Type> = Type extends keyof Messages ? Messages[Type] | Binary<Messages[Type]> : unknown;

// The server asks with a frame of a type, and the web answers with its own message of that type.
export type AnswerHandlers<Frames, Messages> = {
    readonly [Type in keyof Frames]?: (
        data: Frames[Type],
        bytes?: Uint8Array
    ) => AnswerOf<Messages, Type> | Promise<AnswerOf<Messages, Type>>;
};

type LeaveOf<Messages, Data> = {
    [Leave in keyof Messages]: Data extends Messages[Leave] ? Leave : never;
}[keyof Messages];

export type JoinOf<Messages> = {
    [Type in keyof Messages]:
        | readonly [type: Type, data: Messages[Type]]
        | readonly [type: Type, data: Messages[Type], leave: LeaveOf<Messages, Messages[Type]>];
}[keyof Messages];

export type ReplyOf<Frames, Type> = Type extends keyof Frames ? Frames[Type] : unknown;

export interface ChannelOptions<Messages, Frames = object>{
    join?: JoinOf<Messages> | null;
    joins?: ReadonlyArray<JoinOf<Messages> | null>;
    answers?: AnswerHandlers<Frames, Messages>;
    onError?: (error: string, sessionId: string | undefined) => void;
}

export interface Channel<Messages, Frames = object>{
    send: <Type extends keyof Messages & string>(type: Type, data: Messages[Type], options?: SendOptions) => boolean;
    request: <Type extends keyof Messages & string>(
        type: Type,
        data: Messages[Type],
        options?: RequestOptions
    ) => Promise<ReplyOf<Frames, Type>>;
    status: ChannelStatus;
    lastError: string | undefined;
    clearError: () => void;
}

type AnyHandlers = Readonly<Record<string, ((data: unknown, bytes?: Uint8Array) => unknown) | undefined>>;
type Joined = readonly [type: string, data: unknown, leave?: string];

export const useChannel = <Frames extends object, Messages extends object>(
    gateway: Gateway<Frames, Messages>,
    handlers: FrameHandlers<Frames>,
    { join = null, joins = [], answers, onError }: ChannelOptions<Messages, Frames> = {}
): Channel<Messages, Frames> => {
    const path = gateway.channel;
    const [status, setStatus] = useState<ChannelStatus>('connecting');
    const [lastError, setLastError] = useState<string | undefined>(undefined);

    const latest = useRef(handlers as AnyHandlers);
    const latestAnswers = useRef((answers ?? {}) as AnyHandlers);
    const latestError = useRef(onError);
    const held = useRef(new Map<string, () => void>());
    useEffect(() => {
        latest.current = handlers as AnyHandlers;
        latestAnswers.current = (answers ?? {}) as AnyHandlers;
        latestError.current = onError;
    });

    // Declared before the channel is acquired, so its cleanup leaves while the channel is still open.
    useEffect(() => () => {
        held.current.forEach((leave) => leave());
        held.current = new Map();
    }, [path]);

    useEffect(() => {
        const channel = channels.acquire(path);
        const offs = [
            channel.onStatus(setStatus),
            channel.onError((error, sessionId) => {
                setLastError(error);
                latestError.current?.(error, sessionId);
            }),
            ...Object.keys(latest.current).map((type) => channel.on(type, (...frame) => latest.current[type]?.(...frame))),
            ...Object.keys(latestAnswers.current).map((type) => channel.answer(type, (data, bytes) => latestAnswers.current[type]?.(data, bytes)))
        ];

        return () => {
            offs.forEach((off) => off());
            channels.release(path);
        };
    }, [path]);

    const joined = JSON.stringify([join, ...joins].filter((entry) => entry !== null));
    useEffect(() => {
        const channel = channels.peek(path);
        if(channel === undefined) return;

        const next = new Map<string, () => void>();
        for(const entry of JSON.parse(joined) as Joined[]){
            const key = JSON.stringify(entry);
            if(next.has(key)) continue;
            const [type, data, leave] = entry;
            next.set(key, held.current.get(key) ?? channel.join(type, data, leave));
        }
        for(const [key, leave] of held.current){
            if(!next.has(key)) leave();
        }
        held.current = next;
    }, [path, joined]);

    const send = useCallback(
        <Type extends keyof Messages & string>(type: Type, data: Messages[Type], options?: SendOptions) =>
            channels.peek(path)?.send(type, data, options) ?? false,
        [path]
    );

    const request = useCallback(
        <Type extends keyof Messages & string>(type: Type, data: Messages[Type], options?: RequestOptions) => {
            const channel = channels.peek(path);
            if(channel === undefined) return Promise.reject(GatewayError.Closed());
            return channel.request<ReplyOf<Frames, Type>>(type, data, options);
        },
        [path]
    );

    return {
        send,
        request,
        status,
        lastError,
        clearError: () => setLastError(undefined)
    };
};
