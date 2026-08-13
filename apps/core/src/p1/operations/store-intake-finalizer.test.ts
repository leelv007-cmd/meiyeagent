import assert from 'node:assert/strict';
import test from 'node:test';

import type {
  AssetIntakeBatch,
  FinalizeStoreIntakeCommand,
  StoreProfile,
  StoreProfilePatch,
} from '@meiye/contracts';
import { STORE_PROFILE_PLATFORM_DEFAULTS } from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import {
  AssetIntakeService,
  MemoryAssetIntakeRepository,
} from './asset-intake-service.js';
import { MemoryStoreFactLedger } from './store-fact-ledger.js';
import {
  StoreIntakeFinalizationError,
  StoreIntakeFinalizer,
  type StoreIntakeFinalizationIntakePort,
  type StoreIntakeFinalizationRepository,
  type StoreProfileMergePort,
} from './store-intake-finalizer.js';

const now = '2026-07-27T10:00:00.000Z';
const context: P1Context = {
  actor: 'owner',
  correlationId: 'store-intake-finalizer-contract',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

class MemoryFinalizationRepository
  implements StoreIntakeFinalizationRepository
{
  readonly statuses = new Map<
    string,
    'pending' | 'completed' | 'rejected' | 'needs_reconciliation'
  >();

  async withLock<T>(_workspaceId: string, _idempotencyKey: string, action: () => Promise<T>) {
    return action();
  }

  async begin(
    workspaceId: string,
    idempotencyKey: string,
    fingerprint: string,
  ) {
    const key = `${workspaceId}:${idempotencyKey}`;
    const status = this.statuses.get(key) ?? 'pending';
    this.statuses.set(key, status);
    return {
      error: null,
      fingerprint,
      result: null,
      status,
    };
  }

  async complete(
    workspaceId: string,
    idempotencyKey: string,
    _fingerprint: string,
    result: { facts: never[]; profileRevision: number },
  ) {
    this.statuses.set(`${workspaceId}:${idempotencyKey}`, 'completed');
    return result;
  }

  async reject(workspaceId: string, idempotencyKey: string) {
    this.statuses.set(`${workspaceId}:${idempotencyKey}`, 'rejected');
  }

  async markNeedsReconciliation(
    workspaceId: string,
    idempotencyKey: string,
  ) {
    this.statuses.set(
      `${workspaceId}:${idempotencyKey}`,
      'needs_reconciliation',
    );
  }
}

function projectBatch(): FinalizeStoreIntakeCommand['batch'] {
  return {
    batchId: 'batch-a',
    taskId: 'task-a',
    source: {
      sourceId: 'source-a',
      kind: 'manual',
      referenceId: 'source-a',
      capabilityStatus: 'verified',
      sourceWorkspaceId: context.workspaceId,
      capturedAt: now,
      example: false,
    },
    summary: 'User confirmed one store project.',
    candidates: [
      {
        candidateId: 'project-service',
        status: 'pending',
        objectKind: 'store_fact',
        fact: {
          kind: 'service',
          key: 'service.project-a.name',
          value: { name: '透亮猫眼' },
          scope: { storeId: context.workspaceId },
          source: {
            kind: 'user_confirmation',
            referenceId: 'source-a',
            capturedAt: now,
          },
          effectiveFrom: now,
          expiresAt: null,
        },
      },
      {
        candidateId: 'project-price',
        status: 'pending',
        objectKind: 'store_fact',
        fact: {
          kind: 'price',
          key: 'service.project-a.price',
          value: { amount: 299, currency: 'CNY' },
          scope: { storeId: context.workspaceId },
          source: {
            kind: 'user_confirmation',
            referenceId: 'source-a',
            capturedAt: now,
          },
          effectiveFrom: now,
          expiresAt: null,
        },
      },
    ],
  };
}

function projectInput(
  batch: FinalizeStoreIntakeCommand['batch'],
  profilePatch: NonNullable<FinalizeStoreIntakeCommand['profilePatch']>,
): FinalizeStoreIntakeCommand {
  return {
    batch,
    confirmations: [
      {
        candidateId: 'project-service',
        factId: 'store-project:project-a:service',
        expectedFactRevision: 0,
      },
      {
        candidateId: 'project-price',
        factId: 'store-project:project-a:price',
        expectedFactRevision: 0,
      },
    ],
    profilePatch,
  };
}

function profilePort(
  merge: StoreProfileMergePort['merge'],
): StoreProfileMergePort {
  return {
    completedRevision: async () => null,
    currentRevision: async () => 1,
    merge,
  };
}

test('rejects a project profile-only write before StoreFact append', async () => {
  const facts = new MemoryStoreFactLedger();
  const intake = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    facts,
    () => now,
  );
  const finalizations = new MemoryFinalizationRepository();
  let mergeCalls = 0;
  const finalizer = new StoreIntakeFinalizer(
    intake,
    finalizations,
    profilePort(async () => {
      mergeCalls += 1;
      throw new Error('profile merge must not run');
    }),
  );
  const input = projectInput(projectBatch(), {
    expectedRevision: 1,
    projects: {
      upsert: [
        {
          id: 'project-a',
          name: '透亮猫眼',
          price: 999,
          durationMinutes: 90,
          confirmed: true,
        },
      ],
    },
  });
  input.confirmations = input.confirmations.filter(
    (confirmation) => confirmation.factId.endsWith(':service'),
  );

  await assert.rejects(
    finalizer.finalize(context, input, 'reject-profile-only'),
    (error) =>
      error instanceof StoreIntakeFinalizationError &&
      error.code === 'STORE_FACT_MAPPING_INVALID',
  );
  assert.equal(
    finalizations.statuses.get('workspace-a:reject-profile-only'),
    'rejected',
  );
  assert.equal(mergeCalls, 0);
  assert.deepEqual(
    await facts.history(context.workspaceId, 'store-project:project-a:service'),
    [],
  );
});

