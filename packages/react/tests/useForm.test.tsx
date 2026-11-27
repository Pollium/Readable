import { configure } from '../lib/app/config';
import { copyFor } from '../lib/errors/copy';
import { ApiError } from '../lib/http/ApiError';
import { LocalFormOptions, SubmitCall, useForm, Validator } from '../lib/forms/useForm';
import { useQuery } from '../lib/query/useQuery';
import { fakeApi } from './support/fake-api';
import { CreateNoteInput, NoteErrors, noteRoutes } from './support/notes';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, expectTypeOf, it, vi } from 'vitest';

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

    it('tells the app a submit failed, with the values it sent', async () => {
        const api = fakeApi();
        api.on('POST', '/notebooks/nb1/notes', { status: 404, body: { error: 'Note::NotFound' } });
        const onFail = vi.fn();
        const { result } = creating({ onFail });

        act(() => result.current.field('title').onChange('Groceries'));
        act(() => result.current.handleSubmit());

        await waitFor(() => expect(onFail).toHaveBeenCalledOnce());
        expect(onFail.mock.calls[0][0]).toMatchObject({ status: 404, code: 'Note::NotFound' });
        expect(onFail.mock.calls[0][1]).toEqual({ title: 'Groceries' });
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

interface SignInInput{
    email: string;
    password: string;
}

const signInRules: Validator<SignInInput> = ({ email, password }) => {
    const errors = [
        ...email.includes('@') ? [] : [{ path: '$input.email', expected: 'string & Format<"email">', value: email }],
        ...password.length >= 8 ? [] : [{ path: '$input.password', expected: '(string & MinLength<8>)', value: password }]
    ];
    return errors.length === 0 ? { success: true } : { success: false, errors };
};

const signingIn = (options: Partial<LocalFormOptions<SignInInput, string>> = {}) =>
    renderHook(() => useForm<SignInInput, string>({
        initial: { email: '', password: '' },
        validate: signInRules,
        ...options
    }));

describe('a form with no endpoint', () => {
    it('submits through its own submit, and sends nothing itself', async () => {
        const api = fakeApi();
        const submit = vi.fn(async ({ email }: SignInInput) => `token-for-${email}`);
        const onDone = vi.fn();
        const { result } = signingIn({ submit, onDone });

        act(() => result.current.setValues({ email: 'ada@example.com', password: 'correct horse' }));
        act(() => result.current.handleSubmit());

        await waitFor(() => expect(onDone).toHaveBeenCalledWith('token-for-ada@example.com', { email: 'ada@example.com', password: 'correct horse' }));
        expect(submit).toHaveBeenCalledOnce();
        expect(api.sent).toHaveLength(0);
    });

    it('puts what its submit throws on the fields, or above the form', async () => {
        fakeApi();
        const refused = new ApiError(400, 'Request::ValidationFailed', { errors: { email: 'No account with this email' } });
        const onFields = signingIn({ submit: async () => { throw refused; } });
        act(() => onFields.result.current.setValues({ email: 'ada@example.com', password: 'correct horse' }));
        act(() => onFields.result.current.handleSubmit());
        await waitFor(() => expect(onFields.result.current.errors.email).toBe('No account with this email'));
        expect(onFields.result.current.submitError).toBeNull();

        const above = signingIn({ submit: async () => { throw new Error('The health probe timed out'); } });
        act(() => above.result.current.setValues({ email: 'ada@example.com', password: 'correct horse' }));
        act(() => above.result.current.handleSubmit());
        await waitFor(() => expect(above.result.current.submitError).toBe('The health probe timed out'));
    });

    it('takes its values\' type from initial, and its output\'s from submit', () => {
        const { result } = renderHook(() => useForm({
            initial: { name: '', description: '' },
            submit: async ({ name }) => ({ teamId: `team-${name}` })
        }));

        expectTypeOf(result.current.watch('name')).toEqualTypeOf<string>();
        expectTypeOf(result.current.handleSubmit).parameter(1).toEqualTypeOf<SubmitCall<{ name: string; description: string }, { teamId: string }> | undefined>();
    });

    it('checks its values and hands them on when it has no submit', async () => {
        const onDone = vi.fn();
        const { result } = signingIn({ onDone });

        act(() => result.current.handleSubmit());
        expect(result.current.errors).toEqual({ email: 'Invalid email', password: 'At least 8 characters' });

        act(() => result.current.setValues({ email: 'ada@example.com', password: 'correct horse' }));
        act(() => result.current.handleSubmit());
        await waitFor(() => expect(onDone).toHaveBeenCalledWith(undefined, { email: 'ada@example.com', password: 'correct horse' }));
    });
});

describe('a form checked a step at a time', () => {
    it('checks one field, says whether it passed, and leaves the others alone', () => {
        const { result } = signingIn();

        let passed = true;
        act(() => {
            passed = result.current.validateField('email');
        });

        expect(passed).toBe(false);
        expect(result.current.errors).toEqual({ email: 'Invalid email' });

        act(() => result.current.field('email').onChange('ada@example.com'));
        expect(result.current.errors).toEqual({});
        act(() => {
            passed = result.current.validateField('email');
        });
        expect(passed).toBe(true);
    });

    it('checks a step\'s fields, or every field with none named', () => {
        const { result } = signingIn();
        act(() => result.current.setValues({ email: 'ada@example.com' }));

        let passed = false;
        act(() => {
            passed = result.current.validateFields(['email']);
        });
        expect(passed).toBe(true);
        expect(result.current.errors).toEqual({});

        act(() => {
            passed = result.current.validateFields();
        });
        expect(passed).toBe(false);
        expect(result.current.errors).toEqual({ password: 'At least 8 characters' });
    });

    it('submits one step through its own action, checking only that step', async () => {
        fakeApi();
        const checkEmail = vi.fn(async ({ email }: SignInInput) => `exists:${email}`);
        const onDone = vi.fn();
        const { result } = signingIn({ submit: async () => 'signed in', onDone });

        act(() => result.current.setValues({ email: 'ada@example.com' }));
        act(() => result.current.handleSubmit(null, { fields: ['email'], submit: checkEmail }));

        await waitFor(() => expect(onDone).toHaveBeenCalledWith('exists:ada@example.com', { email: 'ada@example.com', password: '' }));
        expect(result.current.errors).toEqual({});
        expect(result.current.submitting).toBe(false);
    });
});

describe('a form', () => {
    it('watches one value, or all of them', () => {
        const { result } = signingIn();

        act(() => result.current.field('email').onChange('ada@'));

        expect(result.current.watch('email')).toBe('ada@');
        expect(result.current.watch()).toEqual({ email: 'ada@', password: '' });
    });

    it('resets to new values, and goes back to them after that', () => {
        const { result } = signingIn();

        act(() => result.current.reset({ email: 'ada@example.com', password: '' }));
        expect(result.current.values).toEqual({ email: 'ada@example.com', password: '' });

        act(() => result.current.setValues({ email: 'grace@example.com' }));
        act(() => result.current.reset());
        expect(result.current.values).toEqual({ email: 'ada@example.com', password: '' });
    });

    it('takes a field error from the app, and checks the field again on the next change', () => {
        const { result } = signingIn();

        act(() => result.current.setFieldError('email', 'Already invited'));
        expect(result.current.field('email')).toMatchObject({ isInvalid: true, errorMessage: 'Already invited' });

        act(() => result.current.field('email').onChange('grace@example.com'));
        expect(result.current.errors.email).toBeUndefined();

        act(() => result.current.setFieldError('password', 'Too common'));
        act(() => result.current.setFieldError('password', null));
        expect(result.current.errors).toEqual({});
    });

    it('submits through another action for one call, without sending to its endpoint', async () => {
        const api = fakeApi();
        api.on('GET', '/notebooks/nb1/notes', { body: { data: [] } });
        const list = renderHook(() => useQuery(noteRoutes.list, { path: { notebookId: 'nb1' } }));
        await waitFor(() => expect(list.result.current.data).toEqual([]));
        const draft = vi.fn(async (input: CreateNoteInput) => ({ id: 'draft', ...input }));
        const onDone = vi.fn();
        const { result } = creating({ onDone });

        act(() => result.current.field('title').onChange('Groceries'));
        act(() => result.current.handleSubmit(undefined, { submit: draft }));

        await waitFor(() => expect(onDone).toHaveBeenCalledWith({ id: 'draft', title: 'Groceries' }, { title: 'Groceries' }));
        expect(api.calls('POST', '/notebooks/nb1/notes')).toHaveLength(0);
        expect(api.calls('GET', '/notebooks/nb1/notes')).toHaveLength(1);
    });
});
