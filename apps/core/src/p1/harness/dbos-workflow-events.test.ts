import assert from 'node:assert/strict';
import test from 'node:test';

import { HarnessWorkflowEventSource } from '../workflow-events.js';
import { HarnessDbosWorkflowEventReader } from './dbos-workflow-events.js';
import { HarnessActionAuthorizationError } from './action-registry.js';
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
          experienceBasis: {
            taskId: 'task-1',
            contextBundleId: 'bundle-task-1',
            contextBundleRevision: 2,
            confirmedPreferences: [
              {
                sourceRef: 'preference:tone:r1',
                label: '少促销感',
                value: '少促销感',
              },
            ],
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
    {
      async getUsage(taskId, workspaceId) {
        assert.equal(taskId, 'task-1');
        assert.equal(workspaceId, 'workspace-1');
        return {
          id: 'usage-task-1',
          taskId,
          workspaceId,
          quoteId: 'quote-task-1',
          status: 'committed',
          reservedQuantity: 2,
          reservedUnits: [{ resource: 'copy', quantity: 2 }],
          settledQuantity: 2,
          settledUnits: [{ resource: 'copy', quantity: 2 }],
          refundedQuantity: 0,
          refundedUnits: [],
          billingMode: 'per_request',
          settlementStatus: 'reconciled',
          createdAt: '2026-07-18T08:00:00.000Z',
          updatedAt: '2026-07-18T09:00:00.000Z',
        };
      },
    },
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
      experienceBasis: {
        taskId: 'task-1',
        contextBundleId: 'bundle-task-1',
        contextBundleRevision: 2,
        confirmedPreferences: [
          {
            sourceRef: 'preference:tone:r1',
            label: '少促销感',
            value: '少促销感',
          },
        ],
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
    actionUsage: {
      actionId: 'usage-task-1',
      taskId: 'task-1',
      status: 'completed',
      settlementStatus: 'reconciled',
      settledUnits: 2,
      refundedUnits: 0,
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
    {
      async getUsage(taskId, workspaceId) {
        return {
          id: 'usage-task-failed',
          taskId,
          workspaceId,
          quoteId: 'quote-task-failed',
          status: 'refunded',
          reservedQuantity: 1,
          reservedUnits: [{ resource: 'copy', quantity: 1 }],
          settledQuantity: 0,
          settledUnits: [],
          refundedQuantity: 1,
          refundedUnits: [{ resource: 'copy', quantity: 1 }],
          billingMode: 'per_request',
          settlementStatus: 'reconciled',
          createdAt: '2026-07-18T08:00:00.000Z',
          updatedAt: '2026-07-18T09:00:00.000Z',
        };
      },
    },
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
          quotaRefunded: true,
        },
      },
      // P0-2: the same frame that carries the failure carries what the merchant
      // is told about it, so the copy cannot die in the transport layer.
      merchantReport: {
        kind: 'failure',
        category: 'consistency',
        message: '这个作品刚才被更新过，这次的结果就没有再保存下来。',
        nextStep: '请返回工作台确认当前内容后重新发起。',
        actions: ['adjust_intent'],
        quotaRefunded: true,
      },
      actionUsage: {
        actionId: 'usage-task-failed',
        taskId: 'task-1',
        status: 'rejected',
        settlementStatus: 'reconciled',
        settledUnits: 0,
        refundedUnits: 1,
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
  assert.equal(state.merchantReport?.actions.includes('retry'), false);
  assert.ok(state.merchantReport?.actions.includes('adjust_intent'));
  assert.match(state.merchantReport?.nextStep ?? '', /返回工作台/u);
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
          merchantMessage: '超时未选择，本次任务已取消，积分已退回',
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
        merchantMessage: '超时未选择，本次任务已取消，积分已退回',
        outcome: 'cancelled',
        resolutionSource: 'core_hold_expired',
      },
    },
  );
});

