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
