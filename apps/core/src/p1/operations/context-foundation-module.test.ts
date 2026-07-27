import assert from 'node:assert/strict';
import test from 'node:test';
import { type ContextBundle } from '@meiye/contracts';
import { MemoryContextBundleRepository } from './context-bundle-repository.js';
import { ContextFoundationModule } from './context-foundation-module.js';
import { MemoryStoreFactLedger } from './store-fact-ledger.js';
import { MemoryContextSourceRevisionRepository } from './context-source-revisions.js';

// These tests invoke the trusted kernel module directly; browser callers must
// use the mapped finalize_store_intake command instead.
const context = {
  actor: 'owner' as const,
  correlationId: 'corr-context',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};
test('context module compiles only active ledger facts and reports the eight-source fence', async () => {
  const facts = new MemoryStoreFactLedger();
  const bundles = new MemoryContextBundleRepository();
  const sourceRevisions = new MemoryContextSourceRevisionRepository();
  let now = '2026-07-18T01:00:00.000Z';
  const module = new ContextFoundationModule(
    facts,
    bundles,
    sourceRevisions,
    () => now,
  );
  const append = (factId: string, expiresAt: string | null) =>
    module.execute({
      context,
      idempotencyKey: `append-${factId}`,
      input: {
        action: 'store_fact_append',
        payload: {
          factId,
          kind: 'price',
          key: `price.${factId}`,
          value: { amount: 239, currency: 'CNY' },
          scope: { storeId: 'store-a' },
          source: {
            kind: 'user_confirmation',
            referenceId: `confirmation-${factId}`,
            capturedAt: now,
          },
          effectiveFrom: now,
          expiresAt,
          expectedRevision: 0,
        },
      },
    });
  await append('active', null);
  await append('expired', '2026-07-18T02:00:00.000Z');
  now = '2026-07-18T03:00:00.000Z';

  const bundle = (await module.execute({
    context,
    idempotencyKey: 'compile-1',
    input: {
      action: 'context_bundle_compile',
      payload: {
        bundleId: 'bundle-a',
        taskId: 'task-a',
        scope: { storeId: 'store-a' },
        at: now,
        expectedRevision: 0,
        contributions: [],
        reason: 'initial compile',
      },
    },
  })) as ContextBundle;
  assert.deepEqual(bundle.referencedFactRevisions, [
    { factId: 'active', revision: 1 },
  ]);
  assert.equal(typeof bundle.sourceRevisions.facts, 'string');
  await sourceRevisions.advance({
    workspaceId: context.workspaceId,
    key: 'assets',
    expectedRevision: 0,
  });

  const fence = (await module.query({
    context,
    input: {
      action: 'context_bundle_fence',
      payload: {
        bundleId: 'bundle-a',
        scope: { storeId: 'store-a' },
        at: now,
      },
    },
  })) as { stale: boolean; changedSources: string[] };
  assert.equal(fence.stale, true);
  assert.deepEqual(fence.changedSources, ['assets']);
});

test('context module rejects caller-supplied fact values and references', async () => {
  const module = new ContextFoundationModule(
    new MemoryStoreFactLedger(),
    new MemoryContextBundleRepository(),
    new MemoryContextSourceRevisionRepository(),
    () => '2026-07-18T03:00:00.000Z',
  );
  await assert.rejects(
    module.execute({
      context,
      idempotencyKey: 'compile-with-fake-fact',
      input: {
        action: 'context_bundle_compile',
        payload: {
          bundleId: 'bundle-a',
          taskId: 'task-a',
          scope: { storeId: 'store-a' },
          at: '2026-07-18T03:00:00.000Z',
          expectedRevision: 0,
          contributions: [
            {
              dimension: 'store_facts_assets',
              key: 'offer.price',
              value: 1,
              layer: 'industry_recipe',
              pool: 'industry',
              sourceRef: 'fake-fact',
              factRevision: { factId: 'not-in-ledger', revision: 1 },
            },
          ],
          reason: 'invalid compile',
        },
      },
    }),
    /fact ledger/,
  );
});

