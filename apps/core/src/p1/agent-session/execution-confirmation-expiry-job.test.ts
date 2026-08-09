import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CONFIRMATION_EXPIRY_JOB_KIND,
  CONFIRMATION_EXPIRY_SCHEDULE_ID,
  createConfirmationExpiryJobHandler,
  registerConfirmationExpirySchedule,
} from './execution-confirmation-expiry-job.js';

test('confirmation expiry is registered as a durable system recurring job', async () => {
  const scheduled: unknown[] = [];
  await registerConfirmationExpirySchedule({
    async scheduleRecurring(input) {
      scheduled.push(input);
    },
  });
  assert.deepEqual(scheduled, [
    {
      cron: '* * * * *',
      kind: CONFIRMATION_EXPIRY_JOB_KIND,
      payload: {},
      scheduleId: CONFIRMATION_EXPIRY_SCHEDULE_ID,
      timezone: 'Asia/Shanghai',
      workspaceId: '__system__',
    },
  ]);
});

test('confirmation expiry handler uses durable claimedAt and is replay safe', async () => {
  const calls: unknown[] = [];
  const handler = createConfirmationExpiryJobHandler({
    async expireDueHolds(input) {
      calls.push(input);
      return { expiredRequestIds: calls.length === 1 ? ['req-1'] : [] };
    },
  });
  const envelope = {
    id: 'job-1',
    workspaceId: '__system__',
    kind: CONFIRMATION_EXPIRY_JOB_KIND,
    payload: {},
  } as never;
  const context = { claimedAt: '2026-08-09T13:00:00.000Z' } as never;
  assert.equal((await handler(envelope, context)).status, 'completed');
  assert.equal((await handler(envelope, context)).status, 'completed');
  assert.deepEqual(calls, [
    { now: '2026-08-09T13:00:00.000Z' },
    { now: '2026-08-09T13:00:00.000Z' },
  ]);
});

test('production worker registers and handles the confirmation expiry schedule', async () => {
  const source = await readFile(
    new URL('../../assembly/worker-runtime.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /await registerConfirmationExpirySchedule\(jobRuntime\)/u,
  );
  assert.match(
    source,
    /\[CONFIRMATION_EXPIRY_JOB_KIND\]:\s*createConfirmationExpiryJobHandler\(executionConfirmationService\)/u,
  );
});
