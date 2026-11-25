import { configure } from '../lib/app/config';
import { AppCopy, copyFor, describeError } from '../lib/errors/copy';
import { ApiError } from '../lib/http/ApiError';
import { NoteErrors } from './support/notes';
import { defineErrors } from '@pollium/readable-contracts/errors';
import { describe, expect, it } from 'vitest';

let language = 'en';

const appCopy: AppCopy = {
    offline: 'You are offline',
    unknown: () => language === 'en' ? 'Something went wrong' : 'Algo salió mal',
    codes: {
        'Auth::Unauthorized': 'Sign in again',
        'Auth::InvalidToken': 'Sign in again',
        'RateLimit::TooManyRequests': 'Slow down',
        'Request::InvalidId': 'That link is broken',
        'Request::InvalidPagination': 'That page does not exist',
        'Request::FileMissing': 'Choose a file',
        'Request::FileTooLarge': 'That file is too large',
        'Request::ValidationFailed': 'Check the fields',
        'Server::Internal': 'Something went wrong',
        'Project::NotFound': 'That project is gone'
    }
};

const noteCopy = copyFor(NoteErrors, {
    NotFound: 'That note is gone',
    Locked: () => language === 'en' ? 'Someone else is editing it' : 'Alguien más la está editando'
});

const error = (code: string, status = 400) => new ApiError(status, code, { error: code });

describe('copyFor', () => {
    it('tells a table\'s cause in its own words, whatever detail it carries', () => {
        configure({ name: 'notes', copy: appCopy });

        expect(noteCopy(error('Note::NotFound', 404))).toBe('That note is gone');
        expect(noteCopy(error('Note::Locked:n1', 409))).toBe('Someone else is editing it');
    });

    it('reads a lazy copy when it describes, so it follows the language', () => {
        configure({ name: 'notes', copy: appCopy });
        language = 'es';

        expect(noteCopy(error('Note::Locked', 409))).toBe('Alguien más la está editando');
        expect(noteCopy(error('Billing::Declined'))).toBe('Algo salió mal');
        language = 'en';
    });

    it('falls back to the app\'s copy for readable\'s codes and its shared ones', () => {
        configure({ name: 'notes', copy: appCopy });

        expect(noteCopy(error('RateLimit::TooManyRequests', 429))).toBe('Slow down');
        expect(noteCopy(error('Project::NotFound', 404))).toBe('That project is gone');
        expect(describeError(new Error('Billing::Declined'))).toBe('Something went wrong');
    });

    it('hands the unknown copy the code it could not name', () => {
        configure({ name: 'notes', copy: { ...appCopy, unknown: (code) => `Something went wrong (${code})` } });

        expect(noteCopy(error('Billing::Declined:card'))).toBe('Something went wrong (Billing::Declined)');
    });

    it('says the app is offline when the api cannot be reached', () => {
        configure({ name: 'notes', copy: appCopy });

        expect(noteCopy(new ApiError(0, 'Network::Unreachable'))).toBe('You are offline');
    });

    it('joins the copy of several tables', () => {
        configure({ name: 'notes', copy: appCopy });
        const TagErrors = defineErrors({ domain: 'Tag', causes: { Taken: 409 } });

        const pageCopy = noteCopy.with(copyFor(TagErrors, { Taken: 'That tag exists' }));

        expect(pageCopy(error('Tag::Taken', 409))).toBe('That tag exists');
        expect(pageCopy(error('Note::NotFound', 404))).toBe('That note is gone');
    });

    it('describes nothing when there is no error, and the code when the app has no copy', () => {
        expect(noteCopy(undefined)).toBeNull();
        expect(describeError(error('Billing::Declined'))).toBe('Billing::Declined');
    });

    it('asks for the copy of every cause', () => {
        const typed = () => {
            // @ts-expect-error Locked has no copy
            copyFor(NoteErrors, { NotFound: 'gone' });
            // @ts-expect-error Server::Internal has no copy
            const partial: AppCopy = { offline: '', unknown: '', codes: { ...appCopy.codes, 'Server::Internal': undefined } };
            return partial;
        };

        expect(typed).toBeTypeOf('function');
    });
});