test('marks staged facts for reconciliation instead of leaving a pending outbox', async () => {
  const facts = new MemoryStoreFactLedger();
  const intake = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    facts,
    () => now,
  );
  const finalizations = new MemoryFinalizationRepository();
  let mergeCalls = 0;
  const finalizer = new StoreIntakeFinalizer(
    intake,
    finalizations,
    profilePort(async (): Promise<StoreProfile> => {
      mergeCalls += 1;
      throw new Error('injected profile projection failure');
    }),
  );
  const input = projectInput(projectBatch(), {
    expectedRevision: 1,
    projects: {
      upsert: [
        {
          id: 'project-a',
          name: '透亮猫眼',
          price: 299,
          durationMinutes: 90,
          confirmed: true,
          priceValidUntil: null,
        },
      ],
    },
  });

  await assert.rejects(
    finalizer.finalize(context, input, 'needs-reconciliation'),
    /injected profile projection failure/,
  );
  assert.equal(
    finalizations.statuses.get('workspace-a:needs-reconciliation'),
    'needs_reconciliation',
  );
  assert.equal(
    (
      await facts.history(
        context.workspaceId,
        'store-project:project-a:service',
      )
    ).length,
    1,
  );
  assert.equal(
    (
      await facts.history(context.workspaceId, 'store-project:project-a:price')
    ).length,
    1,
  );

  await assert.rejects(
    finalizer.finalize(context, input, 'needs-reconciliation'),
    /injected profile projection failure/,
  );
  assert.equal(
    finalizations.statuses.get('workspace-a:needs-reconciliation'),
    'needs_reconciliation',
  );
  assert.equal(mergeCalls, 2);
});


/* ------------------------------------------------------------------ *
 * #244 — a price the merchant confirms has to say how long it runs.
 * ------------------------------------------------------------------ */

function priceValidityFinalizer(facts: MemoryStoreFactLedger) {
  const intake = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    facts,
    () => now,
  );
  const merged: StoreProfile[] = [];
  const finalizer = new StoreIntakeFinalizer(
    intake,
    new MemoryFinalizationRepository(),
    profilePort(async (_context, patch) => {
      const project = patch.projects?.upsert?.[0] ?? {
        id: 'project-a',
        name: '透亮猫眼',
        price: 299,
        durationMinutes: 90,
        confirmed: true,
      };
      const profile: StoreProfile = {
        name: '青禾',
        city: '杭州',
        district: '拱墅区',
        address: '湖墅南路 88 号',
        booking: '提前一天私信预约',
        brandVoice: '克制',
        prohibitions: [],
        accounts: [],
        projects: [project],
        regulated: false,
        revision: 2,
      };
      merged.push(profile);
      return profile;
    }),
  );
  return { finalizer, intake, merged };
}

/** The inline arm of the finalize batch union — the one these tests build. */
type InlineIntakeBatch = Extract<
  FinalizeStoreIntakeCommand['batch'],
  { candidates: unknown }
>;

function inlineProjectBatch() {
  return projectBatch() as InlineIntakeBatch;
}

function datedPriceBatch(expiresAt: string): InlineIntakeBatch {
  const batch = inlineProjectBatch();
  return {
    ...batch,
    candidates: batch.candidates.map((candidate) =>
      candidate.objectKind === 'store_fact' &&
      candidate.candidateId === 'project-price'
        ? { ...candidate, fact: { ...candidate.fact, expiresAt } }
        : candidate,
    ),
  };
}

