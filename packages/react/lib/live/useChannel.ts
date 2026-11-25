import { channels, ChannelStatus } from './SocketChannel';
import { Gateway } from '@pollium/readable-contracts/gateway';
import { useCallback, useEffect, useRef, useState } from 'react';

export type FrameHandlers<Frames> = {
    readonly [Type in keyof Frames]?: (data: Frames[Type]) => void;
};

export type JoinOf<Messages> = {
    [Type in keyof Messages]: readonly [type: Type, data: Messages[Type]];
}[keyof Messages];

export interface ChannelOptions<Messages>{
    join?: JoinOf<Messages> | null;
    onError?: (error: string, sessionId: string | undefined) => void;
}

export interface Channel<Messages>{
    send: <Type extends keyof Messages & string>(type: Type, data: Messages[Type]) => boolean;
    status: ChannelStatus;
    lastError: string | undefined;
    clearError: () => void;
}

type AnyHandlers = Readonly<Record<string, ((data: unknown) => void) | undefined>>;

export const useChannel = <Frames extends object, Messages extends object>(
    gateway: Gateway<Frames, Messages>,
    handlers: FrameHandlers<Frames>,
    { join = null, onError }: ChannelOptions<Messages> = {}
): Channel<Messages> => {
    const path = gateway.channel;
    const [status, setStatus] = useState<ChannelStatus>('connecting');
    const [lastError, setLastError] = useState<string | undefined>(undefined);

    const latest = useRef(handlers as AnyHandlers);
    const latestError = useRef(onError);
    useEffect(() => {
        latest.current = handlers as AnyHandlers;
        latestError.current = onError;
    });

    useEffect(() => {
        const channel = channels.acquire(path);
        const offs = [
            channel.onStatus(setStatus),
            channel.onError((error, sessionId) => {
                setLastError(error);
                latestError.current?.(error, sessionId);
            }),
            ...Object.keys(latest.current).map((type) => channel.on(type, (data) => latest.current[type]?.(data)))
        ];

        return () => {
            offs.forEach((off) => off());
            channels.release(path);
        };
    }, [path]);

    const joined = join === null ? null : JSON.stringify(join);
    useEffect(() => {
        if(status !== 'open' || joined === null) return;
        const [type, data] = JSON.parse(joined) as [string, unknown];
        channels.peek(path)?.send(type, data);
    }, [path, status, joined]);

    const send = useCallback(
        <Type extends keyof Messages & string>(type: Type, data: Messages[Type]) => channels.peek(path)?.send(type, data) ?? false,
        [path]
    );

    return {
        send,
        status,
        lastError,
        clearError: () => setLastError(undefined)
    };
};
