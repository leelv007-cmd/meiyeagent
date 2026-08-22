import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryStoreFactLedger } from '../operations/store-fact-ledger.js';
import {
  deriveMaterialFactRefs,
  resolveExplicitFactGrants,
} from './composer-submission-gate.js';

const FACT = {
  factId: 'service-main',
  workspaceId: 'workspace-a',
  kind: 'service' as const,
  key: 'service.name',
  value: { name: '头皮护理' },
  scope: { storeId: 'store-a', serviceId: 'service-a' },
  source: {
    kind: 'user_confirmation' as const,
    referenceId: 'confirmation-1',
    capturedAt: '2026-08-19T01:00:00.000Z',
  },
  effectiveFrom: '2026-08-19T01:00:00.000Z',
  expiresAt: null,
  recordedAt: '2026-08-19T01:00:00.000Z',
  recordedBy: 'owner-a',
};

test('explicit free facts are server-granted only from current active tenant heads', async () => {
  const facts = new MemoryStoreFactLedger();
  await facts.append({ ...FACT, expectedRevision: 0 });

  assert.deepEqual(
    await resolveExplicitFactGrants({
      workspaceId: 'workspace-a',
      requestedFactRefs: ['store_fact:service-main:1'],
      at: '2026-08-19T02:00:00.000Z',
      facts,
    }),
    ['store_fact:service-main:1'],
  );

  for (const [workspaceId, reference] of [
    ['workspace-a', 'store_fact:forged:1'],
    ['workspace-b', 'store_fact:service-main:1'],
  ] as const) {
    await assert.rejects(
      resolveExplicitFactGrants({
        workspaceId,
        requestedFactRefs: [reference],
        at: '2026-08-19T02:00:00.000Z',
        facts,
      }),
      /missing, stale, inactive, or outside this workspace/u,
    );
  }

  await facts.append({
    ...FACT,
    source: { ...FACT.source, referenceId: 'confirmation-2' },
    recordedAt: '2026-08-19T03:00:00.000Z',
    expectedRevision: 1,
  });
  await assert.rejects(
    resolveExplicitFactGrants({
      workspaceId: 'workspace-a',
      requestedFactRefs: ['store_fact:service-main:1'],
      at: '2026-08-19T04:00:00.000Z',
      facts,
    }),
    /missing, stale, inactive, or outside this workspace/u,
  );
});

test('explicit fact request fails closed when tenant authority is unavailable', async () => {
  assert.deepEqual(
    await resolveExplicitFactGrants({
      workspaceId: 'workspace-a',
      at: '2026-08-19T02:00:00.000Z',
    }),
    [],
  );
  await assert.rejects(
    resolveExplicitFactGrants({
      workspaceId: 'workspace-a',
      requestedFactRefs: ['store_fact:service-main:1'],
      at: '2026-08-19T02:00:00.000Z',
    }),
    /authorization is unavailable/u,
  );
});

/**
 * V31-28 / §37.4-E. A 定制创作 submission carries no `requestedFactRefs` — the
 * App Shell populates that array only in 自由创作 (composer-home.tsx:2625) — so
 * the frozen snapshot's `factRevisionRefs` was empty for every customized run,
 * and admission's `sameIdSet(frozen, live)` compared empty against empty. A
 * price revision landing before confirmation could not be seen. These cases pin
 * the server-side derivation that gives the fence something to compare.
 */
const MATERIAL_BASE = {
  ...FACT,
  scope: { storeId: 'workspace-a' },
};

test('§37.4-E: a customized run derives its material fact grants server-side', async () => {
  const facts = new MemoryStoreFactLedger();
  await facts.append({
    ...MATERIAL_BASE,
    factId: 'price-main',
    kind: 'price',
    key: 'price.main',
    value: { amount: 199 },
    expectedRevision: 0,
  });
  // Not material: an ordinary service fact with no validity window.
  await facts.append({
    ...MATERIAL_BASE,
    factId: 'service-main',
    expectedRevision: 0,
  });
  // Material by validity window even though its kind is not a price kind.
  await facts.append({
    ...MATERIAL_BASE,
    factId: 'service-limited',
    expiresAt: '2026-08-20T00:00:00.000Z',
    expectedRevision: 0,
  });

  const derived = await deriveMaterialFactRefs({
    workspaceId: 'workspace-a',
    at: '2026-08-19T02:00:00.000Z',
    facts,
  });
  assert.deepEqual(derived, [
    'store_fact:price-main:1',
    'store_fact:service-limited:1',
  ]);

  // Derivation is a request, not an authority: the refs still go through the
  // same pinned-head grant channel a merchant-requested ref goes through.
  assert.deepEqual(
    await resolveExplicitFactGrants({
      workspaceId: 'workspace-a',
      requestedFactRefs: derived,
      at: '2026-08-19T02:00:00.000Z',
      facts,
    }),
    derived,
  );
});

test('§37.4-E: derived grants track the head, and a superseded head fails closed', async () => {
  const facts = new MemoryStoreFactLedger();
  await facts.append({
    ...MATERIAL_BASE,
    factId: 'price-main',
    kind: 'price',
    key: 'price.main',
    value: { amount: 199 },
    expectedRevision: 0,
  });
  await facts.append({
    ...MATERIAL_BASE,
    factId: 'price-main',
    kind: 'price',
    key: 'price.main',
    value: { amount: 259 },
    source: { ...FACT.source, referenceId: 'confirmation-2' },
    effectiveFrom: '2026-08-19T03:00:00.000Z',
    recordedAt: '2026-08-19T03:00:00.000Z',
    expectedRevision: 1,
  });

  // The freeze taken after the revision names r2 — this is the live half the
  // fence compares the frozen r1 against.
  assert.deepEqual(
    await deriveMaterialFactRefs({
      workspaceId: 'workspace-a',
      at: '2026-08-19T04:00:00.000Z',
      facts,
    }),
    ['store_fact:price-main:2'],
  );
  // And r1 can no longer be granted, so a stale derivation cannot be replayed.
  await assert.rejects(
    resolveExplicitFactGrants({
      workspaceId: 'workspace-a',
      requestedFactRefs: ['store_fact:price-main:1'],
      at: '2026-08-19T04:00:00.000Z',
      facts,
    }),
    /missing, stale, inactive, or outside this workspace/u,
  );
});

test('§37.4-E: derivation without a tenant fact authority yields no grants', async () => {
  assert.deepEqual(
    await deriveMaterialFactRefs({
      workspaceId: 'workspace-a',
      at: '2026-08-19T02:00:00.000Z',
    }),
    [],
  );
});

test('§37.4-E: derivation is sorted and bounded so it cannot overrun the snapshot cap', async () => {
  const facts = new MemoryStoreFactLedger();
  for (const suffix of ['c', 'a', 'b']) {
    await facts.append({
      ...MATERIAL_BASE,
      factId: `price-${suffix}`,
      kind: 'price',
      key: `price.${suffix}`,
      value: { amount: 100 },
      expectedRevision: 0,
    });
  }
  // Deterministic order is what makes the bound in `admit()` safe: the kept
  // prefix is always the same set, not whichever rows the ledger returned first.
  assert.deepEqual(
    await deriveMaterialFactRefs({
      workspaceId: 'workspace-a',
      at: '2026-08-19T02:00:00.000Z',
      facts,
    }),
    ['store_fact:price-a:1', 'store_fact:price-b:1', 'store_fact:price-c:1'],
  );
});
