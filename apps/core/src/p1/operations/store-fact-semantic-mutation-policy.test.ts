import assert from 'node:assert/strict';
import test from 'node:test';

import {
  classifyStoreFactMutation,
  StoreFactSemanticMutationError,
  StoreFactSemanticMutationPolicy,
} from './store-fact-semantic-mutation-policy.js';
import {
  MemoryStoreFactLedger,
  StoreFactRevisionConflictError,
} from './store-fact-ledger.js';

const baseInput = {
  effectiveFrom: '2026-07-25T00:00:00.000Z',
  expiresAt: null,
  factId: 'fact-1',
  key: 'offer.price',
  kind: 'price' as const,
  recordedAt: '2026-07-25T00:00:00.000Z',
  recordedBy: 'owner-1',
  scope: { storeId: 'store-1' },
  source: {
    capturedAt: '2026-07-25T00:00:00.000Z',
    kind: 'user_confirmation' as const,
    referenceId: 'owner-1',
  },
  value: { amount: 128, currency: 'CNY' },
  workspaceId: 'workspace-1',
};

test('classifies new facts, corrections, and revocations in one append-only policy', () => {
  assert.equal(
    classifyStoreFactMutation({ ...baseInput, expectedRevision: 0 }),
    'new_fact',
  );
  assert.equal(
    classifyStoreFactMutation({ ...baseInput, expectedRevision: 1 }),
    'correction',
  );
  assert.equal(
    classifyStoreFactMutation({
      ...baseInput,
      expectedRevision: 1,
      revisionKind: 'revocation',
      value: null,
    }),
    'revocation',
  );
});

test('revocation must supersede an existing fact with a null append', async () => {
  const policy = new StoreFactSemanticMutationPolicy(
    new MemoryStoreFactLedger(),
  );

  await assert.rejects(
    policy.append({
      ...baseInput,
      expectedRevision: 0,
      revisionKind: 'revocation',
      value: null,
    }),
    (error: unknown) =>
      error instanceof StoreFactSemanticMutationError &&
      error.code === 'STORE_FACT_REVOCATION_WITHOUT_PREDECESSOR',
  );
  await assert.rejects(
    policy.append({
      ...baseInput,
      expectedRevision: 1,
      revisionKind: 'revocation',
      value: { amount: 128, currency: 'CNY' },
    }),
    (error: unknown) =>
      error instanceof StoreFactSemanticMutationError &&
      error.code === 'STORE_FACT_REVOCATION_VALUE_NOT_NULL',
  );
});

test('concurrent semantic mutations retain the ledger 409 OCC meaning', async () => {
  const policy = new StoreFactSemanticMutationPolicy(
    new MemoryStoreFactLedger(),
  );
  await policy.append({ ...baseInput, expectedRevision: 0 });

  const attempts = await Promise.allSettled([
    policy.append({
      ...baseInput,
      expectedRevision: 1,
      value: { amount: 138, currency: 'CNY' },
    }),
    policy.append({
      ...baseInput,
      expectedRevision: 1,
      value: { amount: 148, currency: 'CNY' },
    }),
  ]);
  assert.equal(
    attempts.filter(({ status }) => status === 'fulfilled').length,
    1,
  );
  const conflict = attempts.find(
    ({ status }) => status === 'rejected',
  ) as PromiseRejectedResult;
  assert.ok(conflict.reason instanceof StoreFactRevisionConflictError);
  assert.equal(conflict.reason.status, 409);
});
