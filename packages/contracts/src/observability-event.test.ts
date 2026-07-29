import assert from 'node:assert/strict';
import test from 'node:test';

import {
  actionUsageSchema,
  agentPrimitiveLifecycleEventSchema,
  canonicalizeBoundedExecutionEvent,
  canonicalizeNotePageRegeneratedEvent,
  observabilityAxisBindingSchema,
  observabilityEventSchema,
} from './index.js';

const axes = {
  skillRevision: 'copywriter@rev-17',
  promptVersion: 'marketing/copy@v4',
  catalogRevision: 'catalog-2026-07-29',
  scene: 'opening-campaign',
};

test('canonical feedback events retain only named safe strings and flat axes', () => {
  assert.deepEqual(
    observabilityEventSchema.parse({
      eventType: 'delivery_rating.recorded',
      taskId: 'task-248',
      ...axes,
      payload: {
        packageId: 'package-248',
        versionId: 'version-3',
        revision: 3,
        verdict: 'up',
      },
    }),
    {
      eventType: 'delivery_rating.recorded',
      taskId: 'task-248',
      ...axes,
      payload: {
        packageId: 'package-248',
        versionId: 'version-3',
        revision: 3,
        verdict: 'up',
      },
    },
  );

  assert.equal(
    observabilityEventSchema.safeParse({
      eventType: 'delivery_rating.withdrawn',
      taskId: 'task-248',
      ...axes,
      payload: {
        packageId: 'package-248',
        versionId: 'version-3',
        revision: 3,
        previousVerdict: 'down',
      },
    }).success,
    true,
  );

  for (const invalid of [
    {
      eventType: 'delivery_rating.recorded',
      taskId: 'task-248',
      ...axes,
      payload: {
        packageId: 'package-248',
        versionId: 'version-3',
        revision: 3,
        verdict: 'up_cleared',
      },
    },
    {
      eventType: 'delivery_rating.recorded',
      taskId: 'task-248',
      ...axes,
      payload: {
        packageId: 'package-248',
        versionId: 'version-3',
        revision: 3,
        verdict: 'up',
        message: 'arbitrary body text',
      },
    },
    {
      eventType: 'delivery_rating.recorded',
      taskId: 'task-248',
      skillRevision: axes.skillRevision,
      promptVersion: axes.promptVersion,
      catalogRevision: axes.catalogRevision,
      payload: {
        packageId: 'package-248',
        versionId: 'version-3',
        revision: 3,
        verdict: 'up',
      },
    },
    {
      eventType: 'delivery_rating.recorded',
      taskId: 'task-248',
      axes,
      payload: {
        packageId: 'package-248',
        versionId: 'version-3',
        revision: 3,
        verdict: 'up',
      },
    },
  ]) {
    assert.equal(observabilityEventSchema.safeParse(invalid).success, false);
  }
});

test('action usage exposes settled merchant units and rejects internal cost fields', () => {
  assert.deepEqual(
    actionUsageSchema.parse({
      actionId: 'usage-record-248',
      taskId: 'task-248',
      status: 'completed',
      settlementStatus: 'reconciled',
      settledUnits: 2,
      refundedUnits: 1,
    }),
    {
      actionId: 'usage-record-248',
      taskId: 'task-248',
      status: 'completed',
      settlementStatus: 'reconciled',
      settledUnits: 2,
      refundedUnits: 1,
    },
  );

  assert.equal(
    actionUsageSchema.safeParse({
      actionId: 'usage-record-rejected',
      taskId: 'task-rejected',
      status: 'rejected',
      settlementStatus: 'reconciled',
      settledUnits: 0,
      refundedUnits: 1,
    }).success,
    true,
  );

  for (const invalid of [
    {
      actionId: 'usage-record-rejected',
      taskId: 'task-rejected',
      status: 'rejected',
      settlementStatus: 'reconciled',
      settledUnits: 1,
      refundedUnits: 0,
    },
    {
      actionId: 'usage-record-248',
      taskId: 'task-248',
      status: 'completed',
      settlementStatus: 'reconciled',
      settledUnits: 2,
      refundedUnits: 1,
      provider: 'private-provider',
    },
    {
      actionId: 'usage-record-248',
      taskId: 'task-248',
      status: 'completed',
      settlementStatus: 'reconciled',
      settledUnits: 2,
      refundedUnits: 1,
      currency: 'CNY',
    },
  ]) {
    assert.equal(actionUsageSchema.safeParse(invalid).success, false);
  }
});

test('canonical action usage events share the same flat observability envelope', () => {
  const parsed = observabilityEventSchema.parse({
    eventType: 'action_usage.recorded',
    taskId: 'task-248',
    ...axes,
    payload: {
      actionId: 'usage-record-248',
      taskId: 'task-248',
      status: 'rejected',
      settlementStatus: 'reconciled',
      settledUnits: 0,
      refundedUnits: 1,
    },
  });

  assert.equal(parsed.eventType, 'action_usage.recorded');
  assert.equal(parsed.taskId, parsed.payload.taskId);
});

