import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTEXT_DIMENSIONS,
  CONTEXT_SOURCE_REVISION_KEYS,
  contextBundleSchema,
  storeFactSchema,
} from './context-bundle.js';

test('store facts require immutable version, source, scope and a valid time window', () => {
  const fact = {
    factId: 'price-main',
    workspaceId: 'workspace-a',
    kind: 'price',
    key: 'service.price',
    value: { amount: 239, currency: 'CNY' },
    scope: { storeId: 'store-a', serviceId: 'service-a' },
    source: {
      kind: 'user_confirmation',
      referenceId: 'confirmation-1',
      capturedAt: '2026-07-18T01:00:00.000Z',
    },
    effectiveFrom: '2026-07-18T01:00:00.000Z',
    expiresAt: '2026-08-18T01:00:00.000Z',
    revision: 1,
    recordedAt: '2026-07-18T01:00:00.000Z',
    recordedBy: 'owner-a',
  };

  assert.equal(storeFactSchema.safeParse(fact).success, true);
  assert.equal(
    storeFactSchema.safeParse({ ...fact, expiresAt: fact.effectiveFrom })
      .success,
    false,
  );
  assert.equal(storeFactSchema.safeParse({ ...fact, revision: 0 }).success, false);
});

test('ContextBundle contract freezes six dimensions and all eight source revisions', () => {
  assert.deepEqual(CONTEXT_DIMENSIONS, [
    'promotion_task',
    'traffic_opportunity',
    'expression_identity',
    'platform_mechanism',
    'store_facts_assets',
    'conversion_action',
  ]);
  assert.deepEqual(CONTEXT_SOURCE_REVISION_KEYS, [
    'facts',
    'assets',
    'identity',
    'rights',
    'preferences',
    'recipe',
    'platformRules',
    'currentSignal',
  ]);

  const emptyDimensions = Object.fromEntries(
    CONTEXT_DIMENSIONS.map((dimension) => [dimension, {}]),
  );
  const bundle = {
    serializerVersion: 'context-bundle-c14n-v1',
    workspaceId: 'workspace-a',
    taskId: 'task-a',
    sourceRevisions: Object.fromEntries(
      CONTEXT_SOURCE_REVISION_KEYS.map((key) => [key, 0]),
    ),
    dimensions: emptyDimensions,
    referencedFactRevisions: [],
    bundleId: 'bundle-a',
    revision: 1,
    hash: 'a'.repeat(64),
    frozenAt: '2026-07-18T01:00:00.000Z',
    frozenBy: 'owner-a',
    previousRevision: null,
  };

  assert.equal(contextBundleSchema.safeParse(bundle).success, true);
  const { rights: _rights, ...sevenSources } = bundle.sourceRevisions;
  assert.equal(
    contextBundleSchema.safeParse({
      ...bundle,
      sourceRevisions: sevenSources,
    }).success,
    false,
  );
});
