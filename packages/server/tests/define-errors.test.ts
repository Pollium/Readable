import { RuntimeError, defineErrors } from '../lib/app/errors';
import { ErrorCode, defineErrors as defineTable } from '@pollium/readable-contracts/errors';
import { describe, expect, it } from 'vitest';

const ProjectErrors = defineTable({
    domain: 'Project',
    causes: {
        NotFound: 404
    }
});

const TestError = defineErrors({
    domain: 'Test',
    causes: {
        NotFound: 404,
        Broken: 500
    }
});

describe('defineErrors', () => {
    it('binds each cause to a RuntimeError factory with its status', () => {
        const error = TestError.NotFound();

        expect(error).toBeInstanceOf(RuntimeError);
        expect(error.message).toBe('Test::NotFound');
        expect(error.statusCode).toBe(404);
    });

    it('appends the optional detail as a runtime suffix', () => {
        expect(TestError.Broken('DISK').message).toBe('Test::Broken:DISK');
    });

    it('builds a fresh error per call', () => {
        expect(TestError.NotFound()).not.toBe(TestError.NotFound());
    });
});

describe('an error table from the contracts', () => {
    it('throws its own errors, so the server binds nothing', () => {
        const error = ProjectErrors.NotFound();

        expect(error).toBeInstanceOf(RuntimeError);
        expect(error.message).toBe('Project::NotFound');
        expect(error.statusCode).toBe(404);
    });

    it('still reads as the table the web keys its copy by', () => {
        const code: ErrorCode<typeof ProjectErrors> = 'Project::NotFound';

        expect(ProjectErrors).toMatchObject({ domain: 'Project', causes: { NotFound: 404 } });
        expect(code).toBe('Project::NotFound');
    });
});
