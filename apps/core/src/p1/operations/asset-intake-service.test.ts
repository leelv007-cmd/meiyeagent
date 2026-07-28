import assert from 'node:assert/strict';
import test from 'node:test';
import type { AssetIntakeBatch, ContextBundle } from '@meiye/contracts';
import {
  AssetIntakeError,
  AssetIntakeService,
  confirmedFactReferenceFromBundle,
  MemoryAssetIntakeRepository,
} from './asset-intake-service.js';
import { MemoryContextBundleRepository } from './context-bundle-repository.js';
import { ContextFoundationModule } from './context-foundation-module.js';
import { MemoryContextSourceRevisionRepository } from './context-source-revisions.js';
import {
  MemoryStoreFactLedger,
  StoreFactRevisionConflictError,
} from './store-fact-ledger.js';

const context = {
  workspaceId: 'workspace-a',
  userId: 'owner-a',
};

function batch(overrides: Partial<AssetIntakeBatch> = {}): AssetIntakeBatch {
  return {
    batchId: 'batch-a',
    workspaceId: context.workspaceId,
    taskId: 'task-a',
    source: {
      sourceId: 'source-price-list',
      kind: 'price_list',
      referenceId: 'upload-price-list',
      capabilityStatus: 'assisted',
      sourceWorkspaceId: context.workspaceId,
      capturedAt: '2026-07-18T01:00:00.000Z',
      example: false,
    },
    summary: '识别到头皮清洁项目价格。',
    candidates: [
      {
        candidateId: 'candidate-price',
        objectKind: 'store_fact',
        status: 'pending',
        fact: {
          kind: 'price',
          key: 'service.scalp-clean.price',
          value: { amount: 199, currency: 'CNY' },
          scope: { storeId: 'store-a', serviceId: 'scalp-clean' },
          source: {
            kind: 'screenshot_extraction',
            referenceId: 'upload-price-list',
            capturedAt: '2026-07-18T01:00:00.000Z',
          },
          effectiveFrom: '2026-07-18T01:00:00.000Z',
          expiresAt: null,
        },
      },
    ],
    createdAt: '2026-07-18T01:00:01.000Z',
    ...overrides,
  };
}

test('confirm and correct append exact StoreFact revisions without leaving the old value active', async () => {
  const ledger = new MemoryStoreFactLedger();
  const service = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    ledger,
    () => '2026-07-18T02:00:00.000Z',
  );
  await service.recordBatch(batch());

  const first = await service.confirmFact(context, {
    batchId: 'batch-a',
    candidateId: 'candidate-price',
    factId: 'fact-price',
    expectedFactRevision: 0,
    idempotencyKey: 'confirm-price-a',
  });
  assert.equal(first.revision, 1);
  assert.deepEqual(first.value, { amount: 199, currency: 'CNY' });
  assert.deepEqual(
    await service.confirmFact(context, {
      batchId: 'batch-a',
      candidateId: 'candidate-price',
      factId: 'fact-price',
      expectedFactRevision: 0,
      idempotencyKey: 'confirm-price-a',
    }),
    first,
  );
  await assert.rejects(
    service.confirmFact(context, {
      batchId: 'batch-a',
      candidateId: 'candidate-price',
      factId: 'fact-price',
      expectedFactRevision: 1,
      idempotencyKey: 'confirm-price-without-correction',
    }),
    (error: unknown) =>
      error instanceof AssetIntakeError && error.code === 'DECISION_CONFLICT',
  );

  await service.correctFact(context, {
    batchId: 'batch-a',
    candidateId: 'candidate-price',
    correctedFact: {
      kind: 'price',
      key: 'service.scalp-clean.price',
      value: { amount: 239, currency: 'CNY' },
      scope: { storeId: 'store-a', serviceId: 'scalp-clean' },
      source: {
        kind: 'user_confirmation',
        referenceId: 'decision-price-b',
        capturedAt: '2026-07-18T02:00:00.000Z',
      },
      effectiveFrom: '2026-07-18T02:00:00.000Z',
      expiresAt: null,
    },
    idempotencyKey: 'correct-price-b',
  });
  const second = await service.confirmFact(context, {
    batchId: 'batch-a',
    candidateId: 'candidate-price',
    factId: 'fact-price',
    expectedFactRevision: 1,
    idempotencyKey: 'confirm-price-b',
  });
  assert.equal(second.revision, 2);

  const active = await ledger.listActive({
    workspaceId: context.workspaceId,
    scope: { storeId: 'store-a', serviceId: 'scalp-clean' },
    at: '2026-07-18T03:00:00.000Z',
  });
  assert.equal(active.length, 1);
  assert.deepEqual(active[0]?.value, { amount: 239, currency: 'CNY' });
  assert.deepEqual(
    (await ledger.history(context.workspaceId, 'fact-price')).map((fact) => [
      fact.revision,
      fact.value,
    ]),
    [
      [1, { amount: 199, currency: 'CNY' }],
      [2, { amount: 239, currency: 'CNY' }],
    ],
  );

  const contextModule = new ContextFoundationModule(
    ledger,
    new MemoryContextBundleRepository(),
    new MemoryContextSourceRevisionRepository(),
    () => '2026-07-18T03:00:00.000Z',
  );
  const bundle = (await contextModule.execute({
    context: { ...context, actor: 'owner', correlationId: 'compile-after-fix' },
    idempotencyKey: 'compile-after-fix',
    input: {
      action: 'context_bundle_compile',
      payload: {
        bundleId: 'bundle-after-fix',
        taskId: 'task-after-fix',
        scope: { storeId: 'store-a', serviceId: 'scalp-clean' },
        at: '2026-07-18T03:00:00.000Z',
        expectedRevision: 0,
        contributions: [],
        reason: 'new task after fact correction',
      },
    },
  })) as ContextBundle;
  assert.deepEqual(confirmedFactReferenceFromBundle(second, bundle), {
    factId: 'fact-price',
    factRevision: 2,
    taskId: 'task-after-fix',
    contextBundleId: 'bundle-after-fix',
    contextBundleRevision: 1,
  });
  assert.equal(JSON.stringify(bundle).includes('199'), false);
  assert.equal(JSON.stringify(bundle).includes('239'), true);
});

