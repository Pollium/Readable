import { configure } from '../lib/app/config';
import { copyFor } from '../lib/errors/copy';
import { useForm, Validator } from '../lib/forms/useForm';
import { useQuery } from '../lib/query/useQuery';
import { fakeApi } from './support/fake-api';
import { CreateNoteInput, NoteErrors, noteRoutes } from './support/notes';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const validate: Validator<CreateNoteInput> = (input) => input.title.length >= 3 && input.title.length <= 20
    ? { success: true }
    : {
        success: false,
        errors: [{
            path: '$input.title',
            expected: input.title.length < 3 ? '(string & MinLength<3>)' : '(string & MaxLength<20>)',
            value: input.title
        }]
    };

const noteCopy = copyFor(NoteErrors, { NotFound: 'That notebook is gone', Locked: 'Someone else is editing it' });

const creating = (options: Partial<Parameters<typeof useForm<CreateNoteInput, unknown>>[1]> = {}) =>
    renderHook(() => useForm(noteRoutes.create, {
        initial: { title: '' },
        path: { notebookId: 'nb1' },
        validate,
        copy: noteCopy,
        ...options
    }));

describe('useForm', () => {
    it('submits the values to its endpoint and hands back what it answered', async () => {
        const api = fakeApi();
        api.on('POST', '/notebooks/nb1/notes', ({ body }) => ({ status: 201, body: { data: { id: 'n1', ...body as object } } }));
        const onDone = vi.fn();
        const { result } = creating({ onDone });

        act(() => result.current.field('title').onChange('Groceries'));
        act(() => result.current.handleSubmit());

        await waitFor(() => expect(onDone).toHaveBeenCalledWith({ id: 'n1', title: 'Groceries' }, { title: 'Groceries' }));
        expect(result.current.submitting).toBe(false);
    });

    it('stops a value its input type refuses, before sending it', () => {
        const api = fakeApi();
        const { result } = creating();

        act(() => result.current.field('title').onChange('ab'));
        act(() => result.current.handleSubmit());

        expect(result.current.errors.title).toBe('At least 3 characters');
        expect(result.current.isValid).toBe(false);
        expect(api.sent).toHaveLength(0);
    });

    it('checks a field when it is left, and again on each change after that', () => {
        fakeApi();
        const { result } = creating();

        act(() => result.current.field('title').onChange('a'));
        expect(result.current.errors.title).toBeUndefined();

        act(() => result.current.field('title').onBlur());
        expect(result.current.field('title')).toMatchObject({ isInvalid: true, errorMessage: 'At least 3 characters' });

        act(() => result.current.field('title').onChange('abc'));
        expect(result.current.errors.title).toBeUndefined();
    });

    it('says what the app\'s copy says for a field', () => {
        fakeApi();
        configure({ name: 'notes', copy: { offline: '', unknown: '', codes: {} as never, fields: { tooLong: (max) => `Máximo ${max} caracteres` } } });
        const { result } = creating();

        act(() => result.current.field('title').onChange('a'.repeat(21)));
        act(() => result.current.handleSubmit());

        expect(result.current.errors.title).toBe('Máximo 20 caracteres');
    });

    it('puts the field errors the server answered on their fields', async () => {
        const api = fakeApi();
        api.on('POST', '/notebooks/nb1/notes', { status: 400, body: { error: 'Request::ValidationFailed', errors: { title: 'Taken in this notebook' } } });
        const { result } = creating();

        act(() => result.current.field('title').onChange('Groceries'));
        act(() => result.current.handleSubmit());

        await waitFor(() => expect(result.current.errors.title).toBe('Taken in this notebook'));
        expect(result.current.submitError).toBeNull();
    });

    it('puts an error code on the field it names, or above the form', async () => {
        const api = fakeApi();
        api.on('POST', '/notebooks/nb1/notes', { status: 409, body: { error: 'Note::Locked' } });
        const onField = creating({ fieldOf: { 'Note::Locked': 'title' } });
        act(() => onField.result.current.field('title').onChange('Groceries'));
        act(() => onField.result.current.handleSubmit());
        await waitFor(() => expect(onField.result.current.errors.title).toBe('Someone else is editing it'));

        api.on('POST', '/notebooks/nb1/notes', { status: 404, body: { error: 'Note::NotFound' } });
        const above = creating();
        act(() => above.result.current.field('title').onChange('Groceries'));
        act(() => above.result.current.handleSubmit());
        await waitFor(() => expect(above.result.current.submitError).toBe('That notebook is gone'));
    });

    it('refreshes the list it added to', async () => {
        const api = fakeApi();
        api.on('GET', '/notebooks/nb1/notes', { body: { data: [] } });
        api.on('POST', '/notebooks/nb1/notes', { status: 201, body: { data: { id: 'n1', title: 'Groceries' } } });
        const list = renderHook(() => useQuery(noteRoutes.list, { path: { notebookId: 'nb1' } }));
        await waitFor(() => expect(list.result.current.data).toEqual([]));
        const { result } = creating();

        act(() => result.current.field('title').onChange('Groceries'));
        act(() => result.current.handleSubmit());

        await waitFor(() => expect(api.calls('GET', '/notebooks/nb1/notes')).toHaveLength(2));
    });

    it('sends once, however many times it is submitted while sending', async () => {
        const api = fakeApi();
        api.on('POST', '/notebooks/nb1/notes', { status: 201, body: { data: { id: 'n1', title: 'Groceries' } } });
        const { result } = creating();

        act(() => result.current.field('title').onChange('Groceries'));
        act(() => {
            result.current.handleSubmit();
            result.current.handleSubmit();
        });

        await waitFor(() => expect(result.current.submitting).toBe(false));
        expect(api.calls('POST', '/notebooks/nb1/notes')).toHaveLength(1);
    });

    it('goes back to where it started', () => {
        fakeApi();
        const { result } = creating();
        act(() => result.current.setValues({ title: 'a' }));
        act(() => result.current.handleSubmit());

        act(() => result.current.reset());

        expect(result.current).toMatchObject({ values: { title: '' }, errors: {}, submitError: null });
    });
});