test('a merchant-confirmed price without a stated validity is refused, not stored as permanent', async () => {
  const facts = new MemoryStoreFactLedger();
  const { finalizer, merged } = priceValidityFinalizer(facts);
  const input = projectInput(projectBatch(), {
    expectedRevision: 1,
    projects: {
      upsert: [
        {
          id: 'project-a',
          name: '透亮猫眼',
          price: 299,
          durationMinutes: 90,
          confirmed: true,
        },
      ],
    },
  });

  await assert.rejects(
    finalizer.finalize(context, input, 'price-validity-missing'),
    (error) =>
      error instanceof StoreIntakeFinalizationError &&
      error.code === 'STORE_FACT_MAPPING_INVALID' &&
      /stated validity/u.test(error.message),
  );
  assert.deepEqual(merged, []);
  assert.deepEqual(
    await facts.history(context.workspaceId, 'store-project:project-a:price'),
    [],
  );
});

test('a screenshot-extracted price without a stated validity is refused, not stored as permanent', async () => {
  const facts = new MemoryStoreFactLedger();
  const { finalizer, intake, merged } = priceValidityFinalizer(facts);
  const staged = inlineProjectBatch();
  const batch = {
    ...staged,
    workspaceId: context.workspaceId,
    createdAt: now,
    source: {
      ...staged.source,
      kind: 'price_list' as const,
    },
    candidates: staged.candidates.map((candidate) =>
      candidate.objectKind === 'store_fact'
        ? {
            ...candidate,
            fact: {
              ...candidate.fact,
              scope: {
                ...candidate.fact.scope,
                serviceId: 'project-a',
              },
              source: {
                ...candidate.fact.source,
                kind: 'screenshot_extraction' as const,
              },
            },
          }
        : candidate,
    ),
  };
  await intake.recordBatch(batch, 'screenshot-price-without-validity');
  const input = projectInput(
    { batchId: batch.batchId },
    {
      expectedRevision: 1,
      projects: {
        upsert: [
          {
            id: 'project-a',
            name: '透亮猫眼',
            price: 299,
            durationMinutes: 90,
            confirmed: true,
          },
        ],
      },
    },
  );

  await assert.rejects(
    finalizer.finalize(context, input, 'screenshot-validity-missing'),
    (error) =>
      error instanceof StoreIntakeFinalizationError &&
      error.code === 'STORE_FACT_MAPPING_INVALID' &&
      /stated validity/u.test(error.message),
  );
  assert.deepEqual(merged, []);
  assert.deepEqual(
    await facts.history(context.workspaceId, 'store-project:project-a:price'),
    [],
  );
});

test('a legacy promotion without a validity window remains a pending candidate', async () => {
  const facts = new MemoryStoreFactLedger();
  const { finalizer, intake, merged } = priceValidityFinalizer(facts);
  const batch = {
    batchId: 'legacy-group-buy',
    workspaceId: context.workspaceId,
    taskId: 'legacy-group-buy-task',
    source: {
      sourceId: 'legacy-group-buy-source',
      kind: 'import' as const,
      referenceId: 'legacy-group-buy-reference',
      capabilityStatus: 'assisted' as const,
      sourceWorkspaceId: context.workspaceId,
      capturedAt: now,
      example: false,
    },
    summary: 'Historical group buy awaiting confirmation.',
    candidates: [
      {
        candidateId: 'legacy-group-buy-candidate',
        status: 'pending' as const,
        objectKind: 'store_fact' as const,
        fact: {
          kind: 'group_buy' as const,
          key: 'service.project-a.group_buy',
          value: { amount: 199, currency: 'CNY' },
          scope: { storeId: context.workspaceId, serviceId: 'project-a' },
          source: {
            kind: 'import' as const,
            referenceId: 'legacy-group-buy-reference',
            capturedAt: now,
          },
          effectiveFrom: now,
          expiresAt: null,
        },
      },
    ],
    createdAt: now,
  };
  await intake.recordBatch(batch, 'legacy-group-buy-record');

  await assert.rejects(
    finalizer.finalize(
      context,
      {
        batch: { batchId: batch.batchId },
        confirmations: [
          {
            candidateId: 'legacy-group-buy-candidate',
            factId: 'store-project:project-a:group_buy',
            expectedFactRevision: 0,
          },
        ],
        profilePatch: { expectedRevision: 1 },
      },
      'legacy-group-buy-finalize',
    ),
    (error) =>
      error instanceof StoreIntakeFinalizationError &&
      error.code === 'STORE_FACT_MAPPING_INVALID' &&
      /validity window/u.test(error.message),
  );
  assert.deepEqual(merged, []);
  assert.deepEqual(
    await facts.history(
      context.workspaceId,
      'store-project:project-a:group_buy',
    ),
    [],
  );
  assert.deepEqual(
    (await intake.view(context.workspaceId, batch.batchId)).decisions,
    [],
  );
});