test('credit hold-expiry refund upgrades 处理中 when ProductUsage is already refunded', async () => {
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
          merchantMessage: '超时未选择，本次任务已取消，积分退款处理中',
          outcome: 'cancelled',
          resolutionSource: 'core_hold_expired',
        };
      },
    },
    () => '2026-08-11T09:00:00.000Z',
    {
      async getUsage() {
        return {
          id: 'usage-credit-hold',
          taskId: 'task-credit-hold',
          workspaceId: 'workspace-1',
          quoteId: 'quote-credit-hold',
          status: 'refunded',
          reservedQuantity: 0,
          reservedUnits: [],
          settledQuantity: 0,
          settledUnits: [],
          refundedQuantity: 0,
          refundedUnits: [],
          reservedCredits: 18,
          settledCredits: 0,
          refundedCredits: 18,
          billingMode: 'per_request',
          settlementStatus: 'reconciled',
          createdAt: '2026-08-11T08:00:00.000Z',
          updatedAt: '2026-08-11T09:00:00.000Z',
        };
      },
    },
  );

  const state = await reader.readState(
    'workspace-1',
    'task-credit-hold',
    new AbortController().signal,
  );

  assert.equal(state.status, 'success');
  assert.equal(
    state.snapshot.merchantMessage,
    '超时未选择，本次任务已取消，积分已退回',
  );
  assert.equal(state.actionUsage?.refundedUnits, 0);
  assert.equal(state.actionUsage?.status, 'rejected');
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

test('a subscription opened before the prepared run starts still gets its frames', async () => {
  // V31-56: the browser subscribes right after the 202, but the prepared
  // attempt's DBOS workflow is only created at 开始制作. DBOS.readStream ends
  // immediately for a workflow that does not exist, so ending the SSE there
  // silently loses every 白话进度 frame (F5, CI run 31573910031 m04:364).
  let streamCalls = 0;
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
      async *readStream() {
        streamCalls += 1;
        if (streamCalls === 1) return; // workflow not created yet
        yield progress(0, 'intent_naming');
        yield progress(1, 'assembly_delivery');
      },
      async getResult() {
        return {};
      },
      async getWorkflowStatus() {
        return streamCalls < 2 ? null : 'SUCCESS';
      },
    },
    () => '2026-07-18T09:00:00.000Z',
  );

  const stages: number[] = [];
  for await (const event of reader.readEvents(
    'workspace-1',
    'task-1',
    new AbortController().signal,
  )) {
    stages.push(event.sequence);
  }
  assert.deepEqual(stages, [0, 1]);
});

test('a retried stream never replays frames it already delivered', async () => {
  let streamCalls = 0;
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
      async *readStream() {
        streamCalls += 1;
        yield progress(0, 'intent_naming');
        if (streamCalls === 1) return; // stream cut while the run is active
        yield progress(1, 'assembly_delivery');
      },
      async getResult() {
        return {};
      },
      async getWorkflowStatus() {
        return streamCalls < 2 ? 'PENDING' : 'SUCCESS';
      },
    },
    () => '2026-07-18T09:00:00.000Z',
  );

  const stages: number[] = [];
  for await (const event of reader.readEvents(
    'workspace-1',
    'task-1',
    new AbortController().signal,
  )) {
    stages.push(event.sequence);
  }
  assert.deepEqual(stages, [0, 1]);
});

test('subscription restore rejects a foreign durable task before DBOS effects', async () => {
  let transportEffects = 0;
  const reader = new HarnessDbosWorkflowEventReader(
    {
      async taskBelongsToWorkspace() {
        return false;
      },
      async workflowRuntimeId() {
        throw new Error('foreign runtime lookup must not continue');
      },
      async readTerminalFailure() {
        throw new Error('foreign failure lookup must not continue');
      },
    },
    {
      async *readStream() {
        transportEffects += 1;
      },
      async getResult() {
        transportEffects += 1;
        return {};
      },
    },
  );

  await assert.rejects(
    reader.readState(
      'workspace-a',
      'task-from-workspace-b',
      new AbortController().signal,
    ),
    HarnessActionAuthorizationError,
  );
  await assert.rejects(
    reader
      .readEvents(
        'workspace-a',
        'task-from-workspace-b',
        new AbortController().signal,
      )
      [Symbol.asyncIterator]()
      .next(),
    HarnessActionAuthorizationError,
  );
  assert.equal(transportEffects, 0);
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
