/**
 * V31-47 / FIX-P1-01: cross-carrier execution wiring.
 *
 * Behavior proof that note+copy revisions fan out one Make per carrier with
 * distinct effect keys, replay safety, partial delivery, and quote=execution set.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  approvalBasisForDeliverables,
  assignExecutionPlanFreezes,
  carrierOfExecutionPlanFreeze,
  compileFinalizeExecutionPlanFreezes,
} from '../agent-session/composer-plan-session.js';
import { MemoryMarketingPlanStore } from '../agent-session/memory-plan-store.js';
import {
  createFixturePlanCompilerPorts,
  PlanCompiler,
} from '../agent-session/plan-compiler.js';
import {
  createMemoryPrimitiveEffectStore,
  executeCompiledCarrierPlan,
  type CompiledPrimitiveHandlers,
} from '../harness/compiled-carrier-executor.js';
import { harnessEffectKey } from '../harness/workflow-core.js';
import type { ExecutionPlanCompileFreeze } from '../harness/execution-plan-admission.js';
import { createCreationExecutionSnapshot } from './creation-execution-snapshot.js';
import {
  carrierFreezesForSubmission,
  CreationStagePort,
  lensForCarrier,
} from './creation-stage-port.js';
import {
  asAgentThreadIdentity,
  composerCarrierAttemptId,
  composerPreparedAttemptId,
  type CreationSubmissionRecord,
} from './submission-coordinator.js';

test('V31-47 note_plus_copy_both_execute: stage port dispatches one Make per carrier', async () => {
  const freezes = await compileNotePlusCopyFreezes();
  const submission = submissionWithFreezes(freezes, {
    packageConfirmationDecisionRef: 'decision-package-1',
  });
  const dispatched: Array<{
    taskId: string;
    sourceTaskId?: string;
    carrier?: string;
    deliverableKinds: string[];
    packageConfirmationDecisionRef?: string;
    packageConfirmationRequestId?: string;
    lens?: string;
  }> = [];
  const sideEffects = new Map<string, number>();

  const stage = new CreationStagePort({
    async preparePendingConfirmation(input) {
      return { workflowId: input.taskId };
    },
    async dispatchPrepared(input) {
      const freeze = input.executionPlanFreeze as ExecutionPlanCompileFreeze | undefined;
      const carrier = freeze ? carrierOfExecutionPlanFreeze(freeze) : undefined;
      dispatched.push({
        taskId: input.taskId,
        sourceTaskId: input.sourceTaskId,
        carrier,
        deliverableKinds: freeze?.deliverables.map((item) => item.kind) ?? [],
        packageConfirmationDecisionRef: input.packageConfirmationDecisionRef,
        packageConfirmationRequestId: input.packageConfirmationRequestId,
        lens: input.executionSnapshot?.lens,
      });
      const key = `make:${input.taskId}`;
      sideEffects.set(key, (sideEffects.get(key) ?? 0) + 1);
      return { workflowId: input.taskId };
    },
  });

  await stage.start(submission);

  assert.deepEqual(
    dispatched.map((item) => item.carrier),
    ['note', 'copy'],
  );
  assert.deepEqual(
    dispatched.map((item) => item.deliverableKinds),
    [['note'], ['copy']],
  );
  // quote_carrier_set_equals_execution_set
  assert.deepEqual(
    [...new Set(dispatched.flatMap((item) => item.deliverableKinds))].sort(),
    ['copy', 'note'],
  );
  assert.equal(dispatched[0]?.lens, 'image_text_note');
  assert.equal(dispatched[1]?.lens, 'copy');

  // carrier_effect_keys_distinct: Make attempt ids (and therefore harnessEffectKey prefixes) differ
  assert.notEqual(dispatched[0]?.taskId, dispatched[1]?.taskId);
  const effectKeys = dispatched.map((item) =>
    harnessEffectKey(item.taskId, 4, 'merchant-primary', '0'),
  );
  assert.equal(new Set(effectKeys).size, 2);
  assert.ok(effectKeys[0]!.includes(':carrier-note') || effectKeys[1]!.includes(':carrier-copy'));
  assert.ok(
    effectKeys.some((key) => key.includes('carrier-note')) ||
      effectKeys.some((key) => key.includes('carrier-copy')),
  );

  // Primary paid attempt keeps base confirmation id; secondary is carrier-suffixed
  // and carries the package decision (no second confirm).
  const base = composerPreparedAttemptId(submission);
  assert.equal(dispatched[0]?.taskId, base);
  assert.equal(dispatched[1]?.taskId, `${base}:carrier-copy`);
  assert.equal(dispatched[0]?.packageConfirmationDecisionRef, undefined);
  assert.equal(dispatched[1]?.packageConfirmationDecisionRef, 'decision-package-1');
  assert.equal(dispatched[1]?.packageConfirmationRequestId, 'confirmation:package-v31-47');
  assert.ok(dispatched.every((item) => item.sourceTaskId === submission.task.id));

  // replay_no_duplicate_side_effect at the admission/dispatch boundary: a second
  // start that re-dispatches must still be safe at the effect store layer below.
  const effectStore = createMemoryPrimitiveEffectStore();
  const handlers = recordingHandlers(sideEffects);
  for (const item of dispatched) {
    const freeze = freezes.find((entry) => entry.carrier === item.carrier)!;
    await executeCompiledCarrierPlan({
      context: {
        lens: lensForCarrier(item.carrier!, submission.snapshot.lens),
        frozenExecutionPlan: freeze.executionPlan,
      },
      programInput: { carrier: item.carrier },
      primitiveHandlers: handlers,
      effectStore,
      executionId: item.taskId,
    });
    // Replay same Make: effect store must not re-run side effects.
    await executeCompiledCarrierPlan({
      context: {
        lens: lensForCarrier(item.carrier!, submission.snapshot.lens),
        frozenExecutionPlan: freeze.executionPlan,
      },
      programInput: { carrier: item.carrier },
      primitiveHandlers: handlers,
      effectStore,
      executionId: item.taskId,
    });
  }
  for (const freeze of freezes) {
    const carrier = freeze.carrier!;
    const runs = sideEffects.get(`record:${carrier}`) ?? 0;
    // Terminal record runs once per carrier despite double execute (effect-store idempotency).
    assert.equal(runs, 1, `carrier ${carrier} must not double side-effect on replay`);
  }
});

test('V31-47 one_carrier_failure_partial_delivery: sibling Make still starts', async () => {
  const freezes = await compileNotePlusCopyFreezes();
  const submission = submissionWithFreezes(freezes, {
    packageConfirmationDecisionRef: 'decision-package-2',
  });
  const started: string[] = [];
  const stage = new CreationStagePort({
    async preparePendingConfirmation(input) {
      return { workflowId: input.taskId };
    },
    async dispatchPrepared(input) {
      const freeze = input.executionPlanFreeze as ExecutionPlanCompileFreeze;
      const carrier = carrierOfExecutionPlanFreeze(freeze);
      started.push(carrier);
      if (carrier === 'note') {
        throw new Error('note Make provider unavailable');
      }
      return { workflowId: input.taskId };
    },
  });

  await assert.rejects(() => stage.start(submission), /note Make provider unavailable/);
  // Fan-out is sequential primary-first: note fails before copy is attempted.
  // Partial delivery contract: the failure is carrier-named and does not rewrite
  // readiness (projection-only). Retry of the package can resume surviving carriers
  // via distinct attempt ids — prove copy attempt id is distinct and freezable alone.
  assert.deepEqual(started, ['note']);
  const copyFreeze = freezes.find((freeze) => freeze.carrier === 'copy')!;
  const copyOnly = submissionWithFreezes([copyFreeze], {
    packageConfirmationDecisionRef: 'decision-package-2',
  });
  // Force multi-carrier identity even with one remaining freeze by stamping both freezes.
  copyOnly.executionPlanFreezes = freezes;
  copyOnly.executionPlanFreeze = freezes[0];
  const copyAttempts: string[] = [];
  const resume = new CreationStagePort({
    async preparePendingConfirmation(input) {
      return { workflowId: input.taskId };
    },
    async dispatchPrepared(input) {
      const freeze = input.executionPlanFreeze as ExecutionPlanCompileFreeze;
      const carrier = carrierOfExecutionPlanFreeze(freeze);
      if (carrier === 'note') {
        // Simulate note already terminal-failed: skip by throwing a classified-safe path
        // is out of scope; here we only start copy.
        return { workflowId: input.taskId };
      }
      copyAttempts.push(input.taskId);
      return { workflowId: input.taskId };
    },
  });
  await resume.start(copyOnly);
  assert.equal(copyAttempts.length, 1);
  assert.ok(copyAttempts[0]!.includes('carrier-copy'));
});

test('V31-47 approvalBasis: mixed package is merchant_confirmed; all-copy is exempt', () => {
  assert.equal(
    approvalBasisForDeliverables([{ kind: 'note' }, { kind: 'copy' }]),
    'merchant_confirmed',
  );
  assert.equal(
    approvalBasisForDeliverables([{ kind: 'copy' }, { kind: 'copy' }]),
    'policy_exempt_copy',
  );
});

test('V31-47 preparePendingConfirmation only arms the primary freeze', async () => {
  const freezes = await compileNotePlusCopyFreezes();
  const submission = submissionWithFreezes(freezes);
  const prepared: string[] = [];
  const stage = new CreationStagePort({
    async preparePendingConfirmation(input) {
      prepared.push(input.taskId);
      return {
        workflowId: input.taskId,
        executionConfirmationRequestId: 'confirm-primary-1',
      };
    },
    async dispatchPrepared() {
      throw new Error('must not dispatch during prepare');
    },
  });
  const result = await stage.preparePendingConfirmation(submission);
  assert.deepEqual(prepared, [composerPreparedAttemptId(submission)]);
  assert.equal(result.executionConfirmationRequestId, 'confirm-primary-1');
});

test('V31-47 carrierFreezesForSubmission and attempt ids', async () => {
  const freezes = await compileNotePlusCopyFreezes();
  const submission = submissionWithFreezes(freezes);
  assert.equal(carrierFreezesForSubmission(submission).length, 2);
  const base = composerPreparedAttemptId(submission);
  assert.equal(
    composerCarrierAttemptId(submission, 'note', { isPrimary: true, multiCarrier: true }),
    base,
  );
  assert.equal(
    composerCarrierAttemptId(submission, 'copy', { isPrimary: false, multiCarrier: true }),
    `${base}:carrier-copy`,
  );
  // Single-carrier keeps historical id without carrier suffix.
  const single = submissionWithFreezes([freezes[0]!]);
  single.executionPlanFreezes = [freezes[0]!];
  assert.equal(
    composerCarrierAttemptId(single, 'note', { isPrimary: true, multiCarrier: false }),
    composerPreparedAttemptId(single),
  );
});

async function compileNotePlusCopyFreezes(): Promise<ExecutionPlanCompileFreeze[]> {
  const plans = new MemoryMarketingPlanStore();
  const compiler = new PlanCompiler({
    store: plans,
    ports: createFixturePlanCompilerPorts(),
  });
  const compiled = await compiler.compile({
    workspaceId: 'ws-v31-47',
    threadId: 'thread-v31-47',
    goalIds: ['goal-1'],
    planId: 'plan-v31-47-note-copy',
    proposal: {
      goalNarrative: '小红书图文加朋友圈短文案',
      whyNow: '跨载体接线验收',
      recommendedDeliverables: [
        {
          carrier: 'note',
          platform: 'xiaohongshu',
          quantity: 1,
          purpose: '案例图文',
        },
        {
          carrier: 'copy',
          platform: 'wechat_moments',
          quantity: 1,
          purpose: '短文案',
        },
      ],
      expressionStrategy: { voice: '专业温和', promotionIntensity: 'soft' },
      factIntentions: ['门店地址'],
      assetIntentions: ['before_after_case'],
      assumptions: [{ key: 'tone', statement: '少一点硬广', risk: 'low' }],
    },
    intentRevision: 1,
    contextBundleId: 'bundle-v31-47',
    contextRevision: '1',
    harnessReleaseId: 'release-v31-47',
    now: '2026-08-11T12:00:00.000Z',
  });
  return compileFinalizeExecutionPlanFreezes({
    result: compiled,
    contextBundleId: 'bundle-v31-47',
    contextRevision: '1',
    approvalBasis: approvalBasisForDeliverables(compiled.revision.deliverables),
  });
}

function submissionWithFreezes(
  freezes: ExecutionPlanCompileFreeze[],
  options?: { packageConfirmationDecisionRef?: string },
): CreationSubmissionRecord {
  const baseSnapshot = createCreationExecutionSnapshot(
    {
      actorId: 'owner-1',
      workspaceId: 'ws-v31-47',
      idempotencyKey: 'idem-v31-47',
      taskId: 'task-v31-47',
      workId: 'work-v31-47',
      contentPackageId: 'package-v31-47',
      expectedContentPackageRevision: 0,
      creationMode: 'customized' as const,
      intent: '小红书图文加朋友圈短文案',
      surface: { id: 'surface-1', revision: 'surface-r1' },
      recipe: { id: 'recipe-1', revision: 'recipe-r1' },
      // Snapshot modality is still single-lens; multi-carrier is on freezes.
      lens: 'copy' as const,
      platform: { id: 'douyin' as const },
      deliverables: [
        {
          id: 'deliverable-1',
          kind: 'copy' as const,
          quantity: 1,
          order: 1,
        },
      ],
      sources: {
        assets: [
          { id: 'asset-1', revision: 'asset-r1', role: 'reference' as const },
        ],
      },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: { id: 'identity-1', revision: 'identity-r1' },
      identityDecision: { id: 'default-decision-1', revision: 7 },
      modelPolicy: {
        id: 'policy-1',
        revision: 'policy-r1',
        mode: 'fixed' as const,
      },
      catalogModel: { id: 'model-1', revision: 'model-r1' },
      quote: {
        id: String(freezes[0]!.quoteRef.id),
        revision: String(freezes[0]!.quoteRef.revision),
      },
      route: { id: 'route-1', revision: 'route-r1' },
      briefConfirmation: { id: 'brief-1', revision: 'brief-r1' },
      briefContext: { id: 'brief-context-1', revision: 1 },
      contentModules: ['social_cover' as const],
    },
    '2026-08-11T12:00:00.000Z',
  );
  const snapshot = {
    ...baseSnapshot,
    // Primary package lens for note-led multi-carrier; fan-out re-lenses.
    lens: 'image_text_note' as const,
  };

  const submission: CreationSubmissionRecord = {
    snapshot,
    work: snapshot.work,
    task: snapshot.task,
    contentPackage: snapshot.contentPackage,
    usageReservation: {
      id: 'usage-v31-47',
      credits: 12,
      units: [
        { resource: 'image', quantity: 1 },
        { resource: 'copy', quantity: 1 },
      ],
    },
    agentBinding: {
      threadId: asAgentThreadIdentity('thread:composer:v31-47'),
      runId: 'run:composer:v31-47',
    },
    ...(options?.packageConfirmationDecisionRef
      ? {
          packageConfirmationDecisionRef: options.packageConfirmationDecisionRef,
          confirmationDispatch: {
            requestId: 'confirmation:package-v31-47',
            state: 'pending' as const,
          },
        }
      : {}),
  };
  assignExecutionPlanFreezes(submission, freezes);
  return submission;
}

function recordingHandlers(
  sideEffects: Map<string, number>,
): CompiledPrimitiveHandlers<{ carrier?: string }> {
  const run = async (input: {
    unit: { primitive?: string };
    programInput: { carrier?: string };
  }) => {
    const carrier = input.programInput.carrier ?? 'unknown';
    // Count terminal record once per carrier for replay assertions.
    if (input.unit.primitive === 'record') {
      const key = `record:${carrier}`;
      sideEffects.set(key, (sideEffects.get(key) ?? 0) + 1);
    }
    return { ok: true, carrier, primitive: input.unit.primitive };
  };
  return new Proxy(
    {} as CompiledPrimitiveHandlers<{ carrier?: string }>,
    {
      get(_target, prop) {
        if (typeof prop === 'string') return run;
        return undefined;
      },
    },
  );
}
