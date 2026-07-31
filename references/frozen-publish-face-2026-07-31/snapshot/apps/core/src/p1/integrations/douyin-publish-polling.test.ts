import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DouyinPublishPollingBatchRunner,
  createDouyinPublishPollingJobHandler,
  DOUYIN_PUBLISH_POLLING_JOB_KIND,
} from './douyin-publish-polling.js';

test('bounded publish polling processes due targets and isolates target failures', async () => {
  const calls: string[] = [];
  const runner = new DouyinPublishPollingBatchRunner(
    {
      async listDouyinPublishPollingTargets(at) {
        assert.equal(at, '2026-07-11T08:00:00.000Z');
        return [
          { jobId: 'publish-a', workspaceId: 'workspace-a' },
          { jobId: 'publish-b', workspaceId: 'workspace-b' },
        ];
      },
    },
    {
      async pollDouyinPublishStatus(context, jobId, at) {
        calls.push(`${context.workspaceId}:${jobId}:${at}`);
        if (jobId === 'publish-b') throw new Error('isolated provider failure');
      },
    }
  );

  assert.deepEqual(await runner.run('2026-07-11T08:00:00.000Z'), {
    failedCount: 1,
    processedCount: 1,
    targetCount: 2,
  });
  assert.deepEqual(calls, [
    'workspace-a:publish-a:2026-07-11T08:00:00.000Z',
    'workspace-b:publish-b:2026-07-11T08:00:00.000Z',
  ]);
});

test('publish polling handler preserves the recurring job contract', async () => {
  const handler = createDouyinPublishPollingJobHandler({
    async run(at) {
      assert.equal(at, '2026-07-11T08:00:00.000Z');
      return { failedCount: 0, processedCount: 1, targetCount: 1 };
    },
  });
  assert.deepEqual(
    await handler(
      {
        enqueuedAt: '2026-07-11T08:00:00.000Z',
        fingerprint: 'publish-polling',
        jobId: 'publish-polling-job',
        kind: DOUYIN_PUBLISH_POLLING_JOB_KIND,
        payload: { at: '2026-07-11T08:00:00.000Z' },
        workspaceId: '__system__',
      },
      {
        attempt: 1,
        claimedAt: '2026-07-11T08:00:00.000Z',
        recovered: false,
        renewLease: async () => undefined,
        transportId: 'worker-a',
      }
    ),
    {
      output: { failedCount: 0, processedCount: 1, targetCount: 1 },
      status: 'completed',
    }
  );
});
