import assert from 'node:assert/strict';
import test from 'node:test';

import {
  candidateBillingDisposition,
  executeCopySelection,
  HarnessSelectionError,
  type CandidatePolicyValidator,
  type CopySelectionInput,
} from './execution-selection.js';
import type {
  StructuredNodeRunner,
  StructuredNodeRunnerRequest,
} from '../model-supply/structured-node-runner.js';
import { ExecutionAttemptBudgetExceeded } from '../model-supply/execution-attempt-budget.js';
import { resumeWithRaisedServerLimit } from './bounded-execution-controller.js';

test('copy compiler makes one model call and returns one primary candidate', async () => {
  const runner = new QueueRunner([candidate('主推荐', '正文 A', [])]);
  const result = await executeCopySelection(
    {
      ...selectionInput(),
      skillInstructions: [
        {
          contentHash: 'hash-execution-skill',
          executionMode: 'prompt_materialized',
          instruction: 'Prefer a calm, evidence-first primary result.',
          skillRevisionRef: 'skill.execution-selection@2',
        },
      ],
    },
    { runner, validator: new PassValidator() },
  );

  assert.equal(result.winner.candidateId, 'c01');
  assert.deepEqual(
    result.scores.map(({ candidateId, score }) => ({ candidateId, score })),
    [{ candidateId: 'c01', score: 0 }],
  );
  assert.equal(result.trace.winnerCandidateId, 'c01');
  assert.equal(result.trace.rubricVersion, 'copy-single-primary-v1');
  assert.match(result.trace.rubricHash, /^[a-f0-9]{64}$/u);
  assert.deepEqual(
    runner.requests.map((request) => request.effectIdempotencyKey),
    ['wf:workflow-34:s4:copy-primary:c01'],
  );
  assert.match(runner.requests[0]!.instructions, /single primary/iu);
  assert.match(
    runner.requests[0]!.instructions,
    /\[skill\.execution-selection@2\] Prefer a calm, evidence-first primary result\./u,
  );
  assert.match(runner.requests[0]!.prompt, /identity-owner-1/u);
  assert.match(runner.requests[0]!.prompt, /xiaohongshu/u);
});

test('copy candidate runner consumes the frozen prompt for primary and retry calls', async () => {
  const runner = new QueueRunner([
    candidate('主推荐', '正文 A', ['asset-withdrawn']),
    candidate('安全重试', '正文 B', []),
  ]);
  const prompt = {
    name: 'harness/copy-candidate',
    version: '7',
    content: 'frozen:copy-candidate',
    contentHash: '7'.repeat(64),
    label: 'production',
    source: 'langfuse' as const,
    isFallback: false,
  };

  await executeCopySelection(
    { ...selectionInput(), prompt },
    {
      runner,
      validator: new WithdrawnAssetValidator(),
    },
  );

  assert.equal(
    runner.requests.every(({ instructions }) =>
      instructions.startsWith('frozen:copy-candidate'),
    ),
    true,
  );
});

test('subject asset rights failure hard-blocks without self-correction', async () => {
  const runner = new QueueRunner([
    candidate('主推荐', '正文 A', ['asset-withdrawn']),
    candidate('安全重试', '正文 B', []),
  ]);
  await assert.rejects(
    executeCopySelection(selectionInput(), {
      runner,
      validator: new WithdrawnAssetValidator(),
    }),
    (error: unknown) => {
      assert.ok(error instanceof HarnessSelectionError);
      assert.equal(error.status, 409);
      assert.deepEqual(error.gateIds, ['subject_asset_rights']);
      assert.equal(error.merchantMessage, '素材授权已撤回');
      return true;
    },
  );
  assert.deepEqual(
    runner.requests.map((request) => request.effectIdempotencyKey),
    ['wf:workflow-34:s4:copy-primary:c01'],
  );
  assert.equal(runner.requests.length, 1);
});

test('non-permission policy failures stop after exactly one self-correction', async () => {
  const runner = new QueueRunner([
    candidate('主推荐', '正文 A', ['asset-medical']),
    candidate('重试仍不安全', '正文 B', ['asset-medical']),
  ]);
  await assert.rejects(
    executeCopySelection(selectionInput(), {
      runner,
      validator: new WithdrawnAssetValidator(),
    }),
    (error: unknown) => {
      assert.ok(error instanceof HarnessSelectionError);
      assert.equal(error.status, 409);
      assert.deepEqual(error.gateIds, ['medical_claim']);
      return true;
    },
  );
  assert.equal(runner.requests.length, 2);
});

