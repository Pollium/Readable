import manifest from '../package.json' with { type: 'json' };
import base from '../tsconfig.app.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';

describe('the published package', () => {
    it('leaves fastify, pg and typeorm to the app, so both load one copy of each', () => {
        for(const shared of ['fastify', 'pg', 'typeorm']){
            expect(manifest.dependencies).not.toHaveProperty(shared);
            expect(manifest.peerDependencies).toHaveProperty(shared);
        }
    });

    it('ships a tsconfig an app extends in one line, with paths into its own folder', () => {
        expect(manifest.files).toContain('tsconfig.app.json');
        expect(manifest.exports['./tsconfig.json']).toBe('./tsconfig.app.json');
        expect(manifest.publishConfig.exports['./tsconfig.json']).toBe('./tsconfig.app.json');
        expect(base.compilerOptions.paths['@/*']).toEqual(['${configDir}/src/*']);
    });

    it('ships the agent guide beside the code it describes', () => {
        expect(manifest.files).toContain('AGENTS.md');
    });
});
