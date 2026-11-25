import { autoValidateBody } from '../lib/http/auto-validate-body';
import { describe, expect, it } from 'vitest';

const controller = '/app/src/modules/notes/controllers/Note.ts';

const transformed = (code: string): string => autoValidateBody().transform(code, controller)?.code ?? '';

const body = ['@Bo', 'dy() input: CreateNoteInput'].join('');

describe('autoValidateBody', () => {
    it('validates a body against its type', () => {
        expect(transformed(`create(${body}){}`)).toContain('typia.misc.createValidatePrune<CreateNoteInput>()');
    });

    it('imports typia even when the controller already imports something else from it', () => {
        const out = transformed([`import { tags } from 'typia';`, `create(${body}){}`].join('\n'));

        expect(out).toMatch(/^import typia from 'typia';$/m);
    });

    it('imports typia once', () => {
        const out = transformed([`import typia from 'typia';`, `create(${body}){}`].join('\n'));

        expect(out.match(/^import typia/gm)).toHaveLength(1);
    });
});
