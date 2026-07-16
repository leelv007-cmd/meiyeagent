import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FEISHU_INTENT_RECONCILIATION_JOB_KIND,
  FeishuIntentReconciliationBatchRunner,
  createFeishuIntentReconciliationJobHandler,
} from './feishu-intent-reconciliation.js';

test('Feishu reconciliation worker processes due intents without replaying writes', async () => {
  const calls: string[] = [];
  const runner = new FeishuIntentReconciliationBatchRunner(
    {
      async listFeishuReconciliationTargets(at) {
        assert.equal(at, '2026-07-11T08:00:00.000Z');
        return [
          { intentId: 'intent-a', workspaceId: 'workspace-a' },
          { intentId: 'intent-b', workspaceId: 'workspace-b' },
        ];
      },
    },
    {
      async reconcileFeishuIntent(context, intentId, at) {
        calls.push(`${context.workspaceId}:${intentId}:${at}`);
        if (intentId === 'intent-b') throw new Error('isolated inspection error');
      },
    }
  );

  assert.deepEqual(await runner.run('2026-07-11T08:00:00.000Z'), {
    failedCount: 1,
    processedCount: 1,
    targetCount: 2,
  });
  assert.deepEqual(calls, [
    'workspace-a:intent-a:2026-07-11T08:00:00.000Z',
    'workspace-b:intent-b:2026-07-11T08:00:00.000Z',
  ]);
});

test('Feishu reconciliation handler preserves the durable job contract', async () => {
  const handler = createFeishuIntentReconciliationJobHandler({
    async run(at) {
      assert.equal(at, '2026-07-11T08:00:00.000Z');
      return { failedCount: 0, processedCount: 1, targetCount: 1 };
    },
  });
  assert.deepEqual(
    await handler(
      {
        enqueuedAt: '2026-07-11T08:00:00.000Z',
        fingerprint: 'feishu-reconcile',
        jobId: 'feishu-reconcile-job',
        kind: FEISHU_INTENT_RECONCILIATION_JOB_KIND,
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