test('example and cross-workspace sources cannot write the user fact ledger', async () => {
  const ledger = new MemoryStoreFactLedger();
  const service = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    ledger,
  );
  await service.recordBatch(
    batch({
      batchId: 'batch-example',
      source: {
        ...batch().source,
        sourceWorkspaceId: 'workspace-example',
        example: true,
      },
    }),
  );

  await assert.rejects(
    service.confirmFact(context, {
      batchId: 'batch-example',
      candidateId: 'candidate-price',
      factId: 'fact-example',
      expectedFactRevision: 0,
      idempotencyKey: 'confirm-example',
    }),
    (error: unknown) =>
      error instanceof AssetIntakeError &&
      error.code === 'EXAMPLE_FACT_ISOLATION',
  );
  assert.deepEqual(
    await ledger.history(context.workspaceId, 'fact-example'),
    [],
  );
});

test('missing fact keys only reports incremental gaps and never repeats active facts', async () => {
  const ledger = new MemoryStoreFactLedger();
  const service = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    ledger,
    () => '2026-07-18T02:00:00.000Z',
  );
  await service.recordBatch(batch());
  await service.confirmFact(context, {
    batchId: 'batch-a',
    candidateId: 'candidate-price',
    factId: 'fact-price',
    expectedFactRevision: 0,
    idempotencyKey: 'confirm-price',
  });

  const contextModule = new ContextFoundationModule(
    ledger,
    new MemoryContextBundleRepository(),
    new MemoryContextSourceRevisionRepository(),
    () => '2026-07-18T03:00:00.000Z',
  );
  const bundle = (await contextModule.execute({
    context: { ...context, actor: 'owner', correlationId: 'compile-gaps' },
    idempotencyKey: 'compile-gaps',
    input: {
      action: 'context_bundle_compile',
      payload: {
        bundleId: 'bundle-gaps',
        taskId: 'task-gaps',
        scope: { storeId: 'store-a', serviceId: 'scalp-clean' },
        at: '2026-07-18T03:00:00.000Z',
        expectedRevision: 0,
        contributions: [],
        reason: 'calculate gaps from the frozen bundle',
      },
    },
  })) as ContextBundle;

  assert.deepEqual(
    service.missingFactKeys({
      bundle,
      requiredKeys: [
        'service.scalp-clean.price',
        'service.scalp-clean.duration',
        'service.scalp-clean.price',
      ],
    }),
    ['service.scalp-clean.duration'],
  );
});

