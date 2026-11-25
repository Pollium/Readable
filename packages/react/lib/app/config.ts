import { AppCopy } from '../errors/copy';
import { defineErrors } from '@pollium/readable-contracts/errors';

export interface WebOptions{
    name: string;
    apiUrl?: string;
    copy?: AppCopy;
}

export interface WebSettings{
    name: string;
    apiUrl: string;
    copy: AppCopy | null;
}

const ConfigErrors = defineErrors({
    domain: 'Config',
    causes: {
        NotConfigured: 500
    }
});

let current: WebSettings | null = null;

export const configure = ({ name, apiUrl, copy }: WebOptions) => {
    current = {
        name,
        apiUrl: (apiUrl?.trim() || `${window.location.origin}/api`).replace(/\/+$/, ''),
        copy: copy ?? null
    };
};

export const settings = (): WebSettings => {
    if(current === null) throw ConfigErrors.NotConfigured('call mount() or configure() first');
    return current;
};
