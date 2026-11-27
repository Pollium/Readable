import { logger } from '../app/logger';
import { Transport, TransportListener, TransportListeners } from './Transport';
import type { Client, Pool } from 'pg';

export interface PostgresTransportOptions{
    url: string;
    schema?: string;
    // The NOTIFY channel every instance listens on; the transport's own channels travel inside it.
    channel?: string;
    spoolTable?: string;
    // A notification must stay under 8000 bytes; a frame above this goes through the spool.
    inlineBytes?: number;
    retainMs?: number;
    sweepEveryMs?: number;
    applicationName?: string;
}

interface Frame{
    kind: 'message' | 'spooled';
    channel: string;
    body: string;
}

const RECONNECT_MS = 1_000;
const MAX_RECONNECT_MS = 30_000;
const RACED_DDL = new Set(['23505', '42P07']);

const quote = (identifier: string): string => `"${identifier.replaceAll('"', '""')}"`;

// `m"<channel>"\n<message>` carries a message, `s"<channel>"\n<spool id>` points at one in the spool.
const frame = (kind: 'm' | 's', channel: string, body: string): string => `${kind}${JSON.stringify(channel)}\n${body}`;

const parse = (payload: string): Frame | null => {
    const newline = payload.indexOf('\n');
    if(newline < 0 || (payload[0] !== 'm' && payload[0] !== 's')) return null;

    try{
        return {
            kind: payload[0] === 'm' ? 'message' : 'spooled',
            channel: JSON.parse(payload.slice(1, newline)) as string,
            body: payload.slice(newline + 1)
        };
    }catch{
        return null;
    }
};

// LISTEN/NOTIFY on the app's own database. A message too big for a notification is written to a spool
// table and only its id is sent. Every instance reads the row, so none deletes it: rows are swept once
// they are older than retainMs.
export class PostgresTransport implements Transport{
    #listeners = new TransportListeners();
    #options: Required<Omit<PostgresTransportOptions, 'schema'>> & { schema?: string };
    #pool?: Promise<Pool>;
    #listening?: Promise<void>;
    #listener?: Client;
    #spool?: Promise<void>;
    #sweeper?: ReturnType<typeof setInterval>;
    #delivery: Promise<void> = Promise.resolve();
    #reconnectMs = RECONNECT_MS;
    #round = 0;

    constructor({
        channel = 'readable_transport',
        spoolTable = 'readable_transport_spool',
        inlineBytes = 7_000,
        retainMs = 5 * 60_000,
        sweepEveryMs = 60_000,
        applicationName = 'readable-transport',
        ...connection
    }: PostgresTransportOptions){
        this.#options = { channel, spoolTable, inlineBytes, retainMs, sweepEveryMs, applicationName, ...connection };
    }

