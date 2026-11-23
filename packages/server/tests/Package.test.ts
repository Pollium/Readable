import manifest from '../package.json' with { type: 'json' };
import { describe, expect, it } from 'vitest';

describe('the published package', () => {
    it('leaves fastify, pg and typeorm to the app, so both load one copy of each', () => {
        for(const shared of ['fastify', 'pg', 'typeorm']){
            expect(manifest.dependencies).not.toHaveProperty(shared);
            expect(manifest.peerDependencies).toHaveProperty(shared);
        }
    });
});
