import QueueProducer from '../lib/queues/QueueProducer';
import { configure } from '../lib/app/config';
import { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { afterAll, describe, expect, it } from 'vitest';

configure({ name: 'readable', jwtSecret: null, redis: { host: 'localhost', port: 6379 }, storage: null });

const name = `producer-test-${randomUUID()}`;
const producer = new QueueProducer<{ batch: number }>(name, { attempts: 3 });
const queue = new Queue(name, { connection: { host: 'localhost', port: 6379 } });

afterAll(async () => {
    await producer.close();
    await queue.obliterate({ force: true });
    await queue.close();
});

describe('QueueProducer', () => {
    it('puts a job on its queue with its own options and the call options together', async () => {
        await producer.add({ batch: 7 }, { priority: 2 });

        const [job] = await queue.getJobs(['waiting', 'prioritized']);

        expect(job.data).toEqual({ batch: 7 });
        expect(job.opts).toMatchObject({ attempts: 3, priority: 2 });
    });
});
