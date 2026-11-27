import { configure } from '../lib/app/config';
import { objectStorage } from '../lib/storage/ObjectStorage';
import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { TEST_REDIS } from './env';

const dispositionOf = async (contentType: string): Promise<string | undefined> => {
    const sent = vi.spyOn(S3Client.prototype, 'send').mockImplementation(() => Promise.resolve({}));

    await objectStorage.put('probe/object', 'body', contentType);

    const put = sent.mock.calls.map(([command]) => command).filter((command) => command instanceof PutObjectCommand).at(-1);
    return put instanceof PutObjectCommand ? put.input.ContentDisposition : undefined;
};

describe('objectStorage', () => {
    beforeAll(() => {
        configure({
            name: 'readable',
            jwtSecret: 'test-jwt-secret',
            redis: TEST_REDIS,
            storage: { endpoint: 'http://storage.test', region: 'us-east-1', accessKey: 'a', secretKey: 's', bucket: 'b', publicUrl: 'http://storage.test/b' }
        });
    });

    it.each(['text/html', 'application/xhtml+xml', 'image/svg+xml', 'text/xml; charset=utf-8'])('serves %s as a download, so it never runs on the storage origin', async (contentType) => {
        expect(await dispositionOf(contentType)).toBe('attachment');
    });

    it('leaves a picture or a document to open inline', async () => {
        expect(await dispositionOf('image/png')).toBeUndefined();
        expect(await dispositionOf('application/pdf')).toBeUndefined();
    });
});
