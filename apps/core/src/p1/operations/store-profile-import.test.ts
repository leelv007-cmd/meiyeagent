import assert from 'node:assert/strict';
import test from 'node:test';

import type { StoreProfile } from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import {
  AssetIntakeService,
  MemoryAssetIntakeRepository,
} from './asset-intake-service.js';
import { MemoryStoreFactLedger } from './store-fact-ledger.js';
import { StoreProfileImportPreparer } from './store-profile-import.js';

const context: P1Context = {
  actor: 'owner',
  correlationId: 'correlation-import',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};

const confirmedAt = '2026-05-04T02:00:00.000Z';

function profile(overrides: Partial<StoreProfile> = {}): StoreProfile {
  return {
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
      {
        confirmed: true,
        durationMinutes: 120,
        id: 'legacy-secondary',
        name: '手足深度护理',
        price: 499,
      },
    ],
    regulated: false,
    revision: 3,
    ...overrides,
  };
}

function preparer(store: StoreProfile | undefined) {
  const intake = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    new MemoryStoreFactLedger(),
    () => '2026-07-27T00:00:00.000Z',
  );
  return {
    intake,
    subject: new StoreProfileImportPreparer(
      { read: async () => store },
      intake,
      () => '2026-07-27T00:00:00.000Z',
    ),
  };
}

test('import staging covers every stable profile field and every confirmed project', async () => {
  const { subject } = preparer(profile());
  const { batch, profileRevision } = await subject.prepare(context);

  assert.equal(profileRevision, 3);
  assert.ok(batch);
  assert.equal(batch.source.kind, 'import');
  assert.equal(batch.batchId, 'store-profile-import:3');
  assert.deepEqual(
    batch.candidates.map((candidate) => candidate.candidateId),
    [
      'store-profile:name:other:import',
      'store-profile:city:other:import',
      'store-profile:district:other:import',
      'store-profile:address:fulfillment:import',
      'store-profile:booking:fulfillment:import',
      'store-project:legacy-primary:service:import',
      'store-project:legacy-primary:price:import',
      // D-151③ names the *second and later* projects explicitly: the old
      // progressive card only ever reached `projects[0]`.
      'store-project:legacy-secondary:service:import',
      'store-project:legacy-secondary:price:import',
    ],
  );
});

test('imported candidates stay pending and carry the historical confirmation as their source', async () => {
  const { subject } = preparer(profile());
  const { batch } = await subject.prepare(context);
  const candidate = batch!.candidates.find(
    (item) => item.candidateId === 'store-profile:name:other:import',
  );

  assert.ok(candidate?.objectKind === 'store_fact');
  assert.equal(candidate.status, 'pending');
  assert.deepEqual(candidate.fact.source, {
    kind: 'import',
    referenceId: 'store-profile-confirmation:workspace-a:3',
    capturedAt: confirmedAt,
  });
  assert.deepEqual(candidate.fact.value, { name: '青禾美甲' });
  assert.equal(candidate.fact.key, 'store.profile.name');
});

test('import staging never promotes a candidate into the fact ledger', async () => {
  const { intake, subject } = preparer(profile());
  await subject.prepare(context);

  for (const factId of [
    'store-profile:name:other',
    'store-project:legacy-primary:price',
    'store-project:legacy-secondary:price',
  ]) {
    assert.equal(await intake.currentFactRevision('workspace-a', factId), 0);
  }
});

test('import staging skips fields already present in the ledger', async () => {
  const ledger = new MemoryStoreFactLedger();
  const intake = new AssetIntakeService(
    new MemoryAssetIntakeRepository(),
    ledger,
    () => '2026-07-27T00:00:00.000Z',
  );
  await ledger.append({
    factId: 'store-profile:name:other',
    workspaceId: 'workspace-a',
    kind: 'other',
    key: 'store.profile.name',
    value: { name: '青禾美甲' },
    scope: { storeId: 'workspace-a' },
    source: {
      kind: 'user_confirmation',
      referenceId: 'earlier',
      capturedAt: confirmedAt,
    },
    effectiveFrom: confirmedAt,
    expiresAt: null,
    recordedAt: confirmedAt,
    recordedBy: 'owner-a',
    expectedRevision: 0,
  });
  const subject = new StoreProfileImportPreparer(
    { read: async () => profile() },
    intake,
    () => '2026-07-27T00:00:00.000Z',
  );

  const { batch } = await subject.prepare(context);
  assert.ok(
    !batch!.candidates.some(
      (candidate) => candidate.candidateId === 'store-profile:name:other:import',
    ),
  );
});

test('unconfirmed projects and empty profile fields are not staged', async () => {
  const { subject } = preparer(
    profile({
      address: '   ',
      projects: [
        {
          confirmed: false,
          durationMinutes: 60,
          id: 'draft-project',
          name: '草稿项目',
          price: 1,
        },
      ],
    }),
  );
  const { batch } = await subject.prepare(context);

  assert.ok(
    !batch!.candidates.some((candidate) =>
      candidate.candidateId.includes('draft-project'),
    ),
  );
  assert.ok(
    !batch!.candidates.some((candidate) =>
      candidate.candidateId.startsWith('store-profile:address'),
    ),
  );
});

test('a workspace without a stored profile stages nothing', async () => {
  const { subject } = preparer(undefined);
  assert.deepEqual(await subject.prepare(context), {
    batch: null,
    profileRevision: 0,
  });
});
