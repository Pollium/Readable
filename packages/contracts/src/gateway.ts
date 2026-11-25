export interface Gateway<Frames extends object = object, Messages extends object = object>{
    readonly channel: string;
    readonly __frames?: (messages: Messages) => Frames;
}

export const gateway = <Frames extends object, Messages extends object = Record<never, never>>(
    channel: string
): Gateway<Frames, Messages> => ({ channel });

export const SocketClose = {
    SessionExpired: 4401,
    AccessRevoked: 4403
} as const;