test('a stated price window reaches both the ledger fact and the stored project', async () => {
  const facts = new MemoryStoreFactLedger();
  const { finalizer, merged } = priceValidityFinalizer(facts);
  const validUntil = '2026-08-31T15:59:59.999Z';
  const input = projectInput(datedPriceBatch(validUntil), {
    expectedRevision: 1,
    projects: {
      upsert: [
        {
          id: 'project-a',
          name: '透亮猫眼',
          price: 299,
          durationMinutes: 90,
          confirmed: true,
          priceValidUntil: validUntil,
        },
      ],
    },
  });

  const result = await finalizer.finalize(context, input, 'price-validity-set');
  const priceFact = result.facts.find(
    (fact) => fact.factId === 'store-project:project-a:price',
  );
  assert.equal(priceFact?.expiresAt, validUntil);
  assert.equal(merged[0]?.projects[0]?.priceValidUntil, validUntil);
});

test('a price window the profile disagrees with is refused', async () => {
  const facts = new MemoryStoreFactLedger();
  const { finalizer } = priceValidityFinalizer(facts);
  const input = projectInput(datedPriceBatch('2026-08-31T15:59:59.999Z'), {
    expectedRevision: 1,
    projects: {
      upsert: [
        {
          id: 'project-a',
          name: '透亮猫眼',
          price: 299,
          durationMinutes: 90,
          confirmed: true,
          // The merchant said "it stands" while the fact says it runs out.
          priceValidUntil: null,
        },
      ],
    },
  });

  await assert.rejects(
    finalizer.finalize(context, input, 'price-validity-mismatch'),
    (error) =>
      error instanceof StoreIntakeFinalizationError &&
      error.code === 'STORE_FACT_MAPPING_INVALID' &&
      /stated validity/u.test(error.message),
  );
});

function persistedProjectBatch(
  batchId: string,
  price: number,
): AssetIntakeBatch {
  const batch = inlineProjectBatch();
  return {
    ...batch,
    batchId,
    workspaceId: context.workspaceId,
    candidates: batch.candidates.map((candidate) =>
      candidate.objectKind === 'store_fact'
        ? {
            ...candidate,
            fact: {
              ...candidate.fact,
              scope: {
                storeId: context.workspaceId,
                serviceId: 'project-a',
              },
              ...(candidate.candidateId === 'project-price'
                ? {
                    value: { amount: price, currency: 'CNY' },
                  }
                : {}),
            },
          }
        : candidate,
    ),
    createdAt: now,
  };
}

function priceCandidate(batch: AssetIntakeBatch) {
  const candidate = batch.candidates.find(
    (item) =>
      item.objectKind === 'store_fact' &&
      item.candidateId === 'project-price',
  );
  if (candidate?.objectKind !== 'store_fact') {
    assert.fail('project price candidate is missing');
  }
  return candidate;
}

function projectProfile(patch: StoreProfilePatch): StoreProfile {
  return {
    name: '青禾',
    city: '杭州',
    district: '拱墅区',
    address: '湖墅南路 88 号',
    booking: '提前一天私信预约',
    brandVoice: '克制',
    prohibitions: [],
    accounts: [],
    projects: patch.projects?.upsert ?? [],
    regulated: false,
    revision: patch.expectedRevision + 1,
  };
}

async function prepareCorrectedPrice(
  batchId: string,
  correctedPrice: number,
) {
  const facts = new MemoryStoreFactLedger();
  const intake = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    facts,
    () => now,
  );
  const batch = persistedProjectBatch(batchId, 239);
  await intake.recordBatch(batch);
  const candidate = priceCandidate(batch);
  await intake.correctFact(context, {
    batchId,
    candidateId: candidate.candidateId,
    correctedFact: {
      ...candidate.fact,
      value: { amount: correctedPrice, currency: 'CNY' },
    },
    idempotencyKey: `${batchId}:correct-price`,
  });
  return { batch, facts, intake };
}

