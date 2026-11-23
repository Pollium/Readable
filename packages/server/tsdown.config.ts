import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['lib/**/*.ts', '!lib/**/*.d.ts'],
    platform: 'node',
    unbundle: true,
    fixedExtension: false,
    dts: true
});
