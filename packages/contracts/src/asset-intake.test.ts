import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assetIntakeBatchSchema,
  assetIntakeCapabilitySchema,
  assetIntakeDecisionEventSchema,
  confirmedFactReferenceSchema,
  finalizeStoreIntakeCommandSchema,
  recordAssetIntakeBatchCommandSchema,
} from './asset-intake.js';

const source = {
  sourceId: 'source-price-list',
  kind: 'price_list',
  referenceId: 'upload-price-list',
  capabilityStatus: 'assisted',
  sourceWorkspaceId: 'workspace-a',
  capturedAt: '2026-07-18T01:00:00.000Z',
  example: false,
} as const;

test('asset intake keeps fact, authorized asset and identity candidates in distinct channels', () => {
  const batch = assetIntakeBatchSchema.parse({
    batchId: 'batch-a',
    workspaceId: 'workspace-a',
    taskId: 'task-a',
    source,
    summary: '识别到头皮清洁项目价格，并保留一张已授权价目表图片。',
    candidates: [
      {
        candidateId: 'candidate-price',
        objectKind: 'store_fact',
        status: 'pending',
        fact: {
          kind: 'price',
          key: 'service.scalp-clean.price',
          value: { amount: 239, currency: 'CNY' },
          scope: { storeId: 'store-a', serviceId: 'scalp-clean' },
          source: {
            kind: 'screenshot_extraction',
            referenceId: source.referenceId,
            capturedAt: source.capturedAt,
          },
          effectiveFrom: '2026-07-18T01:00:00.000Z',
          expiresAt: '2026-08-18T01:00:00.000Z',
        },
      },
      {
        candidateId: 'candidate-asset',
        objectKind: 'authorized_asset',
        status: 'pending',
        assetId: 'asset-a',
      },
      {
        candidateId: 'candidate-identity',
        objectKind: 'identity_candidate',
        status: 'pending',
        candidateRef: 'identity-candidate-a',
      },
    ],
    createdAt: '2026-07-18T01:00:01.000Z',
  });

  assert.deepEqual(
    batch.candidates.map((candidate) => candidate.objectKind),
    ['store_fact', 'authorized_asset', 'identity_candidate'],
  );
  assert.equal('fact' in batch.candidates[1]!, false);
  assert.equal('fact' in batch.candidates[2]!, false);
});

test('assisted intake advertises concrete fallback inputs without claiming verified parsing', () => {
  assert.deepEqual(
    assetIntakeCapabilitySchema.parse({
      status: 'assisted',
      fallbackInputs: ['screenshot', 'paste_text', 'manual_select'],
      reason: 'The source requires login.',
    }).fallbackInputs,
    ['screenshot', 'paste_text', 'manual_select'],
  );
  assert.throws(() =>
    assetIntakeCapabilitySchema.parse({
      status: 'assisted',
      fallbackInputs: [],
      reason: 'The source requires login.',
    }),
  );
});

test('confirmed fact references bind the exact fact and ContextBundle revisions', () => {
  assert.deepEqual(
    confirmedFactReferenceSchema.parse({
      factId: 'fact-price',
      factRevision: 2,
      taskId: 'task-next',
      contextBundleId: 'bundle-next',
      contextBundleRevision: 3,
    }),
    {
      factId: 'fact-price',
      factRevision: 2,
      taskId: 'task-next',
      contextBundleId: 'bundle-next',
      contextBundleRevision: 3,
    },
  );
});

