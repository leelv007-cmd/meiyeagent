import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CONTEXT_DIMENSIONS,
  CONTEXT_SOURCE_REVISION_KEYS,
  type ContextContribution,
  type ContextSourceRevisions,
} from '@meiye/contracts';
import {
  compileContextBundle,
  contextSourceChanges,
} from './context-compiler.js';

const revisions = Object.fromEntries(
  CONTEXT_SOURCE_REVISION_KEYS.map((key, index) => [key, index + 1]),
) as ContextSourceRevisions;

function contribution(
  overrides: Partial<ContextContribution> = {},
): ContextContribution {
  return {
    dimension: 'store_facts_assets',
    key: 'offer.price',
    value: { amount: 239, currency: 'CNY' },
    layer: 'current_fact',
    pool: 'store_personal',
    sourceRef: 'fact:offer-price:2',
    factRevision: { factId: 'offer-price', revision: 2 },
    ...overrides,
  };
}

test('six-dimension priority resolution is deterministic and protects facts from lower layers', () => {
  const contributions = CONTEXT_DIMENSIONS.flatMap((dimension) => [
    contribution({
      dimension,
      key: `${dimension}.value`,
      value: `fact-${dimension}`,
    }),
    contribution({
      dimension,
      key: `${dimension}.value`,
      value: `recipe-${dimension}`,
      layer: 'industry_recipe',
      pool: 'industry',
      sourceRef: `recipe:${dimension}`,
      factRevision: undefined,
    }),
  ]);
  contributions.push(
    contribution(),
    contribution({
      value: { amount: 99, currency: 'CNY' },
      layer: 'industry_recipe',
      pool: 'industry',
      sourceRef: 'recipe:cheap-price',
      factRevision: undefined,
    }),
    contribution({
      value: { amount: 49, currency: 'CNY' },
      layer: 'model_knowledge',
      pool: 'industry',
      sourceRef: 'model:guessed-price',
      factRevision: undefined,
    }),
  );

  const compiled = compileContextBundle({
    workspaceId: 'workspace-a',
    taskId: 'task-a',
    sourceRevisions: revisions,
    contributions,
  });

  for (const dimension of CONTEXT_DIMENSIONS) {
    assert.equal(
      compiled.payload.dimensions[dimension][`${dimension}.value`]?.value,
      `fact-${dimension}`,
    );
  }
  assert.deepEqual(
    compiled.payload.dimensions.store_facts_assets['offer.price']?.value,
    { amount: 239, currency: 'CNY' },
  );
});

test('semantic object key and contribution order differences produce the same canonical hash', () => {
  const left = [
    contribution({ value: { amount: 239, currency: 'CNY' } }),
    contribution({
      dimension: 'conversion_action',
      key: 'cta',
      value: { action: 'book', channel: 'wechat' },
      layer: 'current_instruction',
      pool: 'current_signal',
      sourceRef: 'instruction:cta',
      factRevision: undefined,
    }),
  ];
  const right = [
    contribution({
      dimension: 'conversion_action',
      key: 'cta',
      value: { channel: 'wechat', action: 'book' },
      layer: 'current_instruction',
      pool: 'current_signal',
      sourceRef: 'instruction:cta',
      factRevision: undefined,
    }),
    contribution({ value: { currency: 'CNY', amount: 239 } }),
  ];

  const a = compileContextBundle({
    workspaceId: 'workspace-a',
    taskId: 'task-a',
    sourceRevisions: revisions,
    contributions: left,
  });
  const b = compileContextBundle({
    workspaceId: 'workspace-a',
    taskId: 'task-a',
    sourceRevisions: { ...revisions },
    contributions: right,
  });

  assert.equal(a.hash, b.hash);
  assert.deepEqual(a.payload, b.payload);
});

test('unavailable or unevidenced external signals cannot enter the bundle', () => {
  const compiled = compileContextBundle({
    workspaceId: 'workspace-a',
    taskId: 'task-a',
    sourceRevisions: revisions,
    contributions: [
      contribution({
        dimension: 'traffic_opportunity',
        key: 'available_slot',
        value: 'today 15:00',
        layer: 'current_fact',
        pool: 'current_signal',
        sourceRef: 'calendar:not-connected',
        capabilityStatus: 'unavailable',
        factRevision: undefined,
      }),
      contribution({
        dimension: 'traffic_opportunity',
        key: 'manual_observation',
        value: 'afternoon is quiet',
        layer: 'current_fact',
        pool: 'current_signal',
        sourceRef: 'owner:observation',
        capabilityStatus: 'assisted',
        factRevision: undefined,
      }),
    ],
  });

  assert.equal(
    compiled.payload.dimensions.traffic_opportunity.available_slot,
    undefined,
  );
  assert.equal(
    compiled.payload.dimensions.traffic_opportunity.manual_observation?.value,
    'afternoon is quiet',
  );
});

test('the source fence compares all eight revisions', () => {
  for (const key of CONTEXT_SOURCE_REVISION_KEYS) {
    const current = { ...revisions, [key]: Number(revisions[key]) + 1 };
    assert.deepEqual(contextSourceChanges(revisions, current), [key]);
  }
  assert.deepEqual(contextSourceChanges(revisions, { ...revisions }), []);
});
