import assert from 'node:assert/strict';
import test from 'node:test';

import {
  candidateBillingDisposition,
  executeCopySelection,
  HarnessSelectionError,
  type CandidatePolicyValidator,
  type CandidateScorer,
} from './execution-selection.js';
import type {
  StructuredNodeRunner,
  StructuredNodeRunnerRequest,
} from '../model-supply/structured-node-runner.js';

test('copy compiler makes one model call and returns one primary candidate', async () => {
  const runner = new QueueRunner([candidate('主推荐', '正文 A', [])]);
  const scorer = new FixedScorer({});

  const result = await executeCopySelection(
    selectionInput(),
    { runner, scorer, validator: new PassValidator() },
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
  assert.deepEqual(
    runner.requests.map((request) => request.productUsageQuantity),
    [1],
  );
  assert.deepEqual(scorer.effectKeys, []);
  assert.match(runner.requests[0]!.instructions, /single primary/iu);
  assert.match(runner.requests[0]!.prompt, /identity-owner-1/u);
  assert.match(runner.requests[0]!.prompt, /xiaohongshu/u);
});

test('one policy failure retries once with feedback and delivers the safe result', async () => {
  const runner = new QueueRunner([
    candidate('主推荐', '正文 A', ['asset-withdrawn']),
    candidate('安全重试', '正文 B', []),
  ]);
  const scorer = new FixedScorer({});

  const result = await executeCopySelection(selectionInput(), {
    runner,
    scorer,
    validator: new WithdrawnAssetValidator(),
  });

  assert.equal(result.winner.candidateId, 'c01-retry');
  assert.deepEqual(result.blockedCandidates, [
    {
      candidateId: 'c01',
      gateIds: ['subject_asset_rights'],
      alternativePath: ['换安全素材', '匿名化', '请求授权', '放弃该表达'],
    },
  ]);
  assert.deepEqual(
    runner.requests.map((request) => request.effectIdempotencyKey),
    [
      'wf:workflow-34:s4:copy-primary:c01',
      'wf:workflow-34:s4:copy-primary:c01-retry',
    ],
  );
  assert.equal(
    new Set(
      runner.requests.map((request) => request.effectIdempotencyKey),
    ).size,
    2,
  );
  assert.deepEqual(
    runner.requests.map((request) => request.productUsageQuantity),
    [1, 0],
  );
  assert.match(runner.requests[1]!.instructions, /Correct every supplied policy failure/u);
  assert.deepEqual(JSON.parse(runner.requests[1]!.prompt).policyFailures, [
    {
      gateId: 'subject_asset_rights',
      reason: '素材授权已撤回',
    },
  ]);
  assert.deepEqual(scorer.effectKeys, []);
});

test('two policy failures stop after one retry with every gate id', async () => {
  const runner = new QueueRunner([
    candidate('主推荐', '正文 A', ['asset-withdrawn']),
    candidate('重试仍不安全', '正文 B', ['asset-medical']),
  ]);
  const scorer = new FixedScorer({});

  await assert.rejects(
    executeCopySelection(selectionInput(), {
      runner,
      scorer,
      validator: new WithdrawnAssetValidator(),
    }),
    (error: unknown) => {
      assert.ok(error instanceof HarnessSelectionError);
      assert.equal(error.status, 409);
      assert.deepEqual(error.gateIds, [
        'subject_asset_rights',
        'medical_claim',
      ]);
      return true;
    },
  );
  assert.equal(runner.requests.length, 2);
  assert.deepEqual(
    runner.requests.map((request) => request.productUsageQuantity),
    [1, 0],
  );
  assert.deepEqual(scorer.effectKeys, []);
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
      scorer: new FixedScorer({}),
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

class FixedScorer implements CandidateScorer {
  readonly effectKeys: string[] = [];

  constructor(private readonly values: Record<string, number>) {}

  async score(input: Parameters<CandidateScorer['score']>[0]) {
    this.effectKeys.push(input.effectIdempotencyKey);
    return {
      score: this.values[input.candidate.candidateId] ?? 0,
      dimensions: { grounding: 1, usefulness: 1, platformFit: 1 },
      reason: '固定测试评分',
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

function selectionInput(): Parameters<typeof executeCopySelection>[0] {
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
