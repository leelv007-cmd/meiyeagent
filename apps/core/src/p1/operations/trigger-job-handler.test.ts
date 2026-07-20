import assert from 'node:assert/strict';
import test from 'node:test';
import type { DurableJobEnvelope } from '../job-runtime/job-contracts.js';
import {
  RecordedBatchExecutionAdapter,
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
} from './adapters.js';
import { OperationsApplicationService } from './application-service.js';
import { MemoryOperationsRepository } from './repository.js';
import {
  createOperationsTriggerJobHandler,
  OPERATIONS_TRIGGER_JOB_KIND,
} from './trigger-job-handler.js';

function envelope(triggerKind: string): DurableJobEnvelope {
  return {
    enqueuedAt: '2026-07-13T01:00:00.000Z',
    fingerprint: 'a'.repeat(64),
    jobId: 'weekly-trigger',
    kind: OPERATIONS_TRIGGER_JOB_KIND,
    payload: { triggerKind },
    workspaceId: 'workspace-trigger',
  };
}

const worker = {
  attempt: 1,
  claimedAt: '2026-07-13T01:00:00.000Z',
  recovered: false,
  renewLease: async () => undefined,
  transportId: 'transport-trigger',
};

test('operations trigger worker creates one task per time window and completes disabled schedules', async () => {
  const repository = new MemoryOperationsRepository();
  repository.grantMembership('owner-trigger', 'workspace-trigger');
  const operations = new OperationsApplicationService(repository, {
    batchExecutor: new RecordedBatchExecutionAdapter(),
    canvasExporter: new RecordedCanvasExportAdapter(),
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: { async send() {} },
  });
  await operations.configureTrigger(
    {
      actor: 'owner',
      correlationId: 'configure-trigger',
      userId: 'owner-trigger',
      workspaceId: 'workspace-trigger',
    },
    'weekly_batch_ready',
    true
  );
  const handler = createOperationsTriggerJobHandler(operations);
  const first = await handler(envelope('weekly_batch_ready'), worker);
  const replayed = await handler(envelope('weekly_batch_ready'), worker);

  assert.equal(first.status, 'completed');
  assert.equal(first.output?.triggerStatus, 'created');
  assert.equal(replayed.output?.triggerStatus, 'deduplicated');

  const disabled = await handler(envelope('asset_gap_detected'), worker);
  assert.deepEqual(disabled, {
    status: 'completed',
    output: { triggerStatus: 'disabled' },
  });
  assert.equal(
    (
      await operations.listInbox(
        {
          actor: 'owner',
          correlationId: 'read-trigger',
          userId: 'owner-trigger',
          workspaceId: 'workspace-trigger',
        },
        {}
      )
    ).tasks.length,
    1
  );
});

test('operations trigger worker dead-letters invalid payloads', async () => {
  const operations = new OperationsApplicationService(
    new MemoryOperationsRepository(),
    {
      batchExecutor: new RecordedBatchExecutionAdapter(),
      canvasExporter: new RecordedCanvasExportAdapter(),
      imageGenerator: new RecordedImageGenerationAdapter(),
      notifier: { async send() {} },
    }
  );
  const result = await createOperationsTriggerJobHandler(operations)(
    envelope('arbitrary-action'),
    worker
  );
  assert.deepEqual(result, {
    status: 'dead_letter',
    output: { code: 'INVALID_TRIGGER_KIND' },
  });
});
