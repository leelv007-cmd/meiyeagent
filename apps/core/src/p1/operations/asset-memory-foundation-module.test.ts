import assert from 'node:assert/strict';
import test from 'node:test';

import type { P1Context } from '../foundation/domain.js';
import { AssetMemoryFoundationModule } from './asset-memory-foundation-module.js';
import {
  AssetIntakeService,
  MemoryAssetIntakeRepository,
} from './asset-intake-service.js';
import { MemoryContextBundleRepository } from './context-bundle-repository.js';
import {
  MemoryReuseMemoryRepository,
  ReuseMemoryService,
} from './reuse-memory-service.js';
import { MemoryStoreFactLedger } from './store-fact-ledger.js';

const now = '2026-07-18T06:00:00.000Z';
const context: P1Context = {
  actor: 'owner',
  correlationId: 'correlation-a',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

test('asset-memory module exposes fact intake with server-owned workspace and append-only decisions', async () => {
  const module = moduleFixture();
  const recorded = await module.execute({
    context,
    idempotencyKey: 'record-batch',
    input: {
      action: 'record_asset_intake_batch',
      payload: intakeBatch(),
    },
  });
  assert.equal(
    (recorded as { workspaceId: string }).workspaceId,
    'workspace-a',
  );
  const correctedFact = {
    ...intakeBatch().candidates[0]!.fact,
    value: { amount: 299, currency: 'CNY' },
    source: {
      kind: 'user_confirmation' as const,
      referenceId: 'decision-correct',
      capturedAt: now,
    },
  };
  await module.execute({
    context,
    idempotencyKey: 'correct-price',
    input: {
      action: 'correct_asset_intake_fact',
      payload: {
        batchId: 'batch-a',
        candidateId: 'candidate-price',
        correctedFact,
      },
    },
  });
  const fact = await module.execute({
    context,
    idempotencyKey: 'confirm-price',
    input: {
      action: 'confirm_asset_intake_fact',
      payload: {
        batchId: 'batch-a',
        candidateId: 'candidate-price',
        factId: 'fact-price',
        expectedFactRevision: 0,
      },
    },
  });
  assert.deepEqual((fact as { value: unknown }).value, {
    amount: 299,
    currency: 'CNY',
  });
  const view = (await module.query({
    context,
    input: { action: 'asset_intake_view', payload: { batchId: 'batch-a' } },
  })) as {
    decisions: Array<{ action: string }>;
    capability: { status: string };
  };
  assert.deepEqual(
    view.decisions.map((decision) => decision.action),
    ['corrected', 'confirmed'],
  );
  assert.equal(view.capability.status, 'assisted');
});

test('all assisted inputs prepare a preview and confirm an exact fact revision', async () => {
  const module = moduleFixture();
  const modes = [
    {
      inputMode: 'screenshot' as const,
      screenshotAssetId: 'asset-price-list',
      recognizedText: '头疗团购价 239 元',
    },
    {
      inputMode: 'paste_text' as const,
      pastedText: '头疗团购价 ￥239',
    },
    {
      inputMode: 'manual_select' as const,
      amount: 239,
    },
  ];
  for (const [index, assisted] of modes.entries()) {
    const suffix = String(index + 1);
    const batchId = `batch-assisted-${suffix}`;
    const candidateId = `candidate-assisted-${suffix}`;
    const prepared = (await module.execute({
      context,
      idempotencyKey: `prepare-assisted-${suffix}`,
      input: {
        action: 'prepare_assisted_price_intake',
        payload: {
          batchId,
          taskId: `task-assisted-${suffix}`,
          candidateId,
          key: 'service.scalp-clean.price',
          scope: { storeId: 'store-a', serviceId: 'scalp-clean' },
          effectiveFrom: now,
          expiresAt: null,
          ...assisted,
        },
      },
    })) as {
      candidates: Array<{
        fact: { value: unknown; source: { referenceId: string } };
      }>;
      source: { kind: string };
    };
    assert.deepEqual(prepared.candidates[0]?.fact.value, {
      amount: 239,
      currency: 'CNY',
    });
    assert.ok(prepared.candidates[0]?.fact.source.referenceId);

    const fact = (await module.execute({
      context,
      idempotencyKey: `confirm-assisted-${suffix}`,
      input: {
        action: 'confirm_asset_intake_fact',
        payload: {
          batchId,
          candidateId,
          factId: `fact-assisted-${suffix}`,
          expectedFactRevision: 0,
        },
      },
    })) as { revision: number; value: unknown };
    assert.equal(fact.revision, 1);
    assert.deepEqual(fact.value, { amount: 239, currency: 'CNY' });
  }
});

test('assisted screenshot direct commands reject missing and cross-workspace assets', async () => {
  const module = moduleFixture();
  for (const [suffix, screenshotAssetId] of [
    ['missing', 'asset-missing'],
    ['cross-workspace', 'asset-owned-by-workspace-b'],
  ]) {
    await assert.rejects(
      module.execute({
        context,
        idempotencyKey: `prepare-assisted-${suffix}`,
        input: {
          action: 'prepare_assisted_price_intake',
          payload: {
            batchId: `batch-assisted-${suffix}`,
            taskId: `task-assisted-${suffix}`,
            candidateId: `candidate-assisted-${suffix}`,
            key: 'service.scalp-clean.price',
            scope: { storeId: 'store-a', serviceId: 'scalp-clean' },
            effectiveFrom: now,
            expiresAt: null,
            inputMode: 'screenshot',
            screenshotAssetId,
            recognizedText: '头疗团购价 239 元',
          },
        },
      }),
      /authorized asset in this workspace/u,
    );
  }
});

test('batch creation replays after the server clock advances', async () => {
  let tick = 0;
  const clock = () =>
    new Date(Date.parse(now) + tick++ * 1_000).toISOString();
  const module = moduleFixture(undefined, clock);
  const record = {
    context,
    idempotencyKey: 'record-batch-recovery',
    input: {
      action: 'record_asset_intake_batch',
      payload: intakeBatch(),
    },
  };
  const firstRecorded = await module.execute(record);
  const replayedRecorded = await module.execute(record);
  assert.deepEqual(replayedRecorded, firstRecorded);

  const assisted = {
    context,
    idempotencyKey: 'prepare-assisted-recovery',
    input: {
      action: 'prepare_assisted_price_intake',
      payload: {
        batchId: 'batch-assisted-recovery',
        taskId: 'task-assisted-recovery',
        candidateId: 'candidate-assisted-recovery',
        key: 'service.scalp-clean.price',
        scope: { storeId: 'store-a', serviceId: 'scalp-clean' },
        effectiveFrom: now,
        expiresAt: null,
        inputMode: 'paste_text',
        pastedText: '头疗团购价 239 元',
      },
    },
  };
  const firstAssisted = await module.execute(assisted);
  const replayedAssisted = await module.execute(assisted);
  assert.deepEqual(replayedAssisted, firstAssisted);
});

test('asset-memory module creates a content-free reuse Task from an exact AssetRevision', async () => {
  const submissions: unknown[] = [];
  const module = moduleFixture({
    async submit(input) {
      submissions.push(input);
      return { workflowId: input.taskId, packageId: input.packageId };
    },
  });
  await module.execute({
    context,
    idempotencyKey: 'propose-series',
    input: {
      action: 'propose_reusable_asset',
      payload: reusableProposal(),
    },
  });
  await module.execute({
    context,
    idempotencyKey: 'confirm-series',
    input: {
      action: 'confirm_reusable_asset',
      payload: {
        candidateId: 'candidate-series',
        expectedAssetRevision: 0,
        revisionId: 'series-a:1',
        nextSuggestions: [
          {
            suggestionId: 'suggestion-a',
            explanation: '按当前价格续写下一条。',
            variableSlotKeys: ['offer.price'],
          },
        ],
      },
    },
  });
  const result = await module.execute({
    context,
    idempotencyKey: 'reuse-task',
    input: {
      action: 'create_reuse_task',
      payload: {
        taskId: 'task-reuse-a',
        assetId: 'series-a',
        assetRevision: 1,
        assetIds: ['asset-current'],
        suggestionId: 'suggestion-a',
        rawInput: '沿用这个系列结构，按当前门店事实写下一条。',
      },
    },
  });
  assert.deepEqual(result, {
    workflowId: 'task-reuse-a',
    packageId: 'reuse-task-reuse-a',
  });
  const submission = submissions[0] as {
    assetIds: string[];
    seed: Record<string, unknown>;
    suggestion: { suggestionId: string };
  };
  assert.equal(submission.seed.sourcePackageId, 'package-a');
  assert.equal(submission.seed.sourceVersionId, 'version-a');
  assert.deepEqual(submission.assetIds, ['asset-current']);
  assert.equal(submission.suggestion.suggestionId, 'suggestion-a');
  for (const forbidden of ['body', 'title', 'topics', 'orderedAssetIds']) {
    assert.equal(forbidden in submission.seed, false);
  }
});

test('asset-memory module promotes only three independent modification signals and keeps the preference inactive', async () => {
  const module = moduleFixture();
  let candidateId = '';
  for (const suffix of ['a', 'b', 'c']) {
    const result = (await module.execute({
      context,
      idempotencyKey: `signal-${suffix}`,
      input: {
        action: 'record_preference_signal',
        payload: {
          signalId: `signal-${suffix}`,
          decisionId: `decision-${suffix}`,
          taskId: `task-${suffix}`,
          semanticKey: 'tone.less-promotional',
          value: true,
          defaultScope: { storeId: 'store-a' },
          kind: 'modified',
        },
      },
    })) as { candidate: { candidateId: string } | null };
    if (result.candidate) candidateId = result.candidate.candidateId;
  }
  assert.ok(candidateId);
  const preference = await module.execute({
    context,
    idempotencyKey: 'confirm-preference',
    input: {
      action: 'confirm_preference',
      payload: {
        candidateId,
        preferenceId: 'preference-a',
        expectedRevision: 0,
        positiveExamples: ['克制表达'],
        negativeExamples: ['限时疯抢'],
      },
    },
  });
  assert.equal((preference as { status: string }).status, 'inactive_stage2');
  const view = (await module.query({
    context,
    input: { action: 'preference_view', payload: {} },
  })) as { signals: unknown[]; preferences: Array<{ status: string }> };
  assert.equal(view.signals.length, 3);
  assert.deepEqual(
    view.preferences.map((item) => item.status),
    ['inactive_stage2'],
  );
});

function moduleFixture(
  reuseTasks?: ConstructorParameters<typeof AssetMemoryFoundationModule>[3],
  clock: () => string = () => now,
) {
  return new AssetMemoryFoundationModule(
    new AssetIntakeService(
      new MemoryAssetIntakeRepository(),
      new MemoryStoreFactLedger(),
      clock,
      {
        async isAuthorized(workspaceId, assetId) {
          return new Set([
            'workspace-a:asset-price-list',
            'workspace-b:asset-owned-by-workspace-b',
          ]).has(`${workspaceId}:${assetId}`);
        },
      },
    ),
    new MemoryContextBundleRepository(),
    new ReuseMemoryService(
      new MemoryReuseMemoryRepository(),
      { verifyCandidate: async () => {}, verifyRevision: async () => {} },
      () => now,
    ),
    reuseTasks,
    clock,
  );
}

function intakeBatch() {
  return {
    batchId: 'batch-a',
    taskId: 'task-a',
    source: {
      sourceId: 'source-a',
      kind: 'price_list' as const,
      referenceId: 'upload-a',
      capabilityStatus: 'assisted' as const,
      sourceWorkspaceId: 'workspace-a',
      capturedAt: now,
      example: false,
    },
    summary: '识别到一个待确认项目价格。',
    candidates: [
      {
        candidateId: 'candidate-price',
        objectKind: 'store_fact' as const,
        status: 'pending' as const,
        fact: {
          kind: 'price' as const,
          key: 'offer.price',
          value: { amount: 239, currency: 'CNY' },
          scope: { storeId: 'store-a' },
          source: {
            kind: 'screenshot_extraction' as const,
            referenceId: 'upload-a',
            capturedAt: now,
          },
          effectiveFrom: now,
          expiresAt: null,
        },
      },
    ],
  };
}

function reusableProposal() {
  return {
    candidateId: 'candidate-series',
    assetId: 'series-a',
    kind: 'series' as const,
    name: '三段式系列',
    fixedItems: [
      {
        key: 'structure.three-part',
        value: ['experience', 'evidence', 'cta'],
        sourceRef: 'package-a:version-a',
      },
    ],
    variableSlots: [
      { key: 'offer.price', source: 'current_fact' as const, required: true },
    ],
    defaultScope: { storeId: 'store-a' },
    provenance: {
      sourcePackageId: 'package-a',
      sourceVersionId: 'version-a',
      sourcePackageRevision: 3,
      contextBundleId: 'bundle-a',
      contextBundleRevision: 1,
    },
    rights: { assetIds: [], status: 'authorized' as const },
  };
}