test('a corrected price reaches both StoreFact and the profile projection', async () => {
  const { batch, facts, intake } = await prepareCorrectedPrice(
    'corrected-price-batch',
    299,
  );
  const mergedPatches: StoreProfilePatch[] = [];
  const finalizer = new StoreIntakeFinalizer(
    intake,
    new MemoryFinalizationRepository(),
    profilePort(async (_context, patch) => {
      mergedPatches.push(patch);
      return projectProfile(patch);
    }),
    () => now,
  );
  const input = projectInput(
    { batchId: batch.batchId },
    {
      expectedRevision: 1,
      projects: {
        upsert: [
          {
            id: 'project-a',
            name: '透亮猫眼',
            price: 299,
            durationMinutes: 90,
            confirmed: true,
            priceValidUntil: null,
          },
        ],
      },
    },
  );

  const result = await finalizer.finalize(
    context,
    input,
    'corrected-price-finalize',
  );
  const priceFact = result.facts.find(
    (fact) => fact.factId === 'store-project:project-a:price',
  );

  assert.deepEqual(priceFact?.value, { amount: 299, currency: 'CNY' });
  assert.equal(mergedPatches[0]?.projects?.upsert?.[0]?.price, 299);
  assert.deepEqual(
    (
      await facts.history(context.workspaceId, 'store-project:project-a:price')
    )[0]?.value,
    { amount: 299, currency: 'CNY' },
  );
});

test('a profile patch with the pre-correction price is rejected before either projection writes', async () => {
  const { batch, facts, intake } = await prepareCorrectedPrice(
    'stale-corrected-price-batch',
    299,
  );
  let mergeCalls = 0;
  const finalizer = new StoreIntakeFinalizer(
    intake,
    new MemoryFinalizationRepository(),
    profilePort(async (_context, patch) => {
      mergeCalls += 1;
      return projectProfile(patch);
    }),
    () => now,
  );
  const input = projectInput(
    { batchId: batch.batchId },
    {
      expectedRevision: 1,
      projects: {
        upsert: [
          {
            id: 'project-a',
            name: '透亮猫眼',
            price: 239,
            durationMinutes: 90,
            confirmed: true,
            priceValidUntil: null,
          },
        ],
      },
    },
  );

  await assert.rejects(
    finalizer.finalize(context, input, 'stale-corrected-price-finalize'),
    (error) =>
      error instanceof StoreIntakeFinalizationError &&
      error.code === 'STORE_FACT_MAPPING_INVALID',
  );

  assert.equal(mergeCalls, 0);
  assert.deepEqual(
    await facts.history(
      context.workspaceId,
      'store-project:project-a:service',
    ),
    [],
  );
  assert.deepEqual(
    await facts.history(context.workspaceId, 'store-project:project-a:price'),
    [],
  );
});

test('a corrected revocation satisfies the project clear gate', async () => {
  const facts = new MemoryStoreFactLedger();
  const intake = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    facts,
    () => now,
  );
  const activeBatch = persistedProjectBatch('active-price-batch', 239);
  await intake.recordBatch(activeBatch);
  await intake.confirmFact(context, {
    batchId: activeBatch.batchId,
    candidateId: 'project-price',
    factId: 'store-project:project-a:price',
    expectedFactRevision: 0,
    idempotencyKey: 'confirm-active-price',
  });

  const revocationBatch = persistedProjectBatch('revoke-price-batch', 239);
  await intake.recordBatch(revocationBatch);
  const revocationCandidate = priceCandidate(revocationBatch);
  await intake.correctFact(context, {
    batchId: revocationBatch.batchId,
    candidateId: revocationCandidate.candidateId,
    correctedFact: {
      ...revocationCandidate.fact,
      value: null,
      revisionKind: 'revocation',
    },
    idempotencyKey: 'correct-price-to-revocation',
  });
  const mergedPatches: StoreProfilePatch[] = [];
  const finalizer = new StoreIntakeFinalizer(
    intake,
    new MemoryFinalizationRepository(),
    profilePort(async (_context, patch) => {
      mergedPatches.push(patch);
      return projectProfile(patch);
    }),
    () => now,
  );
  const input: FinalizeStoreIntakeCommand = {
    batch: { batchId: revocationBatch.batchId },
    confirmations: [
      {
        candidateId: 'project-price',
        factId: 'store-project:project-a:price',
        expectedFactRevision: 1,
      },
    ],
    profilePatch: {
      expectedRevision: 1,
      projects: { clear: ['project-a'] },
    },
  };

  const result = await finalizer.finalize(
    context,
    input,
    'corrected-price-revocation-finalize',
  );

  assert.equal(result.facts[0]?.revisionKind, 'revocation');
  assert.equal(result.facts[0]?.value, null);
  assert.deepEqual(mergedPatches[0]?.projects?.clear, ['project-a']);
});

