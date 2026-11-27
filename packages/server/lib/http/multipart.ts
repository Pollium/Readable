import { ConfigError, RequestError, ValidationError } from '../app/errors';
import type { UploadedFile } from './params';
import { FastifyRequest } from 'fastify';
import { Readable } from 'node:stream';

export interface UploadOptions{
    field?: string;
    maxBytes?: number;
    accept?: string | string[];
}

export type FormValues = Record<string, unknown>;

export interface Form{
    files: Map<UploadOptions, UploadedFile>;
    fields: FormValues;
}

interface FilePart{
    type: 'file';
    fieldname: string;
    filename: string;
    mimetype: string;
    file: Readable & { truncated?: boolean };
}

interface FieldPart{
    type: 'field';
    fieldname: string;
    value: unknown;
}

interface MultipartRequest{
    isMultipart?: () => boolean;
    parts?: () => AsyncIterable<FilePart | FieldPart>;
}

const forms = new WeakMap<FastifyRequest, Promise<Form>>();

const accepts = (accept: string | string[] | undefined, mimetype: string): boolean => {
    if(accept === undefined) return true;

    const type = mimetype.toLowerCase();
    return [accept].flat().some((pattern) => {
        const wanted = pattern.toLowerCase();
        return wanted.endsWith('/*') ? type.startsWith(wanted.slice(0, -1)) : type === wanted;
    });
};

const addField = (fields: FormValues, name: string, value: unknown) => {
    if(!Object.hasOwn(fields, name)){
        fields[name] = value;
        return;
    }

    const present = fields[name];
    fields[name] = Array.isArray(present) ? [...present, value] : [present, value];
};

// Leaving the loop early destroys the file stream, so a file past maxBytes is never read whole.
// A file the plugin's own fileSize cut short arrives truncated when throwFileSizeLimit is off.
const bufferOf = async (part: FilePart, maxBytes = Infinity): Promise<Buffer> => {
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of part.file){
        size += (chunk as Buffer).length;
        if(size > maxBytes) throw RequestError.FileTooLarge();
        chunks.push(chunk as Buffer);
    }
    if(part.file.truncated === true) throw RequestError.FileTooLarge();

    return Buffer.concat(chunks);
};

const drain = async (stream: Readable) => {
    for await (const _chunk of stream){
        // read to the end, so the next part arrives
    }
};

// A named upload takes its own field first; one with no field takes the first file left over.
const claim = (waiting: UploadOptions[], fieldname: string): UploadOptions | undefined =>
    waiting.find((upload) => upload.field === fieldname) ?? waiting.find((upload) => upload.field === undefined);

const read = async (req: FastifyRequest & MultipartRequest, uploads: UploadOptions[]): Promise<Form> => {
    if(typeof req.parts !== 'function') throw ConfigError.MissingPlugin('@fastify/multipart');

    const form: Form = { files: new Map(), fields: {} };
    if(req.isMultipart?.() !== true) return form;

    const waiting = [...uploads];
    for await (const part of req.parts()){
        if(part.type === 'field'){
            addField(form.fields, part.fieldname, part.value);
            continue;
        }

        const upload = claim(waiting, part.fieldname);
        if(upload === undefined){
            await drain(part.file);
            continue;
        }
        if(!accepts(upload.accept, part.mimetype)){
            throw new ValidationError({ [part.fieldname]: `Expected ${[upload.accept ?? []].flat().join(' or ')}` });
        }

        waiting.splice(waiting.indexOf(upload), 1);
        form.files.set(upload, {
            filename: part.filename,
            field: part.fieldname,
            mimetype: part.mimetype,
            buffer: await bufferOf(part, upload.maxBytes)
        });
    }

    return form;
};

const tooLarge = (error: unknown): boolean =>
    error instanceof Error && (error as { code?: string }).code === 'FST_REQ_FILE_TOO_LARGE';

// Every upload and form-field parameter of a handler reads the same request, so the parts are read
// once, for all the uploads the handler declares.
export const formOf = (req: FastifyRequest, uploads: UploadOptions[]): Promise<Form> => {
    let form = forms.get(req);
    if(form === undefined){
        form = read(req as FastifyRequest & MultipartRequest, uploads).catch((error: unknown) => {
            throw tooLarge(error) ? RequestError.FileTooLarge() : error;
        });
        forms.set(req, form);
    }

    return form;
};
