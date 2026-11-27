import { cache } from './cache';

// A poll counts from the last answer, waits while the tab is hidden and asks as soon as it is shown.
export const poll = (key: string, every: number): (() => void) => {
    const ask = () => {
        if(document.hidden) return document.addEventListener('visibilitychange', ask, { once: true });
        void cache.fetch(key, { maxAge: 0 });
    };
    const timer = setTimeout(ask, every);

    return () => {
        clearTimeout(timer);
        document.removeEventListener('visibilitychange', ask);
    };
};
