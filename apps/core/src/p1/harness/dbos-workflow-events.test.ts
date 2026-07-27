import assert from 'node:assert/strict';
import test from 'node:test';

import { HarnessWorkflowEventSource } from '../workflow-events.js';
import { HarnessDbosWorkflowEventReader } from './dbos-workflow-events.js';
import { harnessRuntimeId } from './workspace-scope.js';

test('DBOS event reader exposes durable progress then the revision result', async () => {
  const transportWorkflowIds: string[] = [];
  const reader = new HarnessDbosWorkflowEventReader(
    {
      async taskBelongsToWorkspace(taskId, workspaceId) {
        return taskId === 'task-1' && workspaceId === 'workspace-1';
      },
      async workflowRuntimeId(workspaceId, workflowId) {
        return harnessRuntimeId(workspaceId, workflowId);
      },
      async readTerminalFailure() {
        return null;
      },
    },
    {
      async *readStream(workflowId) {
        transportWorkflowIds.push(workflowId);
        yield progress(0, 'intent_naming');
        yield progress(1, 'context_injection');
        yield progress(2, 'brief_compilation');
        yield progress(3, 'execution_selection');
        yield progress(4, 'assembly_delivery');
      },
      async getResult(workflowId) {
        transportWorkflowIds.push(workflowId);
        return {
          delivery: {
            packageId: 'package-1',
            versionId: 'version-1',
            revision: 1,
          },
          recommendation: {
            recommendedCandidateId: 'c02',
            decisionTrace: {
              whyPost: 'promotion_groupbuy_conversion',
              expressionIdentity: 'identity-1',
              factReferences: ['fact-1'],
              platforms: ['xiaohongshu'],
              customerAction: '私信预约',
              complianceStatus: 'seven_gates_passed',
              deliverables: ['copy_revision:1'],
            },
          },
        };
      },
    },
    () => '2026-07-18T09:00:00.000Z',
  );
  const source = new HarnessWorkflowEventSource(reader);

  assert.equal(await source.owns('workspace-1', 'task-1'), true);
  assert.equal(await source.owns('workspace-2', 'task-1'), false);
  const frames = [];
  for await (const frame of source.stream({
    signal: new AbortController().signal,
    workflowId: 'task-1',
    workspaceId: 'workspace-1',
  })) {
    frames.push(frame);
  }

  assert.deepEqual(
    frames.slice(0, 5).map((frame) => frame.event),
    Array(5).fill('workflow.progress'),
  );
  assert.equal(frames[5]?.event, 'workflow.state');
  assert.deepEqual(transportWorkflowIds, [
    harnessRuntimeId('workspace-1', 'task-1'),
    harnessRuntimeId('workspace-1', 'task-1'),
  ]);
  assert.deepEqual(frames[5]?.data, {
    workflowId: 'task-1',
    sourceRevision: 1,
    status: 'success',
    occurredAt: '2026-07-18T09:00:00.000Z',
    snapshot: {
      delivery: {
        packageId: 'package-1',
        versionId: 'version-1',
        revision: 1,
      },
      recommendation: {
        recommendedCandidateId: 'c02',
        decisionTrace: {
          whyPost: 'promotion_groupbuy_conversion',
          expressionIdentity: 'identity-1',
          factReferences: ['fact-1'],
          platforms: ['xiaohongshu'],
          customerAction: '私信预约',
          complianceStatus: 'seven_gates_passed',
          deliverables: ['copy_revision:1'],
        },
      },
    },
  });
});

test('DBOS event reader preserves revision conflict details in failed state', async () => {
  const reader = new HarnessDbosWorkflowEventReader(
    {
      async taskBelongsToWorkspace() {
        return true;
      },
      async workflowRuntimeId(workspaceId, workflowId) {
        return harnessRuntimeId(workspaceId, workflowId);
      },
      async readTerminalFailure() {
        return {
          code: 'CONTENT_PACKAGE_REVISION_CONFLICT',
          packageId: 'package-1',
          expectedRevision: 0,
          currentRevision: 2,
        };
      },
    },
    {
      async *readStream() {},
      async getResult() {
        throw new Error('workflow failed');
      },
    },
    () => '2026-07-18T09:00:00.000Z',
  );

  assert.deepEqual(
    await reader.readState(
      'workspace-1',
      'task-1',
      new AbortController().signal,
    ),
    {
      workflowId: 'task-1',
      sourceRevision: 2,
      status: 'failed',
      occurredAt: '2026-07-18T09:00:00.000Z',
      snapshot: {
        outcome: 'failed',
        error: {
          code: 'CONTENT_PACKAGE_REVISION_CONFLICT',
          packageId: 'package-1',
          expectedRevision: 0,
          currentRevision: 2,
        },
      },
      // P0-2: the same frame that carries the failure carries what the merchant
      // is told about it, so the copy cannot die in the transport layer.
      merchantReport: {
        kind: 'failure',
        category: 'consistency',
        message: '这个作品刚才被更新过，这次的结果就没有再保存下来。',
        nextStep: '按现在的内容再生成一次就好。',
        actions: ['retry'],
        quotaRefunded: false,
      },
    },
  );
});

