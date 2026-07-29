import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DUE_DELIVERY_SCANNER_JOB_KIND,
  DUE_DELIVERY_SCANNER_SCHEDULE_ID,
  DueDeliveryScannerRunner,
  createDueDeliveryScannerJobHandler,
  registerDueDeliveryScannerSchedule,
} from './scanner-job.js';

test('scanner schedule is a durable system recurring job', async () => {
  const scheduled: unknown[] = [];
  await registerDueDeliveryScannerSchedule({
    async scheduleRecurring(input) {
      scheduled.push(input);
    },
  });

  assert.deepEqual(scheduled, [
    {
      cron: '* * * * *',
      kind: DUE_DELIVERY_SCANNER_JOB_KIND,
      payload: {},
      scheduleId: DUE_DELIVERY_SCANNER_SCHEDULE_ID,
      timezone: 'Asia/Shanghai',
      workspaceId: '__system__',
    },
  ]);
});

test('scanner runner combines due delivery and bounded terminal purge', async () => {
  const calls: unknown[] = [];
  const runner = new DueDeliveryScannerRunner(
    {
      async runOnce(workerId) {
        calls.push(['runOnce', workerId]);
        return {
          claimed: 2,
          deadLettered: 1,
          delivered: 0,
          lost: 0,
          retried: 1,
          suppressed: 0,
        };
      },
    },
    {
      async purgeExpired(now, limit) {
        calls.push(['purgeExpired', now.toISOString(), limit]);
        return { deletedItems: 3, deletedRuns: 2 };
      },
    },
    { purgeLimit: 25 },
  );

  assert.deepEqual(
    await runner.run('due-worker-1', '2026-07-29T02:00:00.000Z'),
    {
      claimed: 2,
      deadLettered: 1,
      deletedItems: 3,
      deletedRuns: 2,
      delivered: 0,
      lost: 0,
      retried: 1,
      suppressed: 0,
    },
  );
  assert.deepEqual(calls, [
    ['runOnce', 'due-worker-1'],
    ['purgeExpired', '2026-07-29T02:00:00.000Z', 25],
  ]);
});

test('item retries complete the scanner tick while global failures retry it', async () => {
  const handler = createDueDeliveryScannerJobHandler(
    {
      async run(workerId, claimedAt) {
        assert.equal(workerId, 'due-worker-1');
        assert.equal(claimedAt, '2026-07-29T02:00:00.000Z');
        return {
          claimed: 2,
          deadLettered: 1,
          deletedItems: 0,
          deletedRuns: 0,
          delivered: 0,
          lost: 0,
          retried: 1,
          suppressed: 0,
        };
      },
    },
    'due-worker-1',
  );
  const completed = await handler(envelope(), context());
  assert.deepEqual(completed, {
    output: {
      claimed: 2,
      deadLettered: 1,
      deletedItems: 0,
      deletedRuns: 0,
      delivered: 0,
      lost: 0,
      retried: 1,
      suppressed: 0,
    },
    status: 'completed',
  });

  const retrying = createDueDeliveryScannerJobHandler(
    {
      async run() {
        throw new Error('claim failed');
      },
    },
    'due-worker-1',
  );
  assert.deepEqual(await retrying(envelope(), context()), {
    output: {
      code: 'DUE_DELIVERY_SCAN_FAILED',
      message: 'claim failed',
    },
    status: 'retry',
  });
});

function envelope() {
  return {
    enqueuedAt: '2026-07-29T01:59:00.000Z',
    fingerprint: 'fixture',
    jobId: DUE_DELIVERY_SCANNER_SCHEDULE_ID,
    kind: DUE_DELIVERY_SCANNER_JOB_KIND,
    payload: {},
    workspaceId: '__system__',
  };
}

function context() {
  return {
    attempt: 1,
    claimedAt: '2026-07-29T02:00:00.000Z',
    recovered: false,
    renewLease: async () => undefined,
    transportId: 'fixture',
  };
}
