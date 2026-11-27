import { ClassMetadata } from '../app/metadata';
import { streamedBodyOf } from './stream-body';
import { Form, UploadOptions, formOf } from './multipart';
import { RequestError, ValidationError } from '../app/errors';
import { IValidation } from 'typia';
import { FastifyReply, FastifyRequest } from 'fastify';

export type { FormValues, UploadOptions } from './multipart';

export interface UploadedFile{
    filename: string;
    buffer: Buffer;
    field?: string;
    mimetype?: string;
}

export type ParamResolver = (req: FastifyRequest, reply?: FastifyReply) => unknown;
export type BodyValidator<T> = (input: unknown) => IValidation<T>;

export interface ParamBinding{
    handlerName: string | symbol;
    index: number;
    resolve: ParamResolver;   
}

export interface PaginationOptions{
    defaultLimit?: number;
    maxLimit?: number;   
}

export interface Page{
    limit: number;
    offset: number;
}

export const bindingsByController = new ClassMetadata<ParamBinding>();

export const createParamDecorator = (resolve: ParamResolver): ParameterDecorator => {
    return (target, handlerName, index) => {
        if(handlerName === undefined) return;
        bindingsByController.append(target.constructor, { handlerName, index, resolve });
    };
};

export const getParamResolvers = (ctor: object, handlerName: string | symbol): ParamResolver[] => {
    const bindings = bindingsByController
        .get(ctor)
        .filter((binding) => binding.handlerName === handlerName);

    const resolvers: ParamResolver[] = [];
    for(const binding of bindings){
        resolvers[binding.index] = binding.resolve;
    }
    
    return resolvers;
};

