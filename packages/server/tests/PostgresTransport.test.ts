import { logger } from '../lib/app/logger';
import { PostgresTransport, PostgresTransportOptions } from '../lib/events/PostgresTransport';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TEST_DATABASE_URL } from './env';

const schema = 'readable_transport_test';
const big = 'x'.repeat(20_000);

let admin: Client;
let open: PostgresTransport[] = [];

const instance = (options: Partial<PostgresTransportOptions> = {}) => {
    const transport = new PostgresTransport({ url: TEST_DATABASE_URL, schema, channel: notifyChannel, ...options });
    open.push(transport);
    return transport;
};

const listening = async (transports: PostgresTransport[], channel: string) => {
    const heard = transports.map(() => [] as string[]);
    await Promise.all(transports.map((transport, at) => transport.subscribe(channel, (message) => heard[at].push(message))));
    return heard;
};

const spooledRows = async (): Promise<number> => {
    const { rows } = await admin.query<{ count: string }>(`SELECT COUNT(*) AS count FROM "${schema}"."readable_transport_spool"`);
    return Number(rows[0].count);
};

let notifyChannel: string;

beforeAll(async () => {
    admin = new Client({ connectionString: TEST_DATABASE_URL });
    await admin.connect();
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.query(`CREATE SCHEMA "${schema}"`);
});

afterEach(async () => {
    await Promise.all(open.map((transport) => transport.close()));
    open = [];
});

afterAll(async () => {
    await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await admin.end();
});

describe('PostgresTransport', () => {
    beforeAll(() => {
        notifyChannel = `readable_test_${randomUUID().slice(0, 8)}`;
    });

    it('delivers a message to every instance listening on its channel, the publisher included', async () => {
        const [publisher, other] = [instance(), instance()];
        const heard = await listening([publisher, other], 'notes');

        await publisher.publish('notes', 'hello');

        await vi.waitFor(() => expect(heard).toEqual([['hello'], ['hello']]));
    });

    it('hears only the channels it subscribed to', async () => {
        const [publisher, listener] = [instance(), instance()];
        const heard = await listening([listener], 'notes');

        await publisher.publish('other', 'not for you');
        await publisher.publish('notes', 'for you');

        await vi.waitFor(() => expect(heard).toEqual([['for you']]));
    });

    it('spools a message too big to notify, and every instance reads it, not only the first', async () => {
        const [publisher, first, second] = [instance(), instance(), instance()];
        const heard = await listening([first, second], 'notes');

        await publisher.publish('notes', big);

        await vi.waitFor(() => expect(heard).toEqual([[big], [big]]));
        await expect(spooledRows()).resolves.toBe(1);
    });

    it('keeps the order a spooled message and a small one were sent in', async () => {
        const [publisher, listener] = [instance(), instance()];
        const heard = await listening([listener], 'notes');

        await publisher.publish('notes', big);
        await publisher.publish('notes', 'after');

        await vi.waitFor(() => expect(heard).toEqual([[big, 'after']]));
    });

    it('sweeps spooled rows once they are older than retainMs, and keeps the newer ones', async () => {
        const publisher = instance({ retainMs: 60_000 });
        await publisher.publish('notes', big);
        await admin.query(`UPDATE "${schema}"."readable_transport_spool" SET created_at = now() - interval '2 minutes'`);
        await publisher.publish('notes', big);
        const before = await spooledRows();

        const swept = await publisher.sweep();

        expect(swept).toBe(before - 1);
        await expect(spooledRows()).resolves.toBe(1);
    });

    it('skips a spooled message that was swept before it was read, and says so', async () => {
        const warn = vi.spyOn(logger, 'warn').mockImplementation(() => undefined);
        const [publisher, listener] = [instance(), instance()];
        const heard = await listening([listener], 'notes');
        await publisher.publish('notes', 'warm');
        await vi.waitFor(() => expect(heard).toEqual([['warm']]));

        await admin.query(`CREATE OR REPLACE FUNCTION "${schema}".drop_spooled() RETURNS trigger AS $$ BEGIN DELETE FROM "${schema}"."readable_transport_spool" WHERE id = NEW.id; RETURN NULL; END $$ LANGUAGE plpgsql`);
        await admin.query(`CREATE TRIGGER drop_spooled AFTER INSERT ON "${schema}"."readable_transport_spool" FOR EACH ROW EXECUTE FUNCTION "${schema}".drop_spooled()`);
        await publisher.publish('notes', big);
        await publisher.publish('notes', 'next');

        await vi.waitFor(() => expect(heard).toEqual([['warm', 'next']]));
        expect(warn).toHaveBeenCalledWith('Transport::SpoolExpired', expect.objectContaining({ scope: 'transport' }));
        await admin.query(`DROP TRIGGER drop_spooled ON "${schema}"."readable_transport_spool"`);
        warn.mockRestore();
    });

    it('listens again when used after being closed', async () => {
        const transport = instance();
        await listening([transport], 'notes');
        await transport.close();

        const heard = await listening([transport], 'notes');
        await transport.publish('notes', 'again');

        await vi.waitFor(() => expect(heard).toEqual([['again']]));
    });

    it('opens its LISTEN connection again when the database drops it', async () => {
        const error = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
        const applicationName = `readable-transport-${randomUUID().slice(0, 8)}`;
        const [publisher, listener] = [instance(), instance({ applicationName })];
        const heard = await listening([listener], 'notes');

        await admin.query(`SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE application_name = $1`, [applicationName]);

        await vi.waitFor(async () => {
            await publisher.publish('notes', 'back');
            expect(heard[0]).toContain('back');
        }, { timeout: 5_000, interval: 250 });
        error.mockRestore();
    });
});
