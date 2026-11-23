export interface OrgLookup{
    of(userId: string): Promise<string>;
    forget(userId: string): void;
    forgetAll(): void;
}

export const createOrgContext = (
    load: (userId: string) => Promise<string>,
    ttlMs: number
): OrgLookup => {
    const byUser = new Map<string, { orgId: string; expiresAt: number }>();

    return {
        forget: (userId) => {
            byUser.delete(userId);
        },
        forgetAll: () => {
            byUser.clear();
        },
        of: async (userId) => {
            const cached = byUser.get(userId);
            if(cached !== undefined && cached.expiresAt > Date.now()) return cached.orgId;

            const orgId = await load(userId);
            byUser.set(userId, { orgId, expiresAt: Date.now() + ttlMs });
            return orgId;
        }
    };
};
