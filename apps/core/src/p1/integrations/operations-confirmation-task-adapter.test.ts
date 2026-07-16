import assert from 'node:assert/strict';
import test from 'node:test';

import {
  MemoryOperationsRepository,
  OperationsApplicationService,
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
} from '../operations/index.js';
import { OperationsConfirmationTaskAdapter } from './operations-confirmation-task-adapter.js';

test('bridges an integration anomaly idempotently and archives it on recovery', async () => {
  const repository = new MemoryOperationsRepository();
  repository.grantMembership('owner-a', 'workspace-a');
  let sequence = 0;
  const operations = new OperationsApplicationService(repository, {
    canvasExporter: new RecordedCanvasExportAdapter(),
    clock: () => new Date('2026-07-11T12:00:00.000Z'),
    createId: () => `id-${++sequence}`,
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: { async send() {} },
  });
  const adapter = new OperationsConfirmationTaskAdapter(operations);
  const anomaly = {
    connectionId: 'feishu-a',
    correlationId: 'corr-anomaly-a',
    provider: 'feishu' as const,
    reason: 'unauthorized',
    status: 'reauthorize_required' as const,
    userId: 'owner-a',
    workspaceId: 'workspace-a',
  };

  const first = await adapter.report(anomaly);
  const replay = await adapter.report({
    ...anomaly,
    correlationId: 'corr-anomaly-replay',
  });
  assert.equal(replay.taskId, first.taskId);

  const context = {
    actor: 'owner' as const,
    correlationId: 'corr-list',
    userId: 'owner-a',
    workspaceId: 'workspace-a',
  };
  let tasks = (
    await operations.listInbox(context, {
      relatedObject: { id: 'feishu-a', kind: 'integration' },
    })
  ).tasks;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0]?.status, 'blocked');
  assert.equal(tasks[0]?.source, 'manual');
  assert.equal(tasks[0]?.risk, 'external_permission');

  await adapter.resolve({
    connectionId: 'feishu-a',
    correlationId: 'corr-recovered',
    userId: 'owner-a',
    workspaceId: 'workspace-a',
  });
  tasks = (
    await operations.listInbox(context, {
      relatedObject: { id: 'feishu-a', kind: 'integration' },
    })
  ).tasks;
  assert.equal(tasks[0]?.status, 'archived');

  const nextIncident = await adapter.report({
    ...anomaly,
    correlationId: 'corr-next-incident',
    reason: 'rate_limited',
    status: 'rate_limited',
  });
  assert.notEqual(nextIncident.taskId, first.taskId);
  tasks = (
    await operations.listInbox(context, {
      relatedObject: { id: 'feishu-a', kind: 'integration' },
    })
  ).tasks;
  assert.deepEqual(
    tasks.map((task) => task.status).sort(),
    ['archived', 'blocked']
  );
});

test('accepts a trusted provider callback identity without workspace membership', async () => {
  const repository = new MemoryOperationsRepository();
  const operations = new OperationsApplicationService(repository, {
    canvasExporter: new RecordedCanvasExportAdapter(),
    clock: () => new Date('2026-07-11T12:00:00.000Z'),
    createId: () => 'callback-task',
    imageGenerator: new RecordedImageGenerationAdapter(),
    notifier: { async send() {} },
  });
  const adapter = new OperationsConfirmationTaskAdapter(operations);

  const result = await adapter.report({
    connectionId: 'douyin-callback-connection',
    correlationId: 'corr-douyin-callback',
    provider: 'douyin',
    reason: 'authorization_revoked',
    status: 'reauthorize_required',
    userId: 'douyin-callback',
    workspaceId: 'workspace-a',
  });

  assert.equal(result.taskId, 'callback-task');
});
