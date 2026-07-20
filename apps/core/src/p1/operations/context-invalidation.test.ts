import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTEXT_SOURCE_REVISION_KEYS,
  type ContextContribution,
  type ContextInvalidationEvent,
} from '@meiye/contracts';
import { MemoryContextBundleRepository } from './context-bundle-repository.js';
import { compileContextBundle } from './context-compiler.js';
import {
  ContextInvalidationService,
  type ContextInvalidationSink,
} from './context-invalidation.js';

const sourceRevisions = Object.fromEntries(
  CONTEXT_SOURCE_REVISION_KEYS.map((key) => [key, 1]),
);

function factContribution(
  factId: string,
  revision = 1,
): ContextContribution {
  return {
    dimension: 'store_facts_assets',
    key: `fact.${factId}`,
    value: factId,
    layer: 'current_fact',
    pool: 'store_personal',
    sourceRef: `store_fact:${factId}:${revision}`,
    factRevision: { factId, revision },
  };
}

test('fact expiry invalidates only bundles that reference the expired revision and uses a revision-aware event id', async () => {
  const repository = new MemoryContextBundleRepository();
  for (const [bundleId, factId, revision] of [
    ['bundle-price-v1', 'price', 1],
    ['bundle-price-v2', 'price', 2],
    ['bundle-qualification', 'qualification', 1],
  ] as const) {
    await repository.freeze({
      workspaceId: 'workspace-a',
      bundleId,
      compiled: compileContextBundle({
        workspaceId: 'workspace-a',
        taskId: `task-${factId}`,
        sourceRevisions: sourceRevisions as never,
        contributions: [factContribution(factId, revision)],
      }),
      expectedRevision: 0,
      frozenAt: '2026-07-18T01:00:00.000Z',
      frozenBy: 'owner-a',
      idempotencyKey: `freeze-${bundleId}`,
      reason: 'initial compile',
    });
  }
  const received: ContextInvalidationEvent[] = [];
  const sink: ContextInvalidationSink = {
    async handle(event) {
      received.push(event);
    },
  };
  const service = new ContextInvalidationService(repository, [sink]);
  const event = await service.invalidateExpiredFact({
    workspaceId: 'workspace-a',
    factId: 'price',
    revision: 1,
    expiresAt: '2026-07-19T01:00:00.000Z',
  });

  assert.equal(received.length, 1);
  assert.deepEqual(event.affectedBundleReferences, [
    {
      bundleId: 'bundle-price-v1',
      revision: 1,
      hash: event.affectedBundleReferences[0]?.hash,
    },
  ]);
  assert.equal(event.reason, 'fact_expired');
  assert.equal(
    event.eventId,
    'context-invalidation:workspace-a:facts:price:1:2026-07-19T01:00:00.000Z',
  );
  assert.equal(
    (await repository.get('workspace-a', 'bundle-price-v1', 1))?.revision,
    1,
  );
  assert.equal(
    (await repository.get('workspace-a', 'bundle-qualification', 1))?.revision,
    1,
  );
});
