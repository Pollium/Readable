export interface Deadline{
    signal: AbortSignal | undefined;
    expired: () => boolean;
    clear: () => void;
}

// The caller's signal still aborts the call; the deadline aborts it as well, and remembers that it
// did, so a call that ran out of time is told apart from one its caller gave up on.
export const deadlineOf = (signal: AbortSignal | undefined, timeoutMs: number): Deadline => {
    if(!Number.isFinite(timeoutMs) || timeoutMs <= 0) return { signal, expired: () => false, clear: () => undefined };

    const controller = new AbortController();
    let expired = false;
    const timer = setTimeout(() => {
        expired = true;
        controller.abort(new DOMException('The call ran out of time', 'TimeoutError'));
    }, timeoutMs);

    const forward = () => controller.abort(signal?.reason);
    if(signal?.aborted) forward();
    else signal?.addEventListener('abort', forward, { once: true });

    return {
        signal: controller.signal,
        expired: () => expired,
        clear: () => clearTimeout(timer)
    };
};