    async publish(channel: string, message: string){
        const inline = frame('m', channel, message);
        if(Buffer.byteLength(inline) <= this.#options.inlineBytes){
            await this.#query('SELECT pg_notify($1, $2)', [this.#options.channel, inline]);
            return;
        }

        await this.#ensureSpool();
        await this.#query(`
            WITH spooled AS (INSERT INTO ${this.#table} (channel, message) VALUES ($1, $2) RETURNING id)
            SELECT pg_notify($3, 's' || $4::text || chr(10) || spooled.id) FROM spooled
        `, [channel, message, this.#options.channel, JSON.stringify(channel)]);
    }

    async subscribe(channel: string, onMessage: TransportListener){
        this.#listeners.add(channel, onMessage);
        await this.#listen();
    }

    // Deletes the spooled messages older than retainMs, whoever wrote them, and says how many.
    async sweep(): Promise<number>{
        await this.#ensureSpool();
        const result = await this.#query(
            `DELETE FROM ${this.#table} WHERE created_at < now() - $1 * interval '1 millisecond'`,
            [this.#options.retainMs]
        );

        return result.rowCount ?? 0;
    }

    async close(){
        this.#round += 1;
        clearInterval(this.#sweeper);
        this.#listeners.clear();
        const listener = this.#listener;
        const pool = this.#pool;
        this.#listener = undefined;
        this.#listening = undefined;
        this.#pool = undefined;
        this.#spool = undefined;
        this.#sweeper = undefined;

        await this.#delivery;
        await listener?.end().catch(() => undefined);
        await pool?.then((open) => open.end()).catch(() => undefined);
    }

    get #table(): string{
        const { schema, spoolTable } = this.#options;
        return schema === undefined ? quote(spoolTable) : `${quote(schema)}.${quote(spoolTable)}`;
    }

    async #query(sql: string, params: unknown[]){
        this.#pool ??= this.#openPool();
        return (await this.#pool).query(sql, params);
    }

    // pg is loaded on first use, so an app on SQLite or Redis never loads it for its transport.
    async #openPool(): Promise<Pool>{
        const { Pool } = await import('pg');
        const pool = new Pool({ connectionString: this.#options.url, application_name: this.#options.applicationName, max: 2 });
        pool.on('error', (error) => logger.error('Transport::PostgresPoolFailed', error));
        return pool;
    }

    #ensureSpool(): Promise<void>{
        this.#spool ??= this.#createSpool().catch((error: unknown) => {
            this.#spool = undefined;
            throw error;
        });
        return this.#spool;
    }

    async #createSpool(){
        try{
            await this.#query(`CREATE TABLE IF NOT EXISTS ${this.#table} (
                id bigserial PRIMARY KEY,
                channel text NOT NULL,
                message text NOT NULL,
                created_at timestamptz NOT NULL DEFAULT now()
            )`, []);
            await this.#query(`CREATE INDEX IF NOT EXISTS ${quote(`${this.#options.spoolTable}_created_at`)} ON ${this.#table} (created_at)`, []);
        }catch(error){
            // Two instances creating the table at once: the one that lost finds it made.
            if(!RACED_DDL.has(String((error as { code?: string }).code))) throw error;
        }

        this.#sweeper ??= setInterval(() => {
            this.sweep().catch((error: unknown) => logger.error('Transport::SweepFailed', error));
        }, this.#options.sweepEveryMs);
        this.#sweeper.unref?.();
    }

    #listen(): Promise<void>{
        this.#listening ??= this.#openListener();
        return this.#listening;
    }

    async #openListener(){
        const round = this.#round;
        const { Client } = await import('pg');
        const client = new Client({ connectionString: this.#options.url, application_name: this.#options.applicationName });
        client.on('notification', ({ channel, payload }) => {
            if(channel === this.#options.channel && payload) this.#receive(payload);
        });
        client.on('error', (error) => {
            logger.error('Transport::PostgresListenerFailed', error);
            this.#lost(client);
        });
        client.on('end', () => this.#lost(client));

        try{
            await client.connect();
            await client.query(`LISTEN ${quote(this.#options.channel)}`);
        }catch(error){
            this.#listening = undefined;
            this.#retry(round);
            await client.end().catch(() => undefined);
            throw error;
        }

        if(round !== this.#round){
            await client.end().catch(() => undefined);
            return;
        }

        this.#listener = client;
        this.#reconnectMs = RECONNECT_MS;
    }

    // A dropped LISTEN connection hears nothing and says nothing, so it is opened again, with a growing
    // pause between attempts.
    #lost(client: Client){
        if(this.#listener !== client) return;

        this.#listener = undefined;
        this.#listening = undefined;
        client.end().catch(() => undefined);
        this.#retry(this.#round);
    }

    #retry(round: number){
        const delay = this.#reconnectMs;
        this.#reconnectMs = Math.min(delay * 2, MAX_RECONNECT_MS);

        setTimeout(() => {
            if(round !== this.#round) return;
            this.#listen().catch(() => undefined);
        }, delay).unref?.();
    }

    // Deliveries wait for each other, so a spooled message is not overtaken by a small one sent after it.
    #receive(payload: string){
        const parsed = parse(payload);
        if(parsed === null || !this.#listeners.has(parsed.channel)) return;

        this.#delivery = this.#delivery
            .then(async () => {
                const message = parsed.kind === 'message' ? parsed.body : await this.#spooled(parsed.body);
                if(message !== null) this.#listeners.deliver(parsed.channel, message);
            })
            .catch((error: unknown) => logger.error('Transport::ReceiveFailed', error));
    }

    async #spooled(id: string): Promise<string | null>{
        const { rows } = await this.#query(`SELECT message FROM ${this.#table} WHERE id = $1`, [id]);
        if(rows.length > 0) return (rows[0] as { message: string }).message;

        logger.warn('Transport::SpoolExpired', { scope: 'transport', id });
        return null;
    }
}
