import { AuthenticatedRoute } from './AuthenticatedRoute';
import { principalId } from './principalId';
import { MiddlewareFn } from '../http/middleware';
import { parseId } from '../http/params';

export type MembershipAssertion = (scopeId: string, userId: string) => Promise<unknown>;

export const ParamGuardRoute = (param: string, assert: MembershipAssertion): MiddlewareFn => async (req, reply) => {
    AuthenticatedRoute(req, reply);
    const scopeId = parseId((req.params as Record<string, string | undefined>)[param]);
    await assert(scopeId, principalId(req));
};
