import assert from 'node:assert/strict';
import test from 'node:test';

import { MemoryStoreFactLedger } from '../operations/store-fact-ledger.js';
import { resolveExplicitFactGrants } from './composer-submission-gate.js';

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
