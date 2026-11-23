import { ServiceKeyRoute } from '../lib/http/ServiceKeyRoute';
import { FastifyReply, FastifyRequest } from 'fastify';
import { describe, expect, it } from 'vitest';

const guard = ServiceKeyRoute('x-iam-key', 'secret');
const reply = {} as FastifyReply;

const request = (headers: Record<string, string>): FastifyRequest =>
    ({ headers } as FastifyRequest);

describe('ServiceKeyRoute', () => {
    it('rejects a missing, empty or wrong key', () => {
        expect(() => guard(request({}), reply)).toThrowError('Auth::Unauthorized');
        expect(() => guard(request({ 'x-iam-key': '' }), reply)).toThrowError('Auth::Unauthorized');
        expect(() => guard(request({ 'x-iam-key': 'other' }), reply)).toThrowError('Auth::Unauthorized');
        expect(() => guard(request({ 'x-iam-key': 'secre' }), reply)).toThrowError('Auth::Unauthorized');
    });
});
