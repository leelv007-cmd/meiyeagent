import assert from 'node:assert/strict';
import test from 'node:test';
import { ContextFoundationModule } from './context-foundation-module.js';
import { MemoryStoreFactLedger } from './store-fact-ledger.js';

// These tests invoke the trusted kernel module directly; browser callers must
// use the mapped finalize_store_intake command instead.
const context = {
  actor: 'owner' as const,
  correlationId: 'corr-context',
  userId: 'owner-a',
  workspaceId: 'workspace-a',
};
test('context module exposes canonical append, active facts, and fact history', async () => {
  const facts = new MemoryStoreFactLedger();
  let now = '2026-07-18T01:00:00.000Z';
  const module = new ContextFoundationModule(facts, () => now);
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

  const activeFacts = await module.query({
    context,
    input: {
      action: 'store_facts_active',
      payload: {
        scope: { storeId: 'store-a' },
        at: now,
      },
    },
  });
  assert.deepEqual(
    (activeFacts as Array<{ factId: string }>).map((fact) => fact.factId),
    ['active'],
  );
  const history = await module.query({
    context,
    input: {
      action: 'store_fact_history',
      payload: { factId: 'expired' },
    },
  });
  assert.deepEqual(
    (history as Array<{ factId: string; revision: number }>).map((fact) => ({
      factId: fact.factId,
      revision: fact.revision,
    })),
    [{ factId: 'expired', revision: 1 }],
  );
});

test('canonical fact append accepts a superseding revocation revision', async () => {
  const facts = new MemoryStoreFactLedger();
  const module = new ContextFoundationModule(
    facts,
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
