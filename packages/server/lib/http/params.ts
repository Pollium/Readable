import ClassMetadata from '../utils/ClassMetadata';
import { RequestError, ValidationError } from '../errors';
import { UploadedFile as UploadedFilePayload } from '../contracts/upload';
import { IValidation } from 'typia';
import { FastifyReply, FastifyRequest } from 'fastify';

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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const parseId = (raw: unknown): string => {
    if(typeof raw !== 'string') throw RequestError.InvalidId();

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

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

const parseValue = (raw: unknown, defaultValue: number, minimum: number): number => {
    if(raw === undefined) return defaultValue;

    const value = Number(raw);
    if(!Number.isSafeInteger(value) || value < minimum){
        throw RequestError.InvalidPagination();
    }
    return value;
};

export const parsePagination = (query: unknown, options?: PaginationOptions): Page => {
    const raw = (query ?? {}) as Record<string, unknown>;

    const limit = Math.min(
        parseValue(raw.limit, options?.defaultLimit ?? DEFAULT_LIMIT, 1),
        options?.maxLimit ?? MAX_LIMIT
    );
    const offset = parseValue(raw.offset, 0, 0);

    return {
        limit,
        offset
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

export const Body = <T>(validate?: BodyValidator<T>): ParameterDecorator =>
    createParamDecorator((req) => validate ? parseBody(validate, req.body) : req.body);

export const IdParam = (name: string): ParameterDecorator =>
    createParamDecorator((req) => parseId((req.params as Record<string, string>)[name]));

export const OrdinalParam = (name: string): ParameterDecorator =>
    createParamDecorator((req) => parseOrdinal((req.params as Record<string, string>)[name]));

export const Param = (name: string): ParameterDecorator =>
    createParamDecorator((req) => (req.params as Record<string, string>)[name]);

export const Query = (name: string): ParameterDecorator =>
    createParamDecorator((req) => (req.query as Record<string, string>)[name]);

export const IdQuery = (name: string): ParameterDecorator =>
    createParamDecorator((req) => parseId((req.query as Record<string, string>)[name]));

export const OptionalIdQuery = (name: string): ParameterDecorator =>
    createParamDecorator((req) => {
        const raw = (req.query as Record<string, string | undefined>)[name];
        return raw === undefined ? undefined : parseId(raw);
    });

export const Pagination = (options?: PaginationOptions): ParameterDecorator =>
    createParamDecorator((req) => parsePagination(req.query, options));

interface MultipartRequest{
    file: () => Promise<{ filename: string; toBuffer: () => Promise<Buffer> } | undefined>;
}

export const UploadedFile = (): ParameterDecorator =>
    createParamDecorator(async (req): Promise<UploadedFilePayload> => {
        const part = await (req as typeof req & MultipartRequest).file();
        if(!part) throw RequestError.FileMissing();

        try{
            const buffer = await part.toBuffer();
            return {
                filename: part.filename,
                buffer
            };
        }catch(error){
            if(error instanceof Error && (error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE'){
                throw RequestError.FileTooLarge();
            }
            throw error;
        }
    });
