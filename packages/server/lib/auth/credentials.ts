import { randomBytes, scrypt as scryptCallback, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';

export class PasswordService{
    #scrypt = promisify(scryptCallback);
    #keyLength = 64;

    async hash(password: string): Promise<string>{
        const salt = randomBytes(16).toString('hex');
        const derived = (await this.#scrypt(password, salt, this.#keyLength)) as Buffer;
        return `${salt}:${derived.toString('hex')}`;
    }

    async verify(password: string, stored: string): Promise<boolean>{
        const [salt, hash] = stored.split(':');
        if(!salt || !hash) return false;

        const derived = (await this.#scrypt(password, salt, this.#keyLength)) as Buffer;
        const expected = Buffer.from(hash, 'hex');
        return derived.length === expected.length && timingSafeEqual(derived, expected);
    }
}

export const answersChallenge = (challenge: string, verifier: string): boolean => {
    const expected = Buffer.from(challenge);
    const actual = Buffer.from(createHash('sha256').update(verifier).digest('base64url'));

    return expected.length === actual.length && timingSafeEqual(expected, actual);
};