export interface IdFormat{
    test(value: string): boolean;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

let ids: IdFormat | undefined;

export const configureIds = (format?: IdFormat) => {
    ids = format;
};

const matches = (format: IdFormat, value: string): boolean => {
    // A RegExp with the g or y flag remembers where its last match ended and would refuse every
    // other id.
    if(format instanceof RegExp) format.lastIndex = 0;
    return format.test(value);
};

export const parseId = (raw: unknown): string => {
    if(typeof raw !== 'string') throw RequestError.InvalidId();
    if(ids !== undefined){
        if(!matches(ids, raw)) throw RequestError.InvalidId();
        return raw;
    }

    const value = raw.toLowerCase();
    if(!UUID.test(value)) throw RequestError.InvalidId();
    return value;
};

export const parseOrdinal = (raw: unknown): number => {
    const value = Number(raw);
    if(!Number.isInteger(value) || value <= 0){
        throw RequestError.InvalidId();
    }
    return value;
};

const parseValue = (raw: unknown, defaultValue: number, minimum: number): number => {
    if(raw === undefined) return defaultValue;

    const value = Number(raw);
    if(!Number.isSafeInteger(value) || value < minimum){
        throw RequestError.InvalidPagination();
    }
    return value;
};

const offsetOf = (raw: Record<string, unknown>, limit: number): number => {
    if(raw.page === undefined) return parseValue(raw.offset, 0, 0);
    if(raw.offset !== undefined) throw RequestError.InvalidPagination();

    const offset = (parseValue(raw.page, 1, 1) - 1) * limit;
    if(!Number.isSafeInteger(offset)) throw RequestError.InvalidPagination();
    return offset;
};

export const parsePagination = (query: unknown, options?: PaginationOptions): Page => {
    const raw = (query ?? {}) as Record<string, unknown>;

    const limit = Math.min(
        parseValue(raw.limit, options?.defaultLimit ?? 50, 1),
        options?.maxLimit ?? 100
    );

    return {
        limit,
        offset: offsetOf(raw, limit)
    };
};

const messageFor = ({ expected, value }: IValidation.IError): string => {
    const length = typeof value === 'string' ? value.length : null;

    const min = expected.match(/MinLength<(\d+)>/);
    if(min && length !== null && length < Number(min[1])){
        return min[1] === '1' ? 'Required' : `At least ${min[1]} characters`;
    }

    const max = expected.match(/MaxLength<(\d+)>/);
    if(max && length !== null && length > Number(max[1])){
        return `At most ${max[1]} characters`;
    }

    if(expected.includes('Format<"email">')) return 'Invalid email';
    if(expected.includes('Pattern<')) return 'Invalid format';
    if(value === undefined) return 'Required';
    return `Expected ${expected}`;
};

const fieldKeyOf = (path: string): string =>
    path === '$input' ? 'body' : path.replace(/^\$input\./, '').split(/[.[]/)[0];

export const parseBody = <T>(validate: BodyValidator<T>, body: unknown): T => {
    const result = validate(body);
    if(result.success) return result.data;

    const errors: Record<string, string> = {};
    for(const error of result.errors){
        const key = fieldKeyOf(error.path);
        if(!(key in errors)) errors[key] = messageFor(error);
    }
    throw new ValidationError(errors);
};

// A route that takes its body as a stream hands it over unread; the validator the Vite plugin
// writes for a Readable parameter is never run against it.
export const Body = <T>(validate?: BodyValidator<T>): ParameterDecorator =>
    createParamDecorator((req) => streamedBodyOf(req) ?? (validate ? parseBody(validate, req.body) : req.body));

export const IdParam = (name: string): ParameterDecorator =>
    createParamDecorator((req) => parseId((req.params as Record<string, string>)[name]));

export const OrdinalParam = (name: string): ParameterDecorator =>
    createParamDecorator((req) => parseOrdinal((req.params as Record<string, string>)[name]));

export const Req = (): ParameterDecorator => createParamDecorator((req) => req);
export const Reply = (): ParameterDecorator => createParamDecorator((_req, reply) => reply);

export const Param = (name: string): ParameterDecorator =>
    createParamDecorator((req) => (req.params as Record<string, string>)[name]);

const firstOf = (value: string | string[] | undefined): string | undefined =>
    Array.isArray(value) ? value[0] : value;

export const Header = (name: string): ParameterDecorator =>
    createParamDecorator((req) => firstOf(req.headers[name.toLowerCase()]));

export const Ip = (): ParameterDecorator => createParamDecorator((req) => req.ip);

export const UserAgent = (): ParameterDecorator => createParamDecorator((req) => req.headers['user-agent']);

export const Query = (name?: string): ParameterDecorator =>
    createParamDecorator((req) => name === undefined ? req.query : (req.query as Record<string, string>)[name]);

export const IdQuery = (name: string): ParameterDecorator =>
    createParamDecorator((req) => parseId((req.query as Record<string, string>)[name]));

export const OptionalIdQuery = (name: string): ParameterDecorator =>
    createParamDecorator((req) => {
        const raw = (req.query as Record<string, string | undefined>)[name];
        return raw === undefined ? undefined : parseId(raw);
    });

export const Pagination = (options?: PaginationOptions): ParameterDecorator =>
    createParamDecorator((req) => parsePagination(req.query, options));

interface UploadBinding{
    handlerName: string | symbol;
    upload: UploadOptions;
}

const uploadsByController = new ClassMetadata<UploadBinding>();

const formParam = (
    target: object,
    handlerName: string | symbol | undefined,
    index: number,
    pick: (form: Form) => unknown
) => {
    if(handlerName === undefined) return;

    const uploads = () => uploadsByController
        .get(target.constructor)
        .filter((binding) => binding.handlerName === handlerName)
        .map((binding) => binding.upload);
    createParamDecorator(async (req) => pick(await formOf(req, uploads())))(target, handlerName, index);
};

export const UploadedFile = (options: UploadOptions = {}): ParameterDecorator => (target, handlerName, index) => {
    const upload = { ...options };
    if(handlerName !== undefined) uploadsByController.append(target.constructor, { handlerName, upload });

    formParam(target, handlerName, index, (form) => {
        const file = form.files.get(upload);
        if(file === undefined) throw RequestError.FileMissing();
        return file;
    });
};

export const FormFields = (): ParameterDecorator => (target, handlerName, index) => {
    formParam(target, handlerName, index, (form) => form.fields);
};