test('maxIterations suspends before self-correction and retains the blocked primary as current best', async () => {
  const runner = new QueueRunner([
    candidate('主推荐', '正文 A', ['asset-medical']),
    candidate('不应执行的重试', '正文 B', []),
  ]);

  const result = await executeCopySelection(
    {
      ...selectionInput(),
      boundedExecution: {
        schemaVersion: 'bounded-execution-snapshot/v1',
        maxIterations: 1,
        maxCostCents: 'unset',
        maxWallClockMs: 'unset',
        maxDelegations: 'unset',
        requiredLimits: ['maxIterations'],
        consumption: {
          iterations: 0,
          costCents: 0,
          wallClockMs: 0,
          delegations: 0,
        },
        stopReason: null,
        triggeredLimit: null,
      },
    },
    {
      runner,
      validator: new WithdrawnAssetValidator(),
    },
  );

  assert.equal('state' in result && result.state, 'suspended');
  if (!('state' in result) || result.state !== 'suspended') return;
  assert.equal(result.snapshot.triggeredLimit, 'maxIterations');
  assert.equal(result.snapshot.consumption.iterations, 1);
  assert.equal(result.currentBest.deliverable, false);
  assert.ok(result.currentBest.candidate);
  assert.equal(result.currentBest.candidate.title, '主推荐');
  assert.deepEqual(result.currentBest.policyFailures, [
    {
      gateId: 'medical_claim',
      reason: '文案包含未核验医疗宣称',
      alternativePath: ['改用生活化体验描述'],
    },
  ]);
  assert.equal(result.resumable, true);
  assert.equal(runner.requests.length, 1);
});

test('raised maxIterations resumes from the blocked primary without replaying it', async () => {
  const runner = new QueueRunner([
    candidate('主推荐', '正文 A', ['asset-medical']),
    candidate('安全修正版', '正文 B', []),
  ]);
  const boundedExecution = {
    schemaVersion: 'bounded-execution-snapshot/v1' as const,
    maxIterations: 1,
    maxCostCents: 'unset' as const,
    maxWallClockMs: 'unset' as const,
    maxDelegations: 'unset' as const,
    requiredLimits: ['maxIterations' as const],
    consumption: {
      iterations: 0,
      costCents: 0,
      wallClockMs: 0,
      delegations: 0,
    },
    stopReason: null,
    triggeredLimit: null,
  };
  const suspended = await executeCopySelection(
    { ...selectionInput(), boundedExecution },
    {
      runner,
      validator: new WithdrawnAssetValidator(),
    },
  );
  assert.equal('state' in suspended && suspended.state, 'suspended');
  if (!('state' in suspended) || suspended.state !== 'suspended') return;

  const resumed = await executeCopySelection(
    {
      ...selectionInput(),
      boundedExecution: resumeWithRaisedServerLimit(suspended.snapshot, {
        limit: 'maxIterations',
        value: 2,
      }),
      resumeFrom: suspended.currentBest,
    },
    {
      runner,
      validator: new WithdrawnAssetValidator(),
    },
  );

  assert.equal('state' in resumed, false);
  if ('state' in resumed) return;
  assert.equal(resumed.winner.title, '安全修正版');
  assert.equal(resumed.boundedExecution?.consumption.iterations, 2);
  assert.deepEqual(
    runner.requests.map(({ effectIdempotencyKey }) => effectIdempotencyKey),
    [
      'wf:workflow-34:s4:copy-primary:c01',
      'wf:workflow-34:s4:copy-primary:c01-retry',
    ],
  );
});

test('maxIterations suspends without a draft when schema repair exhausts the first attempt', async () => {
  const runner = new BudgetThenQueueRunner([
    candidate('抬限后的主推荐', '正文 A', []),
  ]);
  const boundedExecution = {
    schemaVersion: 'bounded-execution-snapshot/v1' as const,
    maxIterations: 1,
    maxCostCents: 'unset' as const,
    maxWallClockMs: 'unset' as const,
    maxDelegations: 'unset' as const,
    requiredLimits: ['maxIterations' as const],
    consumption: {
      iterations: 0,
      costCents: 0,
      wallClockMs: 0,
      delegations: 0,
    },
    stopReason: null,
    triggeredLimit: null,
  };

  const suspended = await executeCopySelection(
    { ...selectionInput(), boundedExecution },
    { runner, validator: new PassValidator() },
  );

  assert.equal('state' in suspended && suspended.state, 'suspended');
  if (!('state' in suspended) || suspended.state !== 'suspended') return;
  assert.equal(suspended.currentBest.candidate, null);
  assert.match(suspended.unmetExplanation, /尚未产出可校验草稿/u);

  const resumed = await executeCopySelection(
    {
      ...selectionInput(),
      boundedExecution: resumeWithRaisedServerLimit(suspended.snapshot, {
        limit: 'maxIterations',
        value: 2,
      }),
      resumeFrom: suspended.currentBest,
    },
    { runner, validator: new PassValidator() },
  );

  assert.equal('state' in resumed, false);
  if ('state' in resumed) return;
  assert.equal(resumed.winner.title, '抬限后的主推荐');
  assert.equal(resumed.boundedExecution?.consumption.iterations, 2);
});

