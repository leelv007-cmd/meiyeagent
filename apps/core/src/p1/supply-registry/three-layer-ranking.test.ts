/**
 * G5 three-layer ranking + sort-input provenance matrix property assertions (D-065).
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  SORT_INPUT_PROVENANCE_MATRIX,
  THREE_LAYER_ORDER,
  evaluateCostOptimization,
  evaluateHealthCapacityGuardrail,
  evaluateQualityReliabilityGate,
  matrixInputsForLayer,
  rankCandidatesThreeLayer,
  type CriticalEvidenceFact,
  type RankingCandidateInput,
} from './three-layer-ranking.js';
import { QUALITY_NORTH_STAR_MIN_SAMPLE_SIZE } from '../model-supply/supply-contracts.js';

const now = Date.parse('2026-07-20T00:00:00.000Z');
const freshAt = '2026-07-19T00:00:00.000Z';
const staleAt = '2026-01-01T00:00:00.000Z';

function freshFact(
  kind: CriticalEvidenceFact['kind'],
  extra: Partial<CriticalEvidenceFact> = {},
): CriticalEvidenceFact {
  return {
    kind,
    status: 'fresh',
    observedAt: freshAt,
    sampleSize: QUALITY_NORTH_STAR_MIN_SAMPLE_SIZE,
    ...extra,
  };
}

function fullQuality(overrides: Partial<RankingCandidateInput['quality']> = {}) {
  return {
    conformance: freshFact('conformance'),
    mappingTrust: freshFact('mapping_trust'),
    activationEvidence: freshFact('activation_evidence'),
    versionedQualityBaseline: freshFact('versioned_quality_baseline'),
    successRate: freshFact('success_rate', { value: 0.95 }),
    p95: freshFact('p95', { value: 800 }),
    acceptanceCompleteness: freshFact('acceptance_completeness', { value: 1 }),
    ...overrides,
  };
}

test('THREE_LAYER_ORDER is gate → guardrail → cost (no global weights)', () => {
  assert.deepEqual(THREE_LAYER_ORDER, [
    'quality_reliability_gate',
    'health_capacity_guardrail',
    'cost_optimization',
  ]);
});

test('sort input provenance matrix lists every D-065 input (property assertions)', () => {
  // Layer 1 inputs
  assert.deepEqual(
    [...SORT_INPUT_PROVENANCE_MATRIX.quality_reliability_gate.inputs].sort(),
    [
      'acceptance_completeness',
      'activation_evidence',
      'conformance',
      'mapping_trust',
      'p95',
      'success_rate',
      'versioned_quality_baseline',
    ].sort(),
  );
  assert.equal(
    SORT_INPUT_PROVENANCE_MATRIX.quality_reliability_gate.missingCriticalPolicy,
    'exclude_or_canary_only',
  );
  assert.equal(
    SORT_INPUT_PROVENANCE_MATRIX.quality_reliability_gate.sampleThreshold,
    QUALITY_NORTH_STAR_MIN_SAMPLE_SIZE,
  );

  // Layer 2 inputs
  assert.deepEqual(
    [...SORT_INPUT_PROVENANCE_MATRIX.health_capacity_guardrail.inputs].sort(),
    [
      'balance_quota',
      'capacity_headroom',
      'circuit',
      'concurrency',
      'rate_limit',
    ].sort(),
  );

  // Layer 3 inputs + cost evidence priority
  assert.deepEqual(
    [...SORT_INPUT_PROVENANCE_MATRIX.cost_optimization.inputs].sort(),
    ['concentration', 'failure_cost', 'latency', 'normalized_supply_cost'].sort(),
  );
  assert.deepEqual(
    SORT_INPUT_PROVENANCE_MATRIX.cost_optimization.costEvidencePriority,
    ['invoice', 'observed_usage', 'gateway_estimate'],
  );
  assert.deepEqual(
    SORT_INPUT_PROVENANCE_MATRIX.cost_optimization.estimateOnlyControls,
    ['risk_discount', 'traffic_cap'],
  );
  assert.equal(
    SORT_INPUT_PROVENANCE_MATRIX.cost_optimization
      .recordedPlaceholderIsProductionInput,
    false,
  );

  // matrixInputsForLayer mirrors the matrix (property)
  for (const layer of THREE_LAYER_ORDER) {
    assert.deepEqual(
      matrixInputsForLayer(layer),
      SORT_INPUT_PROVENANCE_MATRIX[layer].inputs,
    );
  }
});

test('quality gate consumes every matrix input and canaries on stale/low sample', () => {
  const matrixInputs =
    SORT_INPUT_PROVENANCE_MATRIX.quality_reliability_gate.inputs;
  const gate = evaluateQualityReliabilityGate(fullQuality(), { nowMs: now });
  assert.equal(gate.band, 'production');
  assert.equal(gate.passed, true);

  // Property: evaluator reason codes / fact kinds cover matrix inputs when missing.
  const empty = evaluateQualityReliabilityGate({}, { nowMs: now });
  assert.equal(empty.band, 'excluded'); // activation missing → exclude
  for (const input of matrixInputs) {
    assert.ok(
      empty.reasons.some((r) => r.includes(input)),
      `expected missing reason for matrix input ${input}, got ${empty.reasons.join(',')}`,
    );
  }

  const lowSample = evaluateQualityReliabilityGate(
    fullQuality({
      successRate: freshFact('success_rate', {
        sampleSize: 3,
        value: 0.99,
      }),
    }),
    { nowMs: now },
  );
  assert.equal(lowSample.band, 'canary');
  assert.ok(
    lowSample.reasons.some((r) => r.startsWith('below_sample_threshold')),
  );

  const stale = evaluateQualityReliabilityGate(
    fullQuality({
      p95: {
        kind: 'p95',
        status: 'fresh',
        observedAt: staleAt,
        sampleSize: 50,
        value: 100,
      },
    }),
    { nowMs: now },
  );
  assert.equal(stale.band, 'canary');
  assert.ok(stale.reasons.some((r) => r.startsWith('critical_evidence_stale')));
});

test('health guardrail consumes every matrix input', () => {
  const matrixInputs =
    SORT_INPUT_PROVENANCE_MATRIX.health_capacity_guardrail.inputs;
  const ok = evaluateHealthCapacityGuardrail({
    healthState: 'healthy',
    capacityHeadroom: 0.8,
  });
  assert.equal(ok.passed, true);

  const blocked = evaluateHealthCapacityGuardrail({
    circuitOpen: true,
    rateLimited: true,
    balanceQuotaExhausted: true,
    concurrencyExhausted: true,
    capacityHeadroom: 0,
  });
  assert.equal(blocked.passed, false);
  assert.equal(blocked.band, 'excluded');

  // Property: each matrix input maps to a concrete exclusion signal.
  const reasonBlob = blocked.reasons.join(' ');
  assert.match(reasonBlob, /circuit/);
  assert.match(reasonBlob, /rate_limited/);
  assert.match(reasonBlob, /balance_quota/);
  assert.match(reasonBlob, /concurrency/);
  assert.match(reasonBlob, /capacity_headroom/);
  assert.equal(matrixInputs.length, 5);
});

test('cost optimization prefers invoice over estimate and applies risk discount', () => {
  const invoice = evaluateCostOptimization({
    source: 'invoice',
    amountMicros: 10_000,
    currency: 'CNY',
    failureCostMicros: 0,
    latencyMs: 100,
    concentration: 0.1,
  });
  const estimate = evaluateCostOptimization({
    source: 'gateway_estimate',
    amountMicros: 10_000,
    currency: 'CNY',
    failureCostMicros: 0,
    latencyMs: 100,
    concentration: 0.1,
  });
  assert.ok((estimate.sortKey ?? 0) > (invoice.sortKey ?? 0));
  assert.ok(estimate.reasons.includes('risk_discount_applied'));

  const placeholder = evaluateCostOptimization({
    source: 'recorded_placeholder',
    amountMicros: 1,
    currency: 'USD',
    isRecordedPlaceholder: true,
  });
  assert.ok(placeholder.reasons.includes('recorded_placeholder_ignored_for_sort'));
  assert.ok((placeholder.sortKey ?? 0) > (invoice.sortKey ?? 0));

  // Property: matrix cost inputs affect sortKey
  const withFailure = evaluateCostOptimization({
    source: 'observed_usage',
    amountMicros: 10_000,
    currency: 'CNY',
    failureCostMicros: 5_000,
    latencyMs: 500,
    concentration: 0.5,
  });
  const baseline = evaluateCostOptimization({
    source: 'observed_usage',
    amountMicros: 10_000,
    currency: 'CNY',
    failureCostMicros: 0,
    latencyMs: 0,
    concentration: 0,
  });
  assert.ok((withFailure.sortKey ?? 0) > (baseline.sortKey ?? 0));
});

test('three-layer rank: production before canary; health exclude wins over cheap cost', () => {
  const candidates: RankingCandidateInput[] = [
    {
      deploymentId: 'cheap-unhealthy',
      quality: fullQuality(),
      health: { circuitOpen: true, capacityHeadroom: 1 },
      cost: {
        source: 'invoice',
        amountMicros: 1,
        currency: 'CNY',
      },
    },
    {
      deploymentId: 'healthy-mid',
      quality: fullQuality({ successRate: freshFact('success_rate', { value: 0.9 }) }),
      health: { healthState: 'healthy', capacityHeadroom: 0.5 },
      cost: {
        source: 'observed_usage',
        amountMicros: 20_000,
        currency: 'CNY',
        failureCostMicros: 1_000,
        latencyMs: 200,
        concentration: 0.2,
      },
    },
    {
      deploymentId: 'canary-thin-sample',
      quality: fullQuality({
        successRate: freshFact('success_rate', { sampleSize: 2, value: 1 }),
      }),
      health: { healthState: 'healthy', capacityHeadroom: 1 },
      cost: {
        source: 'invoice',
        amountMicros: 5_000,
        currency: 'CNY',
      },
    },
    {
      deploymentId: 'healthy-cheap',
      quality: fullQuality({ successRate: freshFact('success_rate', { value: 0.99 }) }),
      health: { healthState: 'healthy', capacityHeadroom: 0.9 },
      cost: {
        source: 'invoice',
        amountMicros: 8_000,
        currency: 'CNY',
        failureCostMicros: 0,
        latencyMs: 50,
        concentration: 0.05,
      },
    },
  ];

  const result = rankCandidatesThreeLayer(candidates, { nowMs: now });
  assert.deepEqual(
    result.excluded.map((c) => c.deploymentId),
    ['cheap-unhealthy'],
  );
  assert.deepEqual(
    result.production.map((c) => c.deploymentId),
    ['healthy-cheap', 'healthy-mid'],
  );
  assert.deepEqual(
    result.canary.map((c) => c.deploymentId),
    ['canary-thin-sample'],
  );
  assert.equal(result.ranked[0]?.deploymentId, 'healthy-cheap');
  assert.equal(result.ranked[0]?.rank, 1);
  // Cheap unhealthy never ranks despite lowest invoice.
  assert.equal(
    result.ranked.find((c) => c.deploymentId === 'cheap-unhealthy')?.rank,
    null,
  );
  // Matrix is attached for audit/simulator.
  assert.equal(result.matrix, SORT_INPUT_PROVENANCE_MATRIX);
});
