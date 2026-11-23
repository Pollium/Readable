import {
    ErrorTable,
    RequestErrors,
    ServerErrors,
    AuthErrors,
    GatewayErrors,
    RateLimitErrors
} from '@pollium/readable-contracts/errors';

export class RuntimeError extends Error{
    public statusCode: number;

    constructor(message: string, statusCode: number){
        super(message);
        this.statusCode = statusCode;
        Error.captureStackTrace(this, this.constructor);
    }
}

export class ValidationError extends RuntimeError{
    constructor(
        readonly errors: Record<string, string>, 
        template: RuntimeError = RequestError.ValidationFailed()
    ){
        super(template.message, template.statusCode);
    }
}

type ErrorFactory = (detail?: string) => RuntimeError;

export const defineErrors = <T extends ErrorTable>({ domain, causes }: T): Record<keyof T['causes'], ErrorFactory> => {
    const factories = {} as Record<keyof T['causes'], ErrorFactory>;
    for(const [cause, status] of Object.entries(causes)){
        factories[cause as keyof T['causes']] = (detail?: string) => {
            const code = detail === undefined ? `${domain}::${cause}` : `${domain}::${cause}:${detail}`;
            return new RuntimeError(code, status);
        };
    }
    return factories;
};

export const RequestError = defineErrors(RequestErrors);

export const ServerError = defineErrors(ServerErrors);

export const AuthError = defineErrors(AuthErrors);

export const GatewayError = defineErrors(GatewayErrors);

export const RateLimitError = defineErrors(RateLimitErrors);

export const RouteError = defineErrors({
    domain: 'Route',
    causes: {
        PrefixMismatch: 500
    }
});

export const EventError = defineErrors({
    domain: 'Events',
    causes: {
        UndefinedGroup: 500
    }
});

export const ConfigError = defineErrors({
    domain: 'Config',
    causes: {
        MissingEnv: 500,
        InvalidEncryptionKey: 500
    }
});

export const CryptoError = defineErrors({
    domain: 'Crypto',
    causes: {
        EncryptFailed: 400,
        DecryptFailed: 500
    }
});

export const SchemaError = defineErrors({
    domain: 'Schema',
    causes: {
        PendingMigrations: 500,
        Irreversible: 500
    }
});