test('fact confirmation recovery is bound to the original idempotency key', async () => {
  class FailOnceRepository extends MemoryAssetIntakeRepository {
    fail = true;

    override async appendDecision(
      input: Parameters<MemoryAssetIntakeRepository['appendDecision']>[0],
    ) {
      if (this.fail && input.event.action === 'confirmed') {
        this.fail = false;
        throw new Error('simulated decision persistence failure');
      }
      return super.appendDecision(input);
    }
  }

  const repository = new FailOnceRepository();
  const ledger = new MemoryStoreFactLedger();
  const service = new AssetIntakeService(repository, ledger);
  await service.recordBatch(batch());
  const confirmation = {
    batchId: 'batch-a',
    candidateId: 'candidate-price',
    factId: 'fact-price',
    expectedFactRevision: 0,
    idempotencyKey: 'confirm-original',
  };
  await assert.rejects(service.confirmFact(context, confirmation), /simulated/);
  assert.equal((await ledger.history(context.workspaceId, 'fact-price')).length, 1);
  await assert.rejects(
    service.confirmFact(context, {
      ...confirmation,
      idempotencyKey: 'confirm-competing',
    }),
    (error: unknown) =>
      error instanceof AssetIntakeError && error.code === 'DECISION_CONFLICT',
  );
  const replay = await service.confirmFact(context, confirmation);
  assert.equal(replay.revision, 1);
  assert.equal((await ledger.history(context.workspaceId, 'fact-price')).length, 1);
});

test('candidate generation admits only one concurrent confirmation across fact ids', async () => {
  const ledger = new MemoryStoreFactLedger();
  const service = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    ledger,
  );
  await service.recordBatch(batch());
  const attempts = await Promise.allSettled([
    service.confirmFact(context, {
      batchId: 'batch-a',
      candidateId: 'candidate-price',
      factId: 'fact-price-a',
      expectedFactRevision: 0,
      idempotencyKey: 'confirm-candidate-a',
    }),
    service.confirmFact(context, {
      batchId: 'batch-a',
      candidateId: 'candidate-price',
      factId: 'fact-price-b',
      expectedFactRevision: 0,
      idempotencyKey: 'confirm-candidate-b',
    }),
  ]);
  assert.deepEqual(
    attempts.map((attempt) => attempt.status).sort(),
    ['fulfilled', 'rejected'],
  );
  assert.equal(
    (await ledger.history(context.workspaceId, 'fact-price-a')).length +
      (await ledger.history(context.workspaceId, 'fact-price-b')).length,
    1,
  );
});

test('a corrected candidate remains bound to its first confirmed fact stream', async () => {
  const ledger = new MemoryStoreFactLedger();
  const service = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    ledger,
  );
  await service.recordBatch(batch());
  await service.confirmFact(context, {
    batchId: 'batch-a',
    candidateId: 'candidate-price',
    factId: 'fact-price-a',
    expectedFactRevision: 0,
    idempotencyKey: 'confirm-price-a-r1',
  });
  await service.correctFact(context, {
    batchId: 'batch-a',
    candidateId: 'candidate-price',
    correctedFact: {
      kind: 'price',
      key: 'service.scalp-clean.price',
      value: { amount: 239, currency: 'CNY' },
      scope: { storeId: 'store-a', serviceId: 'scalp-clean' },
      source: {
        kind: 'user_confirmation',
        referenceId: 'correct-price-to-239',
        capturedAt: '2026-07-18T02:00:00.000Z',
      },
      effectiveFrom: '2026-07-18T02:00:00.000Z',
      expiresAt: null,
    },
    idempotencyKey: 'correct-price-to-239',
  });

  await assert.rejects(
    service.confirmFact(context, {
      batchId: 'batch-a',
      candidateId: 'candidate-price',
      factId: 'fact-price-b',
      expectedFactRevision: 0,
      idempotencyKey: 'switch-price-stream',
    }),
    (error: unknown) =>
      error instanceof AssetIntakeError && error.code === 'DECISION_CONFLICT',
  );
  const corrected = await service.confirmFact(context, {
    batchId: 'batch-a',
    candidateId: 'candidate-price',
    factId: 'fact-price-a',
    expectedFactRevision: 1,
    idempotencyKey: 'confirm-price-a-r2',
  });
  assert.equal(corrected.revision, 2);
  assert.deepEqual(corrected.value, { amount: 239, currency: 'CNY' });
  assert.deepEqual(await ledger.history(context.workspaceId, 'fact-price-b'), []);
});

