import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['lib/**/*.{ts,tsx}', '!lib/**/*.d.ts'],
    platform: 'neutral',
    deps: {
        neverBundle: [/^node:/]
    },
    unbundle: true,
    fixedExtension: false,
    dts: true
});
