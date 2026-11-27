// Where the tests find Postgres and Redis. CI serves both on their default ports; a machine running
// several checkouts at once points each at its own with READABLE_TEST_DATABASE_URL and
// READABLE_TEST_REDIS_PORT.
export const TEST_DATABASE_URL = process.env.READABLE_TEST_DATABASE_URL ?? 'postgres://pollium:pollium@localhost:5432/pollium';

export const TEST_REDIS = {
    host: process.env.READABLE_TEST_REDIS_HOST ?? 'localhost',
    port: Number(process.env.READABLE_TEST_REDIS_PORT ?? 6379)
};