test('candidate generation serializes correction against confirmation', async () => {
  const ledger = new MemoryStoreFactLedger();
  const service = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    ledger,
  );
  await service.recordBatch(batch());
  const attempts = await Promise.allSettled([
    service.correctFact(context, {
      batchId: 'batch-a',
      candidateId: 'candidate-price',
      correctedFact: {
        kind: 'price',
        key: 'service.scalp-clean.price',
        value: { amount: 239, currency: 'CNY' },
        scope: { storeId: 'store-a', serviceId: 'scalp-clean' },
        source: {
          kind: 'user_confirmation',
          referenceId: 'decision-concurrent-correction',
          capturedAt: '2026-07-18T02:00:00.000Z',
        },
        effectiveFrom: '2026-07-18T02:00:00.000Z',
        expiresAt: null,
      },
      idempotencyKey: 'concurrent-correction',
    }),
    service.confirmFact(context, {
      batchId: 'batch-a',
      candidateId: 'candidate-price',
      factId: 'fact-concurrent',
      expectedFactRevision: 0,
      idempotencyKey: 'concurrent-confirmation',
    }),
  ]);
  assert.deepEqual(
    attempts.map((attempt) => attempt.status).sort(),
    ['fulfilled', 'rejected'],
  );
  const facts = await ledger.history(context.workspaceId, 'fact-concurrent');
  if (facts[0]) {
    assert.deepEqual(facts[0].value, { amount: 199, currency: 'CNY' });
  }
});

test('stale fact OCC safely releases the candidate reservation for correction', async () => {
  const ledger = new MemoryStoreFactLedger();
  const service = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    ledger,
  );
  await ledger.append({
    factId: 'fact-stale',
    workspaceId: context.workspaceId,
    kind: 'price',
    key: 'service.scalp-clean.price',
    value: { amount: 159, currency: 'CNY' },
    scope: { storeId: 'store-a', serviceId: 'scalp-clean' },
    source: {
      kind: 'user_confirmation',
      referenceId: 'older-confirmation',
      capturedAt: '2026-07-18T00:00:00.000Z',
    },
    effectiveFrom: '2026-07-18T00:00:00.000Z',
    expiresAt: null,
    recordedAt: '2026-07-18T00:00:00.000Z',
    recordedBy: context.userId,
    expectedRevision: 0,
  });
  await service.recordBatch(batch());
  await assert.rejects(
    service.confirmFact(context, {
      batchId: 'batch-a',
      candidateId: 'candidate-price',
      factId: 'fact-stale',
      expectedFactRevision: 0,
      idempotencyKey: 'stale-confirmation',
    }),
    StoreFactRevisionConflictError,
  );
  await service.correctFact(context, {
    batchId: 'batch-a',
    candidateId: 'candidate-price',
    correctedFact: {
      kind: 'price',
      key: 'service.scalp-clean.price',
      value: { amount: 239, currency: 'CNY' },
      scope: { storeId: 'store-a', serviceId: 'scalp-clean' },
      source: {
        kind: 'user_confirmation',
        referenceId: 'correct-after-stale',
        capturedAt: '2026-07-18T02:00:00.000Z',
      },
      effectiveFrom: '2026-07-18T02:00:00.000Z',
      expiresAt: null,
    },
    idempotencyKey: 'correct-after-stale',
  });
  const confirmed = await service.confirmFact(context, {
    batchId: 'batch-a',
    candidateId: 'candidate-price',
    factId: 'fact-stale',
    expectedFactRevision: 1,
    idempotencyKey: 'confirm-after-stale',
  });
  assert.equal(confirmed.revision, 2);
  assert.deepEqual(confirmed.value, { amount: 239, currency: 'CNY' });
});

test('memory intake identities cannot collide across colon-delimited workspaces', async () => {
  const repository = new MemoryAssetIntakeRepository();
  const first = batch({ workspaceId: 'a', batchId: 'b:c' });
  const second = batch({ workspaceId: 'a:b', batchId: 'c' });
  await repository.recordBatch(first);
  await repository.recordBatch(second);
  assert.deepEqual(await repository.getBatch('a', 'b:c'), first);
  assert.deepEqual(await repository.getBatch('a:b', 'c'), second);
});

test('non-fact candidates cannot be routed into StoreFact', async () => {
  const service = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    new MemoryStoreFactLedger(),
  );
  await service.recordBatch(
    batch({
      batchId: 'batch-asset',
      candidates: [
        {
          candidateId: 'candidate-asset',
          objectKind: 'authorized_asset',
          status: 'pending',
          assetId: 'asset-a',
        },
      ],
    }),
  );
  await assert.rejects(
    service.confirmFact(context, {
      batchId: 'batch-asset',
      candidateId: 'candidate-asset',
      factId: 'fact-forged',
      expectedFactRevision: 0,
      idempotencyKey: 'confirm-forged',
    }),
    (error: unknown) =>
      error instanceof AssetIntakeError && error.code === 'WRONG_OBJECT_CHANNEL',
  );
});
