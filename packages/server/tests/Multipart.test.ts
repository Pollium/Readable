import BaseController, { Route } from '../lib/http/Controller';
import { FormFields, FormValues, UploadedFile } from '../lib/http/params';
import multipart from '@fastify/multipart';
import Fastify, { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';

type Upload = UploadedFile;

interface Part{
    name: string;
    value: string;
    filename?: string;
    type?: string;
}

const BOUNDARY = 'readable-test-boundary';

const formOf = (parts: Part[]) => ({
    headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
    payload: [
        ...parts.flatMap(({ name, value, filename, type }) => [
            `--${BOUNDARY}`,
            filename === undefined
                ? `Content-Disposition: form-data; name="${name}"`
                : `Content-Disposition: form-data; name="${name}"; filename="${filename}"`,
            ...(type === undefined ? [] : [`Content-Type: ${type}`]),
            '',
            value
        ]),
        `--${BOUNDARY}--`,
        ''
    ].join('\r\n')
});

const described = ({ filename, field, mimetype, buffer }: Upload) => ({ filename, field, mimetype, text: buffer.toString() });

class AccountController extends BaseController{
    @Route('/avatar', 'POST')
    avatar(
        @UploadedFile({ field: 'avatar', maxBytes: 8, accept: 'image/*' }) avatar: Upload,
        @FormFields() fields: FormValues
    ){
        return { avatar: described(avatar), fields };
    }

    @Route('/import', 'POST')
    import(@UploadedFile() file: Upload){
        return described(file);
    }

    @Route('/pair', 'POST')
    pair(@UploadedFile() any: Upload, @UploadedFile({ field: 'manifest', accept: ['application/json', 'text/plain'] }) manifest: Upload){
        return { any: described(any), manifest: described(manifest) };
    }

    @Route('/fields', 'POST')
    fields(@FormFields() fields: FormValues){
        return fields;
    }
}

const apps: FastifyInstance[] = [];

const mounted = async (fileSize = 1024, plugin = true) => {
    const app = Fastify();
    apps.push(app);
    if(plugin) await app.register(multipart, { limits: { fileSize } });
    await new AccountController().register(app, '');

    return app;
};

const post = async (url: string, parts: Part[], app?: FastifyInstance) =>
    (app ?? await mounted()).inject({ method: 'POST', url, ...formOf(parts) });

afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
});

describe('UploadedFile', () => {
    it('takes the first file of any field, as before', async () => {
        const res = await post('/import', [{ name: 'note', value: 'skip' }, { name: 'file', value: 'hello', filename: 'a.txt', type: 'text/plain' }]);

        expect(res.json()).toEqual({ data: { filename: 'a.txt', field: 'file', mimetype: 'text/plain', text: 'hello' } });
    });

    it('takes the file of its own field and hands the other fields over, before or after it', async () => {
        const res = await post('/avatar', [
            { name: 'firstName', value: 'Ada' },
            { name: 'other', value: 'ignored', filename: 'b.png', type: 'image/png' },
            { name: 'avatar', value: 'png!', filename: 'me.png', type: 'image/png' },
            { name: 'tag', value: 'a' },
            { name: 'tag', value: 'b' }
        ]);

        expect(res.json()).toEqual({
            data: {
                avatar: { filename: 'me.png', field: 'avatar', mimetype: 'image/png', text: 'png!' },
                fields: { firstName: 'Ada', tag: ['a', 'b'] }
            }
        });
    });

    it('gives a named field its own file and an unnamed one the first file left', async () => {
        const res = await post('/pair', [
            { name: 'manifest', value: '{}', filename: 'plugin.json', type: 'application/json' },
            { name: 'bundle', value: 'zip', filename: 'plugin.zip', type: 'application/zip' }
        ]);

        expect(res.json()).toMatchObject({ data: { any: { field: 'bundle' }, manifest: { field: 'manifest', text: '{}' } } });
    });

    it('answers a file over its maxBytes with 413, and over the plugin limit too', async () => {
        const overField = await post('/avatar', [{ name: 'avatar', value: 'way too big', filename: 'me.png', type: 'image/png' }]);
        const overPlugin = await post('/import', [{ name: 'file', value: 'x'.repeat(64), filename: 'a.txt' }], await mounted(16));

        expect(overField.statusCode).toBe(413);
        expect(overField.json()).toMatchObject({ message: 'Request::FileTooLarge' });
        expect(overPlugin.statusCode).toBe(413);
        expect(overPlugin.json()).toMatchObject({ message: 'Request::FileTooLarge' });
    });

    it('refuses a file of a type it does not accept as a field error', async () => {
        const res = await post('/avatar', [{ name: 'avatar', value: '%PDF', filename: 'me.pdf', type: 'application/pdf' }]);

        expect(res.statusCode).toBe(400);
        expect(res.json()).toMatchObject({ message: 'Request::ValidationFailed' });
    });

    it('answers Request::FileMissing when its file is not there, or the request is not multipart', async () => {
        const fieldsOnly = await post('/avatar', [{ name: 'firstName', value: 'Ada' }]);
        const wrongField = await post('/avatar', [{ name: 'photo', value: 'png', filename: 'me.png', type: 'image/png' }]);
        const json = await (await mounted()).inject({ method: 'POST', url: '/import', payload: { file: 'no' } });

        for(const res of [fieldsOnly, wrongField, json]){
            expect(res.statusCode).toBe(400);
            expect(res.json()).toMatchObject({ message: 'Request::FileMissing' });
        }
    });

    it('says which plugin is missing when the app did not register it', async () => {
        const app = await mounted(1024, false);
        const form = await post('/import', [{ name: 'file', value: 'a', filename: 'a.txt' }], app);
        const res = await app.inject({ method: 'POST', url: '/import', payload: { file: 'a' } });

        expect(form.statusCode).toBe(415);
        expect(res.statusCode).toBe(500);
        expect(res.json()).toMatchObject({ message: 'Config::MissingPlugin:@fastify/multipart' });
    });
});

describe('FormFields', () => {
    it('hands over the fields of a form with no file', async () => {
        const res = await post('/fields', [{ name: 'firstName', value: 'Ada' }, { name: 'lastName', value: 'Lovelace' }]);

        expect(res.json()).toEqual({ data: { firstName: 'Ada', lastName: 'Lovelace' } });
    });
});
