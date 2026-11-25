import { autoValidateForm } from './lib/forms/auto-validate-form';
import typia from '@typia/unplugin/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
    plugins: [
        autoValidateForm(),
        typia({ tsconfig: './tsconfig.json', cache: true })
    ],
    test: {
        environment: 'happy-dom',
        execArgv: ['--no-experimental-webstorage'],
        include: ['tests/**/*.test.{ts,tsx}'],
        setupFiles: ['./tests/setup.ts'],
        restoreMocks: true,
        unstubGlobals: true
    }
});
