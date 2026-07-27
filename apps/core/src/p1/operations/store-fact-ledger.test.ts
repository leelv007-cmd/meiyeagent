import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MemoryStoreFactLedger,
  StoreFactRevisionConflictError,
} from './store-fact-ledger.js';

const baseInput = {
  factId: 'price-main',
  workspaceId: 'workspace-a',
  kind: 'price' as const,
  key: 'service.price',
  value: { amount: 199, currency: 'CNY' },
  scope: { storeId: 'store-a', serviceId: 'service-a' },
  source: {
    kind: 'user_confirmation' as const,
    referenceId: 'confirmation-1',
    capturedAt: '2026-07-18T01:00:00.000Z',
  },
  effectiveFrom: '2026-07-18T01:00:00.000Z',
  expiresAt: '2026-07-20T01:00:00.000Z',
  recordedAt: '2026-07-18T01:00:00.000Z',
  recordedBy: 'owner-a',
};

test('fact ledger appends immutable revisions with optimistic concurrency', async () => {
  const ledger = new MemoryStoreFactLedger();
  const first = await ledger.append({ ...baseInput, expectedRevision: 0 });
  const second = await ledger.append({
    ...baseInput,
    value: { amount: 239, currency: 'CNY' },
    source: { ...baseInput.source, referenceId: 'confirmation-2' },
    recordedAt: '2026-07-19T01:00:00.000Z',
    expectedRevision: 1,
  });

  assert.equal(first.revision, 1);
  assert.equal(second.revision, 2);
  assert.equal(await ledger.currentRevision('workspace-a'), 2);
  assert.deepEqual(
    (await ledger.history('workspace-a', baseInput.factId)).map(
      (fact) => fact.revision,
    ),
    [1, 2],
  );
  await assert.rejects(
    ledger.append({ ...baseInput, expectedRevision: 1 }),
    StoreFactRevisionConflictError,
  );
});

test('active fact queries honor workspace, applicability, effective time and expiry', async () => {
  const ledger = new MemoryStoreFactLedger();
  await ledger.append({ ...baseInput, expectedRevision: 0 });
  await ledger.append({
    ...baseInput,
    factId: 'workspace-b-price',
    workspaceId: 'workspace-b',
    expectedRevision: 0,
  });

  const active = await ledger.listActive({
    workspaceId: 'workspace-a',
    scope: { storeId: 'store-a', serviceId: 'service-a' },
    at: '2026-07-19T00:00:00.000Z',
  });
  assert.deepEqual(active.map((fact) => fact.factId), ['price-main']);
  assert.deepEqual(
    await ledger.listActive({
      workspaceId: 'workspace-a',
      scope: { storeId: 'store-a', serviceId: 'service-b' },
      at: '2026-07-19T00:00:00.000Z',
    }),
    [],
  );
  assert.deepEqual(
    await ledger.listActive({
      workspaceId: 'workspace-a',
      scope: { storeId: 'store-a', serviceId: 'service-a' },
      at: baseInput.expiresAt,
    }),
    [],
  );
});

test('store-only queries aggregate project facts without crossing other scope boundaries', async () => {
  const ledger = new MemoryStoreFactLedger();
  const scopedFacts = [
    {
      factId: 'store-wide',
      scope: { storeId: 'store-a' },
      workspaceId: 'workspace-a',
    },
    {
      factId: 'service-a',
      scope: { storeId: 'store-a', serviceId: 'service-a' },
      workspaceId: 'workspace-a',
    },
    {
      factId: 'service-b',
      scope: { storeId: 'store-a', serviceId: 'service-b' },
      workspaceId: 'workspace-a',
    },
    {
      factId: 'persona-a',
      scope: { storeId: 'store-a', personaId: 'persona-a' },
      workspaceId: 'workspace-a',
    },
    {
      factId: 'platform-a',
      scope: { storeId: 'store-a', platform: 'xiaohongshu' },
      workspaceId: 'workspace-a',
    },
    {
      factId: 'other-store',
      scope: { storeId: 'store-b', serviceId: 'service-a' },
      workspaceId: 'workspace-a',
    },
    {
      factId: 'other-workspace',
      scope: { storeId: 'store-a', serviceId: 'service-a' },
      workspaceId: 'workspace-b',
    },
  ] as const;
  for (const fact of scopedFacts) {
    await ledger.append({
      ...baseInput,
      ...fact,
      expiresAt: null,
      expectedRevision: 0,
    });
  }

  assert.deepEqual(
    (
      await ledger.listActive({
        workspaceId: 'workspace-a',
        scope: { storeId: 'store-a' },
        at: '2026-07-19T00:00:00.000Z',
      })
    ).map((fact) => fact.factId),
    ['service-a', 'service-b', 'store-wide'],
  );
  assert.deepEqual(
    (
      await ledger.listActive({
        workspaceId: 'workspace-a',
        scope: { storeId: 'store-a', serviceId: 'service-a' },
        at: '2026-07-19T00:00:00.000Z',
      })
    ).map((fact) => fact.factId),
    ['service-a', 'store-wide'],
  );
});

test('an expired newer revision does not resurrect an older fact revision', async () => {
  const ledger = new MemoryStoreFactLedger();
  await ledger.append({ ...baseInput, expiresAt: null, expectedRevision: 0 });
  await ledger.append({
    ...baseInput,
    effectiveFrom: '2026-07-19T01:00:00.000Z',
    expiresAt: '2026-07-20T01:00:00.000Z',
    expectedRevision: 1,
  });

  assert.deepEqual(
    await ledger.listActive({
      workspaceId: 'workspace-a',
      scope: { storeId: 'store-a', serviceId: 'service-a' },
      at: '2026-07-21T01:00:00.000Z',
    }),
    [],
  );
});

test('latest semantic revision revokes a fact without mutating prior revisions', async () => {
  const ledger = new MemoryStoreFactLedger();
  await ledger.append({ ...baseInput, expiresAt: null, expectedRevision: 0 });
  await ledger.append({
    ...baseInput,
    value: null,
    expiresAt: null,
    revisionKind: 'revocation',
    source: { ...baseInput.source, referenceId: 'revocation-1' },
    effectiveFrom: '2026-07-19T01:00:00.000Z',
    recordedAt: '2026-07-19T01:00:00.000Z',
    expectedRevision: 1,
  });

  assert.deepEqual(
    await ledger.listActive({
      workspaceId: 'workspace-a',
      scope: { storeId: 'store-a', serviceId: 'service-a' },
      at: '2026-07-19T02:00:00.000Z',
    }),
    [],
  );
  assert.deepEqual(
    (await ledger.history('workspace-a', baseInput.factId)).map((fact) => ({
      revision: fact.revision,
      revisionKind: fact.revisionKind,
    })),
    [
      { revision: 1, revisionKind: undefined },
      { revision: 2, revisionKind: 'revocation' },
    ],
  );
});

test('fact identities cannot collide across colon-delimited workspaces', async () => {
  const ledger = new MemoryStoreFactLedger();
  await ledger.append({
    ...baseInput,
    workspaceId: 'a',
    factId: 'b:c',
    expectedRevision: 0,
  });
  await ledger.append({
    ...baseInput,
    workspaceId: 'a:b',
    factId: 'c',
    value: { amount: 239, currency: 'CNY' },
    expectedRevision: 0,
  });
  assert.deepEqual((await ledger.history('a', 'b:c'))[0]?.value, {
    amount: 199,
    currency: 'CNY',
  });
  assert.deepEqual((await ledger.history('a:b', 'c'))[0]?.value, {
    amount: 239,
    currency: 'CNY',
  });
});