test('a refunded media failure states the merchant reason and the refund', async () => {
  const reader = new HarnessDbosWorkflowEventReader(
    {
      async taskBelongsToWorkspace() {
        return true;
      },
      async workflowRuntimeId(workspaceId, workflowId) {
        return harnessRuntimeId(workspaceId, workflowId);
      },
      async readTerminalFailure() {
        return {
          code: 'MEDIA_GENERATION_FAILED',
          merchantMessage:
            '这次图片没有顺利生成。你可以重新生成，或换一张参考素材再试。',
          quotaRefunded: true,
        };
      },
    },
    {
      async *readStream() {},
      async getResult() {
        throw new Error('workflow failed');
      },
    },
    () => '2026-07-18T09:00:00.000Z',
  );

  const state = await reader.readState(
    'workspace-1',
    'task-1',
    new AbortController().signal,
  );

  assert.equal(state.status, 'failed');
  assert.equal(state.merchantReport?.category, 'media_generation');
  assert.equal(state.merchantReport?.quotaRefunded, true);
  assert.match(state.merchantReport?.message ?? '', /图片没有顺利生成/u);
  assert.ok(state.merchantReport?.actions.includes('retry'));
});

test('a partial delivery rides the terminal success frame', async () => {
  const reader = new HarnessDbosWorkflowEventReader(
    {
      async taskBelongsToWorkspace() {
        return true;
      },
      async workflowRuntimeId(workspaceId, workflowId) {
        return harnessRuntimeId(workspaceId, workflowId);
      },
      async readTerminalFailure() {
        return null;
      },
    },
    {
      async *readStream() {},
      async getResult() {
        return {
          delivery: { packageId: 'package-1', versionId: 'v1', revision: 3 },
          merchantReport: {
            kind: 'partial',
            category: 'consistency',
            message: '整套图文已经生成好了；其中 1 页的画面和文字还没完全对上。',
            nextStep: '可以先用已经对好的页面，稍后再让我重做那一页。',
            actions: ['review_partial', 'retry'],
            quotaRefunded: false,
          },
        };
      },
    },
    () => '2026-07-18T09:00:00.000Z',
  );

  const state = await reader.readState(
    'workspace-1',
    'task-1',
    new AbortController().signal,
  );

  assert.equal(state.status, 'success');
  assert.equal(state.sourceRevision, 3);
  assert.equal(state.merchantReport?.kind, 'partial');
  assert.ok(state.merchantReport?.actions.includes('review_partial'));
});

test('DBOS event reader exposes hold expiry as success without delivery', async () => {
  const reader = new HarnessDbosWorkflowEventReader(
    {
      async taskBelongsToWorkspace() {
        return true;
      },
      async workflowRuntimeId(workspaceId, workflowId) {
        return harnessRuntimeId(workspaceId, workflowId);
      },
      async readTerminalFailure() {
        return null;
      },
    },
    {
      async *readStream() {},
      async getResult() {
        return {
          delivery: null,
          merchantMessage: '超时未选择，本次任务已取消，额度已退回',
          outcome: 'cancelled',
          resolutionSource: 'core_hold_expired',
        };
      },
    },
    () => '2026-07-18T09:00:00.000Z',
  );

  assert.deepEqual(
    await reader.readState(
      'workspace-1',
      'task-hold-expired',
      new AbortController().signal,
    ),
    {
      workflowId: 'task-hold-expired',
      sourceRevision: 0,
      status: 'success',
      occurredAt: '2026-07-18T09:00:00.000Z',
      snapshot: {
        delivery: null,
        merchantMessage: '超时未选择，本次任务已取消，额度已退回',
        outcome: 'cancelled',
        resolutionSource: 'core_hold_expired',
      },
    },
  );
});

test('DBOS event reader does not invent a terminal failure without audit evidence', async () => {
  const reader = new HarnessDbosWorkflowEventReader(
    {
      async taskBelongsToWorkspace() {
        return true;
      },
      async workflowRuntimeId() {
        return 'legacy-task-1';
      },
      async readTerminalFailure() {
        return null;
      },
    },
    {
      async *readStream() {},
      async getResult() {
        throw new Error('temporary DBOS read failure');
      },
    },
  );

  await assert.rejects(
    reader.readState(
      'workspace-1',
      'task-1',
      new AbortController().signal,
    ),
    /temporary DBOS read failure/u,
  );
});

test('DBOS event reader preserves a migrated legacy runtime identity', async () => {
  const workflowIds: string[] = [];
  const reader = new HarnessDbosWorkflowEventReader(
    {
      async taskBelongsToWorkspace() {
        return true;
      },
      async workflowRuntimeId() {
        return 'legacy-task-1';
      },
      async readTerminalFailure() {
        return null;
      },
    },
    {
      async *readStream(workflowId) {
        workflowIds.push(workflowId);
      },
      async getResult(workflowId) {
        workflowIds.push(workflowId);
        return {};
      },
    },
    () => '2026-07-18T09:00:00.000Z',
  );

  for await (const _event of reader.readEvents(
    'workspace-1',
    'task-1',
    new AbortController().signal,
  )) {
    // The migrated stream is intentionally empty.
  }
  await reader.readState(
    'workspace-1',
    'task-1',
    new AbortController().signal,
  );
  assert.deepEqual(workflowIds, ['legacy-task-1', 'legacy-task-1']);
});

function progress(
  sequence: number,
  stage:
    | 'intent_naming'
    | 'context_injection'
    | 'brief_compilation'
    | 'execution_selection'
    | 'assembly_delivery',
) {
  return {
    eventId: `task-1:progress:${sequence}`,
    workflowId: 'task-1',
    workflowType: 'beauty_marketing_harness',
    sequence,
    sourceRevision: 1,
    stage,
    state: 'success' as const,
    occurredAt: `2026-07-18T08:00:0${sequence}.000Z`,
    message: `stage-${sequence}`,
  };
}
