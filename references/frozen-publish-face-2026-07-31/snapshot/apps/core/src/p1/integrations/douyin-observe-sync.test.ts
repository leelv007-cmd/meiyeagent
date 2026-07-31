import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DOUYIN_OBSERVE_SYNC_JOB_KIND,
  DouyinObserveSyncBatchRunner,
  createDouyinObserveSyncJobHandler,
} from './douyin-observe-sync.js';

test('Observe scheduler processes only repository-due connections', async () => {
  const calls: string[] = [];
  const runner = new DouyinObserveSyncBatchRunner(
    {
      async listDouyinObserveSyncTargets(at) {
        assert.equal(at, '2026-07-11T08:00:00.000Z');
        return [
          { connectionId: 'douyin-a', workspaceId: 'workspace-a' },
          { connectionId: 'douyin-b', workspaceId: 'workspace-b' },
        ];
      },
    },
    {
      async syncDouyinObserve(context, connectionId, at) {
        calls.push(`${context.workspaceId}:${connectionId}:${at}`);
        if (connectionId === 'douyin-b') throw new Error('isolated sync failure');
      },
    }
  );

  assert.deepEqual(await runner.run('2026-07-11T08:00:00.000Z'), {
    failedCount: 1,
    processedCount: 1,
    targetCount: 2,
  });
  assert.deepEqual(calls, [
    'workspace-a:douyin-a:2026-07-11T08:00:00.000Z',
    'workspace-b:douyin-b:2026-07-11T08:00:00.000Z',
  ]);
});

test('Observe scheduler handler preserves the durable job contract', async () => {
  const handler = createDouyinObserveSyncJobHandler({
    async run(at) {
      assert.equal(at, '2026-07-11T08:00:00.000Z');
      return { failedCount: 0, processedCount: 1, targetCount: 1 };
    },
  });
  assert.deepEqual(
    await handler(
      {
        enqueuedAt: '2026-07-11T08:00:00.000Z',
        fingerprint: 'douyin-observe-sync',
        jobId: 'douyin-observe-sync-job',
        kind: DOUYIN_OBSERVE_SYNC_JOB_KIND,
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
