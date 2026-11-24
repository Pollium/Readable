import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['lib/**/*.{ts,tsx}', '!lib/**/*.d.ts'],
    platform: 'neutral',
    unbundle: true,
    fixedExtension: false,
    dts: true
});