test('a correction after the mapping snapshot fails closed before the projections diverge', async () => {
  const { batch, facts, intake } = await prepareCorrectedPrice(
    'racing-corrected-price-batch',
    299,
  );
  const originalPrice = priceCandidate(batch);
  let injected = false;
  const racingIntake = {
    async confirmFact(confirmContext, confirmation) {
      if (!injected && confirmation.candidateId === 'project-price') {
        injected = true;
        await intake.correctFact(confirmContext, {
          batchId: batch.batchId,
          candidateId: 'project-price',
          correctedFact: {
            ...originalPrice.fact,
            value: { amount: 319, currency: 'CNY' },
          },
          idempotencyKey: 'racing-price-correction',
        });
      }
      return intake.confirmFact(confirmContext, confirmation);
    },
    confirmedFactRevision: (...args) => intake.confirmedFactRevision(...args),
    currentFact: (...args) => intake.currentFact(...args),
    currentFactRevision: (...args) => intake.currentFactRevision(...args),
    effectiveFactSnapshot: (...args) =>
      intake.effectiveFactSnapshot(...args),
    persistedBatch: (...args) => intake.persistedBatch(...args),
    recordBatch: (...args) => intake.recordBatch(...args),
    withPinnedFactHeads: (...args) => intake.withPinnedFactHeads(...args),
  } satisfies StoreIntakeFinalizationIntakePort;
  let mergeCalls = 0;
  const finalizer = new StoreIntakeFinalizer(
    racingIntake,
    new MemoryFinalizationRepository(),
    profilePort(async (_context, patch) => {
      mergeCalls += 1;
      return projectProfile(patch);
    }),
    () => now,
  );
  const input = projectInput(
    { batchId: batch.batchId },
    {
      expectedRevision: 1,
      projects: {
        upsert: [
          {
            id: 'project-a',
            name: '透亮猫眼',
            price: 299,
            durationMinutes: 90,
            confirmed: true,
            priceValidUntil: null,
          },
        ],
      },
    },
  );
  input.confirmations.sort((left) =>
    left.candidateId === 'project-price' ? -1 : 1,
  );

  await assert.rejects(
    finalizer.finalize(context, input, 'racing-corrected-price-finalize'),
    (error) =>
      error instanceof StoreIntakeFinalizationError &&
      error.code === 'STORE_FACT_REVISION_CONFLICT',
  );

  assert.equal(injected, true);
  assert.equal(mergeCalls, 0);
  assert.deepEqual(
    await facts.history(
      context.workspaceId,
      'store-project:project-a:service',
    ),
    [],
  );
  assert.deepEqual(
    await facts.history(context.workspaceId, 'store-project:project-a:price'),
    [],
  );
});

test('an explicit confirmation changed before profile merge fails closed', async () => {
  const facts = new MemoryStoreFactLedger();
  const intake = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    facts,
    () => now,
  );
  let injected = false;
  const racingIntake = {
    confirmFact: (...args) => intake.confirmFact(...args),
    confirmedFactRevision: (...args) => intake.confirmedFactRevision(...args),
    currentFact: (...args) => intake.currentFact(...args),
    currentFactRevision: (...args) => intake.currentFactRevision(...args),
    effectiveFactSnapshot: (...args) =>
      intake.effectiveFactSnapshot(...args),
    persistedBatch: (...args) => intake.persistedBatch(...args),
    recordBatch: (...args) => intake.recordBatch(...args),
    async withPinnedFactHeads(workspaceId, factIds, action) {
      if (!injected) {
        injected = true;
        await intake.recordBatch({
          batchId: 'explicit-head-race-batch',
          workspaceId,
          taskId: 'explicit-head-race-task',
          source: {
            sourceId: 'external-writer',
            kind: 'manual',
            referenceId: 'external-writer',
            capabilityStatus: 'assisted',
            sourceWorkspaceId: workspaceId,
            capturedAt: now,
            example: false,
          },
          summary: 'Merchant revoked the confirmed price.',
          candidates: [
            {
              candidateId: 'explicit-head-race-price',
              status: 'pending',
              objectKind: 'store_fact',
              fact: {
                kind: 'price',
                key: 'service.project-a.price',
                value: null,
                revisionKind: 'revocation',
                scope: { storeId: workspaceId, serviceId: 'project-a' },
                source: {
                  kind: 'user_confirmation',
                  referenceId: 'external-writer',
                  capturedAt: now,
                },
                effectiveFrom: now,
                expiresAt: null,
              },
            },
          ],
          createdAt: now,
        });
        await intake.confirmFact(context, {
          batchId: 'explicit-head-race-batch',
          candidateId: 'explicit-head-race-price',
          factId: 'store-project:project-a:price',
          expectedFactRevision: 1,
          idempotencyKey: 'explicit-head-race-price',
        });
      }
      return intake.withPinnedFactHeads(workspaceId, factIds, action);
    },
  } satisfies StoreIntakeFinalizationIntakePort;
  let mergeCalls = 0;
  const finalizations = new MemoryFinalizationRepository();
  const finalizer = new StoreIntakeFinalizer(
    racingIntake,
    finalizations,
    profilePort(async (_context, patch) => {
      mergeCalls += 1;
      return projectProfile(patch);
    }),
    () => now,
  );
  const batch = projectBatch();
  const input = projectInput(batch, {
    expectedRevision: 1,
    projects: {
      upsert: [
        {
          id: 'project-a',
          name: '透亮猫眼',
          price: 299,
          durationMinutes: 90,
          confirmed: true,
          priceValidUntil: null,
        },
      ],
    },
  });

  await assert.rejects(
    finalizer.finalize(context, input, 'explicit-head-race-finalize'),
    (error) =>
      error instanceof StoreIntakeFinalizationError &&
      error.code === 'STORE_FACT_REVISION_CONFLICT',
  );

  assert.equal(injected, true);
  assert.equal(mergeCalls, 0);
  assert.equal(
    finalizations.statuses.get(
      `${context.workspaceId}:explicit-head-race-finalize`,
    ),
    'needs_reconciliation',
  );
  assert.equal(
    (
      await facts.history(
        context.workspaceId,
        'store-project:project-a:price',
      )
    ).at(-1)?.revisionKind,
    'revocation',
  );
});

