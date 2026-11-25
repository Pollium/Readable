import { autoValidateForm } from '../lib/forms/auto-validate-form';
import { useForm } from '../lib/forms/useForm';
import { fakeApi } from './support/fake-api';
import { noteRoutes } from './support/notes';
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

const renaming = () => renderHook(() => useForm(noteRoutes.rename, {
    initial: { title: '' },
    path: { notebookId: 'nb1', noteId: 'n1' }
}));

describe('a form with no validator written', () => {
    it('is checked against its endpoint\'s input type', () => {
        const api = fakeApi();
        const { result } = renaming();

        act(() => result.current.field('title').onChange('ab'));
        act(() => result.current.handleSubmit());
        expect(result.current.errors.title).toBe('At least 3 characters');

        act(() => result.current.field('title').onChange('a'.repeat(21)));
        expect(result.current.errors.title).toBe('At most 20 characters');
        expect(api.sent).toHaveLength(0);
    });

    it('sends what its input type takes', async () => {
        const api = fakeApi();
        api.on('PATCH', '/notebooks/nb1/notes/n1/title', { body: { data: { id: 'n1', title: 'Groceries' } } });
        const { result } = renaming();

        act(() => result.current.field('title').onChange('Groceries'));
        act(() => result.current.handleSubmit());

        await waitFor(() => expect(api.calls('PATCH', '/notebooks/nb1/notes/n1/title')).toHaveLength(1));
    });
});

describe('autoValidateForm', () => {
    const transform = (code: string, id = '/app/src/modules/notes/components/RenameForm.tsx') =>
        autoValidateForm().transform(code, id)?.code ?? null;

    const form = ['use', 'Form(noteRoutes.rename, { initial });'].join('');

    it('hands every useForm the validator of its endpoint\'s input', () => {
        const out = transform(form);

        expect(out).toContain('validate: typia.createValidate<ReadableFormInput<typeof noteRoutes.rename>>(), initial });');
        expect(out).toMatch(/^import typia from 'typia';$/m);
        expect(out).toMatch(/^import type \{ InputOf as ReadableFormInput \} from '@pollium\/readable-contracts\/routing';$/m);
    });

    it('imports typia once', () => {
        const out = transform([`import typia from 'typia';`, form].join('\n')) ?? '';

        expect(out.match(/^import typia/gm)).toHaveLength(1);
    });

    it('leaves files without a form, and dependencies, as they are', () => {
        expect(transform('const query = useQuery(noteRoutes.list);')).toBeNull();
        expect(transform(form, '/app/node_modules/lib/index.ts')).toBeNull();
        expect(transform(form, '/app/src/styles.css')).toBeNull();
    });
});
