import { defineErrors } from '@pollium/readable-contracts/errors';

export interface WebOptions{
    name: string;
    apiUrl?: string;
}

export interface WebSettings{
    name: string;
    apiUrl: string;
}

const ConfigErrors = defineErrors({
    domain: 'Config',
    causes: {
        NotConfigured: 500
    }
});

let current: WebSettings | null = null;

export const configure = ({ name, apiUrl }: WebOptions) => {
    current = {
        name,
        apiUrl: (apiUrl?.trim() || `${window.location.origin}/api`).replace(/\/+$/, '')
    };
};

export const settings = (): WebSettings => {
    if(current === null) throw ConfigErrors.NotConfigured('call mount() or configure() first');
    return current;
};