test('asset intake corrections and confirmations are append-only typed events', () => {
  const corrected = assetIntakeDecisionEventSchema.parse({
    eventId: 'event-correct-price',
    workspaceId: 'workspace-a',
    batchId: 'batch-a',
    candidateId: 'candidate-price',
    candidateRevision: 1,
    action: 'corrected',
    correctedFact: {
      kind: 'price',
      key: 'service.scalp-clean.price',
      value: { amount: 299, currency: 'CNY' },
      scope: { storeId: 'store-a', serviceId: 'scalp-clean' },
      source: {
        kind: 'user_confirmation',
        referenceId: 'decision-correct-price',
        capturedAt: '2026-07-18T02:00:00.000Z',
      },
      effectiveFrom: '2026-07-18T02:00:00.000Z',
      expiresAt: null,
    },
    actorId: 'owner-a',
    occurredAt: '2026-07-18T02:00:00.000Z',
  });
  assert.equal(corrected.action, 'corrected');
  assert.deepEqual(corrected.correctedFact.value, {
    amount: 299,
    currency: 'CNY',
  });
});

test('asset intake commands cannot forge server-owned workspace or creation time', () => {
  const command = {
    batchId: 'batch-command',
    taskId: 'task-command',
    source,
    summary: '识别到一个待确认价格。',
    candidates: [
      {
        candidateId: 'candidate-command',
        objectKind: 'store_fact' as const,
        status: 'pending' as const,
        fact: {
          kind: 'price' as const,
          key: 'service.scalp-clean.price',
          value: 239,
          scope: { storeId: 'store-a' },
          source: {
            kind: 'screenshot_extraction' as const,
            referenceId: source.referenceId,
            capturedAt: source.capturedAt,
          },
          effectiveFrom: source.capturedAt,
          expiresAt: null,
        },
      },
    ],
  };
  assert.deepEqual(recordAssetIntakeBatchCommandSchema.parse(command), command);
  assert.throws(() =>
    recordAssetIntakeBatchCommandSchema.parse({
      ...command,
      workspaceId: 'forged-workspace',
    }),
  );
  assert.throws(() =>
    recordAssetIntakeBatchCommandSchema.parse({
      ...command,
      createdAt: source.capturedAt,
    }),
  );
});

test('a limited-time price travels with the window the merchant stated', () => {
  // #244 — the window is not decoration: the candidate carries it, the profile
  // side repeats it, and a window that ends before it starts is refused rather
  // than quietly flattened to "never expires".
  const validUntil = '2026-08-31T15:59:59.999Z';
  const priceCandidate = {
    candidateId: 'candidate-price',
    objectKind: 'store_fact' as const,
    status: 'pending' as const,
    fact: {
      kind: 'price' as const,
      key: 'service.scalp-clean.price',
      value: { amount: 239, currency: 'CNY' },
      scope: { storeId: 'workspace-a', serviceId: 'scalp-clean' },
      source: {
        kind: 'user_confirmation' as const,
        referenceId: source.referenceId,
        capturedAt: source.capturedAt,
      },
      effectiveFrom: source.capturedAt,
      expiresAt: validUntil,
    },
  };
  const command = {
    batch: {
      batchId: 'batch-finalize-price-window',
      taskId: 'task-finalize-price-window',
      source: { ...source, kind: 'manual' as const },
      summary: '确认一个限时活动价。',
      candidates: [priceCandidate],
    },
    confirmations: [
      {
        candidateId: priceCandidate.candidateId,
        factId: 'store-project:scalp-clean:price',
        expectedFactRevision: 0,
      },
    ],
    profilePatch: {
      expectedRevision: 1,
      projects: {
        upsert: [
          {
            id: 'scalp-clean',
            name: '头皮清洁',
            price: 239,
            durationMinutes: 60,
            confirmed: true,
            priceValidUntil: validUntil,
          },
        ],
      },
    },
  };
  const parsed = finalizeStoreIntakeCommandSchema.parse(command);
  const parsedBatch = parsed.batch;
  assert.ok('candidates' in parsedBatch);
  const parsedCandidate = parsedBatch.candidates[0];
  assert.ok(parsedCandidate && 'fact' in parsedCandidate);
  assert.equal(parsedCandidate.fact.expiresAt, validUntil);
  assert.equal(
    parsed.profilePatch.projects?.upsert?.[0]?.priceValidUntil,
    validUntil,
  );

  // A standing price is a stated answer too, and it says so with `null`.
  const standing = finalizeStoreIntakeCommandSchema.parse({
    ...command,
    batch: {
      ...command.batch,
      candidates: [
        { ...priceCandidate, fact: { ...priceCandidate.fact, expiresAt: null } },
      ],
    },
    profilePatch: {
      ...command.profilePatch,
      projects: {
        upsert: [
          { ...command.profilePatch.projects.upsert[0]!, priceValidUntil: null },
        ],
      },
    },
  });
  assert.equal(standing.profilePatch.projects?.upsert?.[0]?.priceValidUntil, null);

  assert.throws(() =>
    finalizeStoreIntakeCommandSchema.parse({
      ...command,
      batch: {
        ...command.batch,
        candidates: [
          {
            ...priceCandidate,
            fact: { ...priceCandidate.fact, expiresAt: source.capturedAt },
          },
        ],
      },
    }),
  );
});

