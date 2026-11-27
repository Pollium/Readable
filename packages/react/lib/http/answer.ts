import { session } from '../session/session';
import { ApiError } from './ApiError';
import { AuthErrors, baseCodeOf } from '@pollium/readable-contracts/errors';
import { ApiError as ErrorBody, ApiResponse, PageOf } from '@pollium/readable-contracts/http';

const ENDS_SESSION = Object.entries(AuthErrors.causes)
    .filter(([, status]) => status === 401)
    .map(([cause]) => `${AuthErrors.domain}::${cause}`);

export const unwrap = (payload: unknown): unknown => {
    const answer = payload as ApiResponse<unknown> | undefined;
    if(!answer?.meta) return answer?.data;

    return {
        items: answer.data as unknown[],
        meta: answer.meta
    } satisfies PageOf<unknown>;
};

export const parsed = (text: string): unknown => {
    if(text === '') return undefined;

    try{
        return JSON.parse(text);
    }catch{
        return undefined;
    }
};

// A 401 ends the session only for the token it was sent with, so one started since is kept.
export const refusal = (status: number, statusText: string, payload: unknown, token: string | null): ApiError => {
    const code = (payload as ErrorBody | undefined)?.error ?? statusText;
    if(status === 401 && token !== null && ENDS_SESSION.includes(baseCodeOf(code))) session.end(token);
    return new ApiError(status, code, payload);
};
