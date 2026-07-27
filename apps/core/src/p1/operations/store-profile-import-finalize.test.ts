/**
 * The staged import batch is only worth anything if the merchant can actually
 * confirm it. This pins the seam between D-151③ (staging) and D-151① (the one
 * confirmation event, two projections) end to end on in-memory ports.
 */

import assert from 'node:assert/strict';
import test from 'node:test';

import type { StoreProfile } from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import {
  AssetIntakeService,
  MemoryAssetIntakeRepository,
} from './asset-intake-service.js';
import { MemoryStoreFactLedger } from './store-fact-ledger.js';
import {
  StoreIntakeFinalizer,
  type StoreIntakeFinalizationRepository,
} from './store-intake-finalizer.js';
import { StoreProfileImportPreparer } from './store-profile-import.js';

const confirmedAt = '2026-05-04T02:00:00.000Z';
const context: P1Context = {
  actor: 'owner',
  correlationId: 'store-profile-import-finalize',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

const store: StoreProfile = {
  accounts: [],
  address: '湖墅南路 88 号',
  booking: '提前一天私信预约',
  brandVoice: '专业、克制',
  city: '杭州',
  confirmedAt,
  district: '拱墅区',
  name: '青禾美甲',
  prohibitions: [],
  projects: [
    {
      confirmed: true,
      durationMinutes: 75,
      id: 'legacy-primary',
      name: '透亮猫眼护理',
      price: 299,
    },
  ],
  regulated: false,
  revision: 2,
};

const finalizations: StoreIntakeFinalizationRepository = {
  withLock: async (_workspaceId, _key, action) => action(),
  begin: async (_workspaceId, _key, fingerprint) => ({
    error: null,
    fingerprint,
    result: null,
    status: 'pending' as const,
  }),
  complete: async (_workspaceId, _key, _fingerprint, result) => result,
  reject: async () => undefined,
  markNeedsReconciliation: async () => undefined,
};

test('a staged import batch is confirmable through finalize_store_intake', async () => {
  const facts = new MemoryStoreFactLedger();
  const intake = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    facts,
    () => '2026-07-27T00:00:00.000Z',
  );
  const { batch } = await new StoreProfileImportPreparer(
    { read: async () => store },
    intake,
    () => '2026-07-27T00:00:00.000Z',
  ).prepare(context);
  assert.ok(batch);

  let mergedPatch: unknown;
  const finalizer = new StoreIntakeFinalizer(intake, finalizations, {
    completedRevision: async () => null,
    currentRevision: async () => 2,
    merge: async (_context, patch) => {
      mergedPatch = patch;
      return { ...store, revision: 3 };
    },
  });

  const result = await finalizer.finalize(
    context,
    {
      // Persisted reference only: the browser never re-sends the candidates,
      // so it cannot rewrite an imported value on the way in.
      batch: { batchId: batch.batchId },
      confirmations: [
        {
          candidateId: 'store-profile:name:other:import',
          factId: 'store-profile:name:other',
          expectedFactRevision: 0,
        },
        {
          candidateId: 'store-project:legacy-primary:service:import',
          factId: 'store-project:legacy-primary:service',
          expectedFactRevision: 0,
        },
        {
          candidateId: 'store-project:legacy-primary:price:import',
          factId: 'store-project:legacy-primary:price',
          expectedFactRevision: 0,
        },
      ],
      profilePatch: {
        expectedRevision: 2,
        name: '青禾美甲',
        projects: {
          upsert: [
            {
              id: 'legacy-primary',
              name: '透亮猫眼护理',
              price: 299,
              durationMinutes: 75,
              confirmed: true,
            },
          ],
        },
      },
    },
    'import-finalize',
  );

  assert.equal(result.facts.length, 3);
  assert.deepEqual(
    result.facts.map((fact) => fact.factId).sort(),
    [
      'store-profile:name:other',
      'store-project:legacy-primary:price',
      'store-project:legacy-primary:service',
    ],
  );
  // Provenance survives confirmation — the fact records that this value came
  // from the merchant's historical profile, not from a fresh statement.
  for (const fact of result.facts) {
    assert.equal(fact.source.kind, 'import');
    assert.equal(fact.source.capturedAt, confirmedAt);
  }
  assert.ok(mergedPatch);
});

test('finalize refuses an imported candidate whose profile patch was rewritten', async () => {
  const intake = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    new MemoryStoreFactLedger(),
    () => '2026-07-27T00:00:00.000Z',
  );
  const { batch } = await new StoreProfileImportPreparer(
    { read: async () => store },
    intake,
    () => '2026-07-27T00:00:00.000Z',
  ).prepare(context);
  const finalizer = new StoreIntakeFinalizer(intake, finalizations, {
    completedRevision: async () => null,
    currentRevision: async () => 2,
    merge: async () => ({ ...store, revision: 3 }),
  });

  await assert.rejects(
    finalizer.finalize(
      context,
      {
        batch: { batchId: batch!.batchId },
        confirmations: [
          {
            candidateId: 'store-profile:name:other:import',
            factId: 'store-profile:name:other',
            expectedFactRevision: 0,
          },
        ],
        profilePatch: { expectedRevision: 2, name: '别人家的店' },
      },
      'import-finalize-rewrite',
    ),
    /does not match its profile patch/,
  );
});
