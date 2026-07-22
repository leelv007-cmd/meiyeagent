import assert from 'node:assert/strict';
import test from 'node:test';
import {
  S3_ASSET_REGISTRATION_CLEANUP_JOB_KIND,
  S3_ASSET_REGISTRATION_CLEANUP_SCHEDULE_ID,
  createS3AssetRegistrationCleanupJobHandler,
  registerS3AssetRegistrationCleanupSchedule,
} from './owned-asset-registration-cleanup.js';

test('schedules cleanup durably and retries an auditable cleanup failure', async () => {
  const scheduled: unknown[] = [];
  await registerS3AssetRegistrationCleanupSchedule({
    async scheduleRecurring(input) {
      scheduled.push(input);
    },
  });
  assert.deepEqual(scheduled, [{
    cron: '*/5 * * * *',
    kind: S3_ASSET_REGISTRATION_CLEANUP_JOB_KIND,
    payload: {},
    scheduleId: S3_ASSET_REGISTRATION_CLEANUP_SCHEDULE_ID,
    timezone: 'Asia/Shanghai',
    workspaceId: '__system__',
  }]);

  const handler = createS3AssetRegistrationCleanupJobHandler({
    async run() {
      return {
        alertCount: 1,
        deferredCount: 0,
        deletedCount: 0,
        failedCount: 1,
        referencedCount: 0,
        targetCount: 1,
      };
    },
  });
  const result = await handler(
    {
      enqueuedAt: '2026-07-22T10:00:00.000Z',
      fingerprint: 'fixture',
      jobId: S3_ASSET_REGISTRATION_CLEANUP_SCHEDULE_ID,
      kind: S3_ASSET_REGISTRATION_CLEANUP_JOB_KIND,
      payload: {},
      workspaceId: '__system__',
    },
    {
      attempt: 1,
      claimedAt: '2026-07-22T10:00:00.000Z',
      recovered: false,
      renewLease: async () => undefined,
      transportId: 'fixture',
    },
  );
  assert.deepEqual(result, {
    output: {
      alertCode: 'S3_ASSET_CLEANUP_RETRY_REQUIRED',
      alertCount: 1,
      deferredCount: 0,
      deletedCount: 0,
      failedCount: 1,
      referencedCount: 0,
      targetCount: 1,
    },
    status: 'retry',
  });
});