test('store intake finalization rejects two candidates targeting the same fact stream', () => {
  const candidate = {
    candidateId: 'candidate-service',
    objectKind: 'store_fact' as const,
    status: 'pending' as const,
    fact: {
      kind: 'service' as const,
      key: 'service.scalp-clean.name',
      value: '头皮清洁',
      scope: { storeId: 'workspace-a' },
      source: {
        kind: 'user_confirmation' as const,
        referenceId: source.referenceId,
        capturedAt: source.capturedAt,
      },
      effectiveFrom: source.capturedAt,
      expiresAt: null,
    },
  };
  assert.throws(() =>
    finalizeStoreIntakeCommandSchema.parse({
      batch: {
        batchId: 'batch-finalize-duplicate',
        taskId: 'task-finalize-duplicate',
        source,
        summary: '确认两条候选。',
        candidates: [
          candidate,
          {
            ...candidate,
            candidateId: 'candidate-service-duplicate',
          },
        ],
      },
      confirmations: [
        {
          candidateId: candidate.candidateId,
          factId: 'store-project:scalp-clean:service',
          expectedFactRevision: 0,
        },
        {
          candidateId: 'candidate-service-duplicate',
          factId: 'store-project:scalp-clean:service',
          expectedFactRevision: 0,
        },
      ],
      profilePatch: { expectedRevision: 0 },
    }),
  );
});

test('store intake finalization can reference a server-persisted batch', () => {
  const parsed = finalizeStoreIntakeCommandSchema.parse({
    batch: { batchId: 'server-batch-a' },
    confirmations: [
      {
        candidateId: 'candidate-service',
        factId: 'store-project:scalp-clean:service',
        expectedFactRevision: 0,
      },
    ],
    profilePatch: { expectedRevision: 1 },
  });

  assert.deepEqual(parsed.batch, { batchId: 'server-batch-a' });
});

test('store intake finalization rejects a non-manual inline batch', () => {
  assert.throws(() =>
    finalizeStoreIntakeCommandSchema.parse({
      batch: {
        batchId: 'forged-screenshot',
        taskId: 'task-forged-screenshot',
        source: {
          ...source,
          kind: 'group_buy_screenshot',
        },
        summary: 'Client asserted screenshot parse.',
        candidates: [
          {
            candidateId: 'candidate-price',
            objectKind: 'store_fact',
            status: 'pending',
            fact: {
              kind: 'price',
              key: 'service.scalp-clean.price',
              value: { amount: 299, currency: 'CNY' },
              scope: {
                storeId: 'workspace-a',
                serviceId: 'scalp-clean',
              },
              source: {
                kind: 'screenshot_extraction',
                referenceId: source.referenceId,
                capturedAt: source.capturedAt,
              },
              effectiveFrom: source.capturedAt,
              expiresAt: null,
            },
          },
        ],
      },
      confirmations: [
        {
          candidateId: 'candidate-price',
          factId: 'store-project:scalp-clean:price',
          expectedFactRevision: 0,
        },
      ],
      profilePatch: { expectedRevision: 1 },
    }),
  );
});