test('copy generation publishes append-only semantic deltas for the primary candidate', async () => {
  const emitted: Array<{
    candidateId: string;
    channel: 'copy.title' | 'copy.body' | 'copy.cta';
    delta: string;
  }> = [];
  const runner = new StreamingQueueRunner([
    candidate('候选 A', '正文 A', []),
  ]);

  await executeCopySelection(
    {
      ...selectionInput(),
      onToken: async (token) => {
        emitted.push(token);
      },
    },
    {
      runner,
      validator: new PassValidator(),
    },
  );

  assert.deepEqual(emitted.slice(0, 4), [
    { candidateId: 'c01', channel: 'copy.title', delta: '候选' },
    { candidateId: 'c01', channel: 'copy.title', delta: ' A' },
    { candidateId: 'c01', channel: 'copy.body', delta: '正文 A' },
    { candidateId: 'c01', channel: 'copy.cta', delta: '私信预约' },
  ]);
  assert.deepEqual(
    [...new Set(emitted.map(({ candidateId }) => candidateId))],
    ['c01'],
  );
});

test('acceptance and cancellation matrix never refunds an uncertain effect', () => {
  assert.equal(
    candidateBillingDisposition({
      acceptance: 'rejected_before_accept',
      cancellation: 'not_requested',
    }),
    'refund',
  );
  assert.equal(
    candidateBillingDisposition({
      acceptance: 'accepted',
      cancellation: 'unconfirmed',
    }),
    'reconcile',
  );
  assert.equal(
    candidateBillingDisposition({
      acceptance: 'acceptance_unknown',
      cancellation: 'not_requested',
    }),
    'reconcile',
  );
  assert.equal(
    candidateBillingDisposition({
      acceptance: 'accepted',
      cancellation: 'confirmed',
    }),
    'settle_terminal',
  );
});

class QueueRunner implements StructuredNodeRunner {
  readonly requests: StructuredNodeRunnerRequest<unknown>[] = [];

  constructor(private readonly outputs: unknown[]) {}

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    this.requests.push(request as StructuredNodeRunnerRequest<unknown>);
    return {
      output: request.schema.parse(this.outputs.shift()),
      attempts: 1,
      providerTaskRef: `provider-${this.requests.length}`,
      replayed: false,
      usage: { inputTokens: 5, outputTokens: 8 },
    };
  }
}

class BudgetThenQueueRunner extends QueueRunner {
  private exhausted = false;

  override async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    if (!this.exhausted) {
      this.exhausted = true;
      throw new ExecutionAttemptBudgetExceeded(1, 1);
    }
    return super.run(request);
  }
}

class StreamingQueueRunner implements StructuredNodeRunner {
  constructor(private readonly outputs: unknown[]) {}

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    const output = request.schema.parse(this.outputs.shift());
    const partial = request.onPartialOutput;
    if (partial) {
      const candidate = output as {
        title: string;
        body: string;
        conversionHook: string;
      };
      await partial({ title: candidate.title.slice(0, 2) });
      await partial(candidate);
    }
    return {
      output,
      attempts: 1,
      providerTaskRef: 'provider-streaming',
      replayed: false,
      usage: { inputTokens: 5, outputTokens: 8 },
    };
  }
}

class PassValidator implements CandidatePolicyValidator {
  validate() {
    return { passed: true, failures: [] };
  }
}

class WithdrawnAssetValidator implements CandidatePolicyValidator {
  validate(candidate: Parameters<CandidatePolicyValidator['validate']>[0]) {
    if (candidate.assetRefs.includes('asset-medical')) {
      return {
        passed: false,
        failures: [
          {
            gateId: 'medical_claim',
            reason: '文案包含未核验医疗宣称',
            alternativePath: ['改用生活化体验描述'],
          },
        ],
      };
    }
    if (!candidate.assetRefs.includes('asset-withdrawn')) {
      return { passed: true, failures: [] };
    }
    return {
      passed: false,
      failures: [
        {
          gateId: 'subject_asset_rights',
          reason: '素材授权已撤回',
          alternativePath: ['换安全素材', '匿名化', '请求授权', '放弃该表达'],
        },
      ],
    };
  }
}

function candidate(title: string, body: string, assetRefs: string[]) {
  return {
    title,
    body,
    conversionHook: '私信预约',
    factClaims: [],
    assetRefs,
    expressionIdentityRef: 'identity-owner-1',
  };
}

function selectionInput(): CopySelectionInput {
  return {
    workflowId: 'workflow-34',
    unitId: 'copy-primary',
    brief: {
      kind: 'copy' as const,
      instructions: '基于已确认事实写一条项目曝光文案。',
      platform: 'xiaohongshu' as const,
      cta: '私信预约',
      factRefs: [],
      assetRefs: [],
      identityRefs: ['identity-owner-1'],
      constraints: ['不得编造事实'],
    },
    workspaceId: 'workspace-1',
    intendedUse: 'public_content' as const,
    generationContext: {
      bundle: { workspaceId: 'workspace-1', revision: 1 },
      sourceRefs: [],
      rightsRefs: [],
      identityRefs: [{ id: 'identity-owner-1', status: 'registered' }],
    },
  };
}
