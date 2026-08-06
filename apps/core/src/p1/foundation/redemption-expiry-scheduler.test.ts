import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  REDEMPTION_EXPIRY_JOB_KIND,
  REDEMPTION_EXPIRY_SCHEDULE_ID,
  RedemptionExpiryRunner,
  createRedemptionExpiryJobHandler,
  registerRedemptionExpirySchedule,
} from './redemption-expiry-scheduler.js';
import {
  MemoryRedemptionStore,
  RedemptionApplicationService,
} from './redemption.js';
import { MemoryGrantLotLedger } from './grant-lot.js';

function setup() {
  let now = '2026-07-19T12:00:00.000Z';
  const clock = () => new Date(now);
  const setNow = (value: string) => {
    now = value;
  };
  const store = new MemoryRedemptionStore();
  const grantLots = new MemoryGrantLotLedger();
  const service = new RedemptionApplicationService(store, grantLots, clock);
  return { service, store, setNow };
}

describe('RedemptionExpiryRunner', () => {
  it('registers a durable system recurring job', async () => {
    const scheduled: unknown[] = [];
    await registerRedemptionExpirySchedule({
      async scheduleRecurring(input) {
        scheduled.push(input);
      },
    });
    assert.deepEqual(scheduled, [
      {
        cron: '*/1 * * * *',
        kind: REDEMPTION_EXPIRY_JOB_KIND,
        payload: {},
        scheduleId: REDEMPTION_EXPIRY_SCHEDULE_ID,
        timezone: 'UTC',
        workspaceId: '__system__',
      },
    ]);
  });

  it('expires past-due codes and bumps revision only when the job runs', async () => {
    const { service, store, setNow } = setup();
    const [created] = await service.createCodes({
      code: 'JOB-EXPIRE-20',
      grants: { copy: 20 },
      expiresAt: '2026-07-19T11:59:59.000Z',
      createdBy: 'admin-1',
      createdAt: '2026-07-18T12:00:00.000Z',
    });
    assert.ok(created);
    setNow('2026-07-19T12:00:00.000Z');

    assert.equal((await service.list()).at(0)?.status, 'active');
    assert.equal((await service.list()).at(0)?.revision, 1);

    const runner = new RedemptionExpiryRunner(store);
    assert.deepEqual(await runner.run('2026-07-19T12:00:00.000Z'), {
      expiredCount: 1,
    });
    // Idempotent: already-expired rows are not counted again.
    assert.deepEqual(await runner.run('2026-07-19T12:00:00.000Z'), {
      expiredCount: 0,
    });

    const after = await store.getByCode(created.code);
    assert.equal(after?.status, 'expired');
    assert.equal(after?.revision, 2);
  });

  it('materializes offset-timezone expiry by instant, not text order', async () => {
    const { service, store, setNow } = setup();
    const [created] = await service.createCodes({
      code: 'OFFSET-JOB-20',
      grants: { copy: 20 },
      createdAt: '2026-07-19T10:00:00.000Z',
      expiresAt: '2026-07-20T00:00:00+08:00',
      createdBy: 'admin-1',
    });
    assert.ok(created);
    setNow('2026-07-19T17:00:00.000Z');

    const runner = new RedemptionExpiryRunner(store);
    assert.deepEqual(await runner.run('2026-07-19T17:00:00.000Z'), {
      expiredCount: 1,
    });
    assert.equal((await store.getByCode(created.code))?.status, 'expired');
  });

  it('job handler completes with summary and retries on failure', async () => {
    const handler = createRedemptionExpiryJobHandler({
      async run(at) {
        assert.equal(at, '2026-07-19T12:00:00.000Z');
        return { expiredCount: 3 };
      },
    });
    const context = {
      attempt: 1,
      claimedAt: '2026-07-19T12:00:00.000Z',
      recovered: false,
      renewLease: async () => undefined,
      transportId: 'fixture',
    };
    const envelope = {
      enqueuedAt: '2026-07-19T11:59:00.000Z',
      fingerprint: 'fixture',
      jobId: REDEMPTION_EXPIRY_SCHEDULE_ID,
      kind: REDEMPTION_EXPIRY_JOB_KIND,
      payload: {},
      workspaceId: '__system__',
    };
    assert.deepEqual(await handler(envelope, context), {
      output: { expiredCount: 3 },
      status: 'completed',
    });

    const failing = createRedemptionExpiryJobHandler({
      async run() {
        throw new Error('batch failed');
      },
    });
    assert.deepEqual(await failing(envelope, context), {
      output: {
        code: 'REDEMPTION_EXPIRY_FAILED',
        message: 'batch failed',
      },
      status: 'retry',
    });
  });
});