test('a fact crossing expiresAt makes the frozen bundle fence stale without another write', async () => {
  const facts = new MemoryStoreFactLedger();
  const bundles = new MemoryContextBundleRepository();
  const module = new ContextFoundationModule(
    facts,
    bundles,
    new MemoryContextSourceRevisionRepository(),
    () => '2026-07-18T01:00:00.000Z',
  );
  await facts.append({
    factId: 'limited-offer',
    workspaceId: context.workspaceId,
    kind: 'discount',
    key: 'offer.discount',
    value: '20%',
    scope: { storeId: 'store-a' },
    source: {
      kind: 'user_confirmation',
      referenceId: 'confirmation-limited-offer',
      capturedAt: '2026-07-18T00:00:00.000Z',
    },
    effectiveFrom: '2026-07-18T00:00:00.000Z',
    expiresAt: '2026-07-18T02:00:00.000Z',
    recordedAt: '2026-07-18T00:00:00.000Z',
    recordedBy: context.userId,
    expectedRevision: 0,
  });
  await module.execute({
    context,
    idempotencyKey: 'compile-before-expiry',
    input: {
      action: 'context_bundle_compile',
      payload: {
        bundleId: 'bundle-expiry',
        taskId: 'task-expiry',
        scope: { storeId: 'store-a' },
        at: '2026-07-18T01:00:00.000Z',
        expectedRevision: 0,
        contributions: [],
        reason: 'initial compile',
      },
    },
  });

  const fence = (await module.query({
    context,
    input: {
      action: 'context_bundle_fence',
      payload: {
        bundleId: 'bundle-expiry',
        scope: { storeId: 'store-a' },
        at: '2026-07-18T02:00:00.000Z',
      },
    },
  })) as { stale: boolean; changedSources: string[] };
  assert.equal(fence.stale, true);
  assert.deepEqual(fence.changedSources, ['facts']);
});

test('canonical fact append accepts a superseding revocation revision', async () => {
  const facts = new MemoryStoreFactLedger();
  const module = new ContextFoundationModule(
    facts,
    new MemoryContextBundleRepository(),
    new MemoryContextSourceRevisionRepository(),
    () => '2026-07-18T03:00:00.000Z',
  );
  const base = {
    factId: 'revoked-price',
    kind: 'price',
    key: 'offer.price',
    scope: { storeId: 'store-a' },
    source: {
      kind: 'user_confirmation',
      referenceId: 'confirmation-price',
      capturedAt: '2026-07-18T01:00:00.000Z',
    },
    effectiveFrom: '2026-07-18T01:00:00.000Z',
    expiresAt: null,
  };
  await module.execute({
    context,
    idempotencyKey: 'append-price',
    input: {
      action: 'store_fact_append',
      payload: {
        ...base,
        value: { amount: 239, currency: 'CNY' },
        expectedRevision: 0,
      },
    },
  });
  await module.execute({
    context,
    idempotencyKey: 'revoke-price',
    input: {
      action: 'store_fact_append',
      payload: {
        ...base,
        value: null,
        revisionKind: 'revocation',
        source: {
          ...base.source,
          referenceId: 'confirmation-price-revocation',
        },
        effectiveFrom: '2026-07-18T02:00:00.000Z',
        expectedRevision: 1,
      },
    },
  });

  assert.deepEqual(
    await facts.listActive({
      workspaceId: context.workspaceId,
      scope: { storeId: 'store-a' },
      at: '2026-07-18T03:00:00.000Z',
    }),
    [],
  );
  assert.deepEqual(
    (await facts.history(context.workspaceId, 'revoked-price')).map((fact) => ({
      revision: fact.revision,
      revisionKind: fact.revisionKind,
    })),
    [
      { revision: 1, revisionKind: undefined },
      { revision: 2, revisionKind: 'revocation' },
    ],
  );
});
