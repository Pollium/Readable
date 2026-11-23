import { createHash, timingSafeEqual } from 'node:crypto';

export const answersChallenge = (challenge: string, verifier: string): boolean => {
    const expected = Buffer.from(challenge);
    const actual = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));

    return expected.length === actual.length && timingSafeEqual(expected, actual);
};