/* ------------------------------------------------------------------ *
 * V31-86 — initializing platform defaults may omit confirmation.
 * ------------------------------------------------------------------ */

function dayZeroProfilePort(
  merge: StoreProfileMergePort['merge'],
): StoreProfileMergePort {
  return {
    completedRevision: async () => null,
    currentRevision: async () => 0,
    merge,
  };
}

function profileFactCandidate(
  candidateId: string,
  fact: {
    kind: 'other' | 'fulfillment';
    key: string;
    value: Record<string, string>;
  },
): FinalizeStoreIntakeCommand['batch'] extends infer Batch
  ? Batch extends { candidates: infer Candidates }
    ? Candidates extends Array<infer Candidate>
      ? Candidate
      : never
    : never
  : never {
  return {
    candidateId,
    status: 'pending',
    objectKind: 'store_fact',
    fact: {
      kind: fact.kind,
      key: fact.key,
      value: fact.value,
      scope: { storeId: context.workspaceId },
      source: {
        kind: 'user_confirmation',
        referenceId: 'source-a',
        capturedAt: now,
      },
      effectiveFrom: now,
      expiresAt: null,
    },
  };
}

function dayZeroArchiveInput(input: {
  district: string;
  confirmDistrict?: boolean;
  fieldProvenance?: FinalizeStoreIntakeCommand['fieldProvenance'];
}): FinalizeStoreIntakeCommand {
  const batch = projectBatch() as InlineIntakeBatch;
  const nameCandidate = profileFactCandidate('profile-name', {
    kind: 'other',
    key: 'store.profile.name',
    value: { name: '盘点美发工作室' },
  });
  const cityCandidate = profileFactCandidate('profile-city', {
    kind: 'other',
    key: 'store.profile.city',
    value: { city: '市中心' },
  });
  const districtCandidate = profileFactCandidate('profile-district', {
    kind: 'other',
    key: 'store.profile.district',
    value: { district: input.district },
  });
  return {
    batch: {
      ...batch,
      candidates: [
        nameCandidate,
        cityCandidate,
        ...(input.confirmDistrict ? [districtCandidate] : []),
        ...batch.candidates,
      ],
    },
    confirmations: [
      {
        candidateId: 'profile-name',
        factId: 'store-profile:name:other',
        expectedFactRevision: 0,
      },
      {
        candidateId: 'profile-city',
        factId: 'store-profile:city:other',
        expectedFactRevision: 0,
      },
      ...(input.confirmDistrict
        ? [
            {
              candidateId: 'profile-district',
              factId: 'store-profile:district:other',
              expectedFactRevision: 0,
            },
          ]
        : []),
      {
        candidateId: 'project-service',
        factId: 'store-project:project-a:service',
        expectedFactRevision: 0,
      },
      {
        candidateId: 'project-price',
        factId: 'store-project:project-a:price',
        expectedFactRevision: 0,
      },
    ],
    profilePatch: {
      expectedRevision: 0,
      name: '盘点美发工作室',
      city: '市中心',
      district: input.district,
      address: STORE_PROFILE_PLATFORM_DEFAULTS.address,
      booking: STORE_PROFILE_PLATFORM_DEFAULTS.booking,
      brandVoice: '真实、克制、像熟客推荐',
      regulated: false,
      projects: {
        upsert: [
          {
            id: 'project-a',
            name: '透亮猫眼',
            price: 299,
            durationMinutes: 90,
            confirmed: true,
            priceValidUntil: null,
          },
        ],
      },
    },
    ...(input.fieldProvenance
      ? { fieldProvenance: input.fieldProvenance }
      : {}),
  };
}