test('bounded execution facts adapt to one canonical envelope without nested axes', () => {
  const suspended = canonicalizeBoundedExecutionEvent('task-bounded', {
    event: 'bounded_execution.suspended',
    ...axes,
    snapshot: {
      schemaVersion: 'bounded-execution-snapshot/v1',
      maxIterations: 3,
      maxCostCents: 100,
      maxWallClockMs: 30_000,
      maxDelegations: 2,
      requiredLimits: [
        'maxIterations',
        'maxCostCents',
        'maxWallClockMs',
        'maxDelegations',
      ],
      consumption: {
        iterations: 3,
        costCents: 30,
        wallClockMs: 2_000,
        delegations: 1,
      },
      stopReason: 'limit_reached',
      triggeredLimit: 'maxIterations',
    },
    currentBest: { candidateId: 'candidate-1' },
    unmetExplanation: 'Iteration limit reached before delivery.',
    resumable: true,
  });

  assert.equal(suspended.eventType, 'bounded_execution.suspended');
  assert.equal(suspended.taskId, 'task-bounded');
  assert.equal('skillRevision' in suspended.payload, false);
  assert.equal(
    observabilityEventSchema.safeParse({
      ...suspended,
      payload: {
        ...suspended.payload,
        skillRevision: axes.skillRevision,
      },
    }).success,
    false,
  );
});

test('note regeneration facts adapt to the same strict canonical envelope', () => {
  const regenerated = canonicalizeNotePageRegeneratedEvent(
    'task-note',
    axes,
    {
      eventType: 'note_page_regenerated',
      payload: {
        auditRef: 'audit-note-1',
        imagePoints: 0,
        pageId: 'page-1',
        reason: 'Exact text mismatch.',
        side: 'text',
        trigger: 'check_violation',
      },
    },
  );

  assert.deepEqual(regenerated, {
    eventType: 'note_page_regenerated',
    taskId: 'task-note',
    ...axes,
    payload: {
      auditRef: 'audit-note-1',
      imagePoints: 0,
      pageId: 'page-1',
      reason: 'Exact text mismatch.',
      side: 'text',
      trigger: 'check_violation',
    },
  });
});

test('agent primitive lifecycle preserves explicit absent root axes', () => {
  const axisBinding = observabilityAxisBindingSchema.parse({
    axisScope: 'task_root',
    skillRevision: { kind: 'absent' },
    promptVersion: { kind: 'absent' },
    catalogRevision: { kind: 'absent' },
    scene: { kind: 'absent' },
  });

  assert.deepEqual(axisBinding, {
    axisScope: 'task_root',
    skillRevision: { kind: 'absent' },
    promptVersion: { kind: 'absent' },
    catalogRevision: { kind: 'absent' },
    scene: { kind: 'absent' },
  });

  assert.deepEqual(
    agentPrimitiveLifecycleEventSchema.parse({
      eventType: 'agent_primitive.lifecycle',
      taskId: 'task-primitive',
      workspaceId: 'workspace-a',
      actorId: `ref:${'a'.repeat(64)}`,
      actorKind: 'worker',
      idempotencyKey: 'primitive-event-id',
      axisScope: 'task_root',
      skillRevision: null,
      promptVersion: null,
      catalogRevision: null,
      scene: null,
      payload: {
        primitiveId: 'generate',
        phase: 'invoked',
        billing: { kind: 'not_billed' },
      },
    }),
    {
      eventType: 'agent_primitive.lifecycle',
      taskId: 'task-primitive',
      workspaceId: 'workspace-a',
      actorId: `ref:${'a'.repeat(64)}`,
      actorKind: 'worker',
      idempotencyKey: 'primitive-event-id',
      axisScope: 'task_root',
      skillRevision: null,
      promptVersion: null,
      catalogRevision: null,
      scene: null,
      payload: {
        primitiveId: 'generate',
        phase: 'invoked',
        billing: { kind: 'not_billed' },
      },
    },
  );
});

test('agent primitive lifecycle rejects forged axes and sensitive failure details', () => {
  const valid = {
    eventType: 'agent_primitive.lifecycle',
    taskId: 'task-primitive',
    workspaceId: 'workspace-a',
    actorId: `ref:${'a'.repeat(64)}`,
    actorKind: 'worker',
    idempotencyKey: 'primitive-event-id',
    axisScope: 'execution_child',
    skillRevision: axes.skillRevision,
    promptVersion: axes.promptVersion,
    catalogRevision: axes.catalogRevision,
    scene: axes.scene,
    payload: {
      primitiveId: 'generate',
      phase: 'rejected',
      billing: {
        kind: 'product_usage',
        productUsageTaskId: 'usage-task-1',
        quoteId: 'quote-1',
      },
      rejectionClass: 'execution_failed',
    },
  } as const;

  assert.equal(agentPrimitiveLifecycleEventSchema.safeParse(valid).success, true);

  for (const invalid of [
    { ...valid, scene: undefined },
    { ...valid, actorId: 'worker-a' },
    { ...valid, skillRevision: 'unknown@0' },
    {
      ...valid,
      payload: { ...valid.payload, rawError: 'provider secret' },
    },
    {
      ...valid,
      payload: { ...valid.payload, rejectionClass: undefined },
    },
    {
      ...valid,
      payload: {
        primitiveId: 'generate',
        phase: 'succeeded',
        billing: { kind: 'not_billed' },
        rejectionClass: 'execution_failed',
      },
    },
  ]) {
    assert.equal(agentPrimitiveLifecycleEventSchema.safeParse(invalid).success, false);
  }
});
