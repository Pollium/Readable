import {
    RuntimeError,
    defineErrors,
    RequestErrors,
    ServerErrors,
    AuthErrors,
    GatewayErrors,
    RateLimitErrors
} from '@pollium/readable-contracts/errors';

export { RuntimeError, defineErrors };

export class ValidationError extends RuntimeError{
    constructor(
        readonly errors: Record<string, string>, 
        template: RuntimeError = RequestError.ValidationFailed()
    ){
        super(template.message, template.statusCode);
    }
}

export const RequestError = defineErrors(RequestErrors);
export const ServerError = defineErrors(ServerErrors);
export const AuthError = defineErrors(AuthErrors);
export const GatewayError = defineErrors(GatewayErrors);
export const RateLimitError = defineErrors(RateLimitErrors);

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
        MissingPlugin: 500,
        InvalidEnv: 500,
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