test('initializing platform-default district/address/booking may omit confirmation', async () => {
  const facts = new MemoryStoreFactLedger();
  const intake = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    facts,
    () => now,
  );
  const merged: StoreProfilePatch[] = [];
  const finalizer = new StoreIntakeFinalizer(
    intake,
    new MemoryFinalizationRepository(),
    dayZeroProfilePort(async (_context, patch) => {
      merged.push(patch);
      return projectProfile(patch);
    }),
    () => now,
  );
  const input = dayZeroArchiveInput({
    district: STORE_PROFILE_PLATFORM_DEFAULTS.district,
    fieldProvenance: {
      name: 'merchant_stated',
      city: 'ai_suggestion',
      district: 'platform_default',
      address: 'platform_default',
      booking: 'platform_default',
    },
  });

  const result = await finalizer.finalize(
    context,
    input,
    'v31-86-platform-defaults',
  );

  assert.equal(result.profileRevision, 1);
  assert.deepEqual(result.fieldProvenance, input.fieldProvenance);
  assert.equal(merged[0]?.district, STORE_PROFILE_PLATFORM_DEFAULTS.district);
  assert.equal(merged[0]?.address, STORE_PROFILE_PLATFORM_DEFAULTS.address);
  assert.equal(merged[0]?.booking, STORE_PROFILE_PLATFORM_DEFAULTS.booking);
  assert.equal(
    (
      await facts.history(
        context.workspaceId,
        'store-profile:district:other',
      )
    ).length,
    0,
  );
  assert.equal(
    (
      await facts.history(
        context.workspaceId,
        'store-profile:name:other',
      )
    ).length,
    1,
  );
});

test('initializing non-constant district without confirmation is still refused', async () => {
  const facts = new MemoryStoreFactLedger();
  const intake = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    facts,
    () => now,
  );
  let mergeCalls = 0;
  const finalizer = new StoreIntakeFinalizer(
    intake,
    new MemoryFinalizationRepository(),
    dayZeroProfilePort(async () => {
      mergeCalls += 1;
      throw new Error('profile merge must not run');
    }),
    () => now,
  );

  await assert.rejects(
    finalizer.finalize(
      context,
      dayZeroArchiveInput({ district: '西湖区' }),
      'v31-86-non-constant-district',
    ),
    (error) =>
      error instanceof StoreIntakeFinalizationError &&
      error.code === 'STORE_FACT_MAPPING_INVALID' &&
      /district/.test(error.message),
  );
  assert.equal(mergeCalls, 0);
  assert.deepEqual(
    await facts.history(context.workspaceId, 'store-profile:district:other'),
    [],
  );
});

test('non-initializing platform-default district without confirmation is still refused', async () => {
  const facts = new MemoryStoreFactLedger();
  const intake = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    facts,
    () => now,
  );
  let mergeCalls = 0;
  const finalizer = new StoreIntakeFinalizer(
    intake,
    new MemoryFinalizationRepository(),
    profilePort(async () => {
      mergeCalls += 1;
      throw new Error('profile merge must not run');
    }),
    () => now,
  );
  const input = dayZeroArchiveInput({
    district: STORE_PROFILE_PLATFORM_DEFAULTS.district,
  });
  input.profilePatch.expectedRevision = 1;

  await assert.rejects(
    finalizer.finalize(context, input, 'v31-86-revision-one-default'),
    (error) =>
      error instanceof StoreIntakeFinalizationError &&
      error.code === 'STORE_FACT_MAPPING_INVALID' &&
      /district/.test(error.message),
  );
  assert.equal(mergeCalls, 0);
});

test('initializing name without confirmation is still refused', async () => {
  const facts = new MemoryStoreFactLedger();
  const intake = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    facts,
    () => now,
  );
  const finalizer = new StoreIntakeFinalizer(
    intake,
    new MemoryFinalizationRepository(),
    dayZeroProfilePort(async () => {
      throw new Error('profile merge must not run');
    }),
    () => now,
  );
  const input = dayZeroArchiveInput({
    district: STORE_PROFILE_PLATFORM_DEFAULTS.district,
  });
  input.confirmations = input.confirmations.filter(
    (confirmation) => confirmation.factId !== 'store-profile:name:other',
  );
  if ('candidates' in input.batch) {
    input.batch.candidates = input.batch.candidates.filter(
      (candidate) => candidate.candidateId !== 'profile-name',
    );
  }

  await assert.rejects(
    finalizer.finalize(context, input, 'v31-86-name-unconfirmed'),
    (error) =>
      error instanceof StoreIntakeFinalizationError &&
      error.code === 'STORE_FACT_MAPPING_INVALID' &&
      /name/.test(error.message),
  );
});
