/**
 * Three-layer candidate ranking (G5 / D-065):
 *   1. quality / reliability gate
 *   2. health / capacity guardrail
 *   3. cost optimization
 *
 * Hard constraints always run first (outside this module). Candidates that
 * fail hard filters never enter ranking. Critical evidence that is missing,
 * stale, or below sample threshold excludes the candidate or keeps it in
 * canary-only band (D-065 ②).
 *
 * Cost evidence priority: invoice > observed_usage > gateway_estimate.
 * Estimate-only channels keep risk discount + traffic cap. Recorded
 * placeholder prices are not production sort inputs (story 18).
 */
import type { PricingEvidenceSource } from '@meiye/contracts';
import {
  QUALITY_NORTH_STAR_MIN_SAMPLE_SIZE,
  type ModelDeployment,
} from '../model-supply/supply-contracts.js';
import type { HealthOverlayState } from '@meiye/contracts';
import { isHealthOverlayBlocking } from './health-overlay.js';

/** Layer ids — fixed order, no global weight table. */
export const THREE_LAYER_ORDER = [
  'quality_reliability_gate',
  'health_capacity_guardrail',
  'cost_optimization',
] as const;

export type RankingLayerId = (typeof THREE_LAYER_ORDER)[number];

/**
 * Sort-input provenance matrix (D-065 / P1-07).
 * Property tests assert every listed input is consumed by the matching layer
 * evaluator — not merely that "three layers exist".
 */
export const SORT_INPUT_PROVENANCE_MATRIX = {
  quality_reliability_gate: {
    layer: 'quality_reliability_gate',
    inputs: [
      'conformance',
      'mapping_trust',
      'activation_evidence',
      'versioned_quality_baseline',
      'success_rate',
      'p95',
      'acceptance_completeness',
    ],
    missingCriticalPolicy: 'exclude_or_canary_only',
    sampleThreshold: QUALITY_NORTH_STAR_MIN_SAMPLE_SIZE,
  },
  health_capacity_guardrail: {
    layer: 'health_capacity_guardrail',
    inputs: [
      'circuit',
      'rate_limit',
      'balance_quota',
      'concurrency',
      'capacity_headroom',
    ],
    missingCriticalPolicy: 'exclude',
  },
  cost_optimization: {
    layer: 'cost_optimization',
    inputs: [
      'normalized_supply_cost',
      'failure_cost',
      'latency',
      'concentration',
    ],
    costEvidencePriority: [
      'invoice',
      'observed_usage',
      'gateway_estimate',
    ] as const satisfies readonly PricingEvidenceSource[],
    estimateOnlyControls: ['risk_discount', 'traffic_cap'] as const,
    recordedPlaceholderIsProductionInput: false,
  },
} as const;

export type SortInputProvenanceMatrix = typeof SORT_INPUT_PROVENANCE_MATRIX;

export type EvidenceFreshnessStatus = 'fresh' | 'stale' | 'missing' | 'below_threshold';

export type CriticalEvidenceKind =
  | 'conformance'
  | 'mapping_trust'
  | 'activation_evidence'
  | 'versioned_quality_baseline'
  | 'success_rate'
  | 'p95'
  | 'acceptance_completeness';

export type CriticalEvidenceFact = {
  kind: CriticalEvidenceKind;
  status: EvidenceFreshnessStatus;
  observedAt?: string;
  sampleSize?: number;
  value?: number;
};

export type QualityGateEvidence = {
  conformance?: CriticalEvidenceFact;
  mappingTrust?: CriticalEvidenceFact;
  activationEvidence?: CriticalEvidenceFact;
  versionedQualityBaseline?: CriticalEvidenceFact;
  successRate?: CriticalEvidenceFact;
  p95?: CriticalEvidenceFact;
  acceptanceCompleteness?: CriticalEvidenceFact;
};

export type HealthCapacityEvidence = {
  healthState?: HealthOverlayState | null;
  circuitOpen?: boolean;
  rateLimited?: boolean;
  balanceQuotaExhausted?: boolean;
  concurrencyExhausted?: boolean;
  capacityHeadroom?: number | null;
};

export type CostEvidence = {
  /** Production cost evidence only — not recorded placeholders. */
  source: PricingEvidenceSource | 'recorded_placeholder' | 'catalog';
  amountMicros: number;
  currency: 'CNY' | 'USD';
  failureCostMicros?: number;
  latencyMs?: number;
  /** Share of recent traffic on this deployment (0..1). Higher = more concentrated. */
  concentration?: number;
  riskDiscountApplied?: boolean;
  trafficCapHint?: string;
  /** When true, amount is a recorded placeholder and must not rank production. */
  isRecordedPlaceholder?: boolean;
};

export type RankingCandidateInput = {
  deploymentId: string;
  deployment?: ModelDeployment;
  quality: QualityGateEvidence;
  health: HealthCapacityEvidence;
  cost: CostEvidence;
};

export type RankingBand = 'production' | 'canary' | 'excluded';

export type RankingLayerOutcome = {
  layer: RankingLayerId;
  passed: boolean;
  band?: RankingBand;
  reasons: string[];
  sortKey?: number;
};

export type RankedCandidate = {
  deploymentId: string;
  band: RankingBand;
  rank: number | null;
  layerOutcomes: RankingLayerOutcome[];
  exclusionReasons: string[];
  costScore: number | null;
  costEvidenceSource: PricingEvidenceSource | 'recorded_placeholder' | 'catalog' | null;
  riskDiscountApplied: boolean;
  evidenceFreshness: CriticalEvidenceFact[];
};

export type ThreeLayerRankingResult = {
  ranked: RankedCandidate[];
  production: RankedCandidate[];
  canary: RankedCandidate[];
  excluded: RankedCandidate[];
  matrix: SortInputProvenanceMatrix;
};

const DEFAULT_EVIDENCE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isStale(observedAt: string | undefined, nowMs: number): boolean {
  if (!observedAt) return true;
  const ts = Date.parse(observedAt);
  if (!Number.isFinite(ts)) return true;
  return nowMs - ts > DEFAULT_EVIDENCE_MAX_AGE_MS;
}

function factStatus(
  fact: CriticalEvidenceFact | undefined,
  nowMs: number,
  minSample = QUALITY_NORTH_STAR_MIN_SAMPLE_SIZE,
): EvidenceFreshnessStatus {
  if (!fact) return 'missing';
  if (fact.status === 'missing') return 'missing';
  if (
    typeof fact.sampleSize === 'number' &&
    fact.sampleSize < minSample
  ) {
    return 'below_threshold';
  }
  if (fact.status === 'stale' || isStale(fact.observedAt, nowMs)) {
    return 'stale';
  }
  if (fact.status === 'below_threshold') return 'below_threshold';
  return 'fresh';
}

/**
 * Layer 1 — quality / reliability gate.
 * Consumes every input listed in SORT_INPUT_PROVENANCE_MATRIX.quality_reliability_gate.
 */
export function evaluateQualityReliabilityGate(
  evidence: QualityGateEvidence,
  options: { nowMs?: number; minSampleSize?: number } = {},
): RankingLayerOutcome {
  const nowMs = options.nowMs ?? Date.now();
  const minSample =
    options.minSampleSize ??
    SORT_INPUT_PROVENANCE_MATRIX.quality_reliability_gate.sampleThreshold;
  const reasons: string[] = [];
  const facts: Array<[CriticalEvidenceKind, CriticalEvidenceFact | undefined]> =
    [
      ['conformance', evidence.conformance],
      ['mapping_trust', evidence.mappingTrust],
      ['activation_evidence', evidence.activationEvidence],
      ['versioned_quality_baseline', evidence.versionedQualityBaseline],
      ['success_rate', evidence.successRate],
      ['p95', evidence.p95],
      ['acceptance_completeness', evidence.acceptanceCompleteness],
    ];

  let missingOrStale = 0;
  let belowThreshold = 0;
  for (const [kind, fact] of facts) {
    const status = factStatus(fact, nowMs, minSample);
    if (status === 'missing') {
      reasons.push(`critical_evidence_missing:${kind}`);
      missingOrStale += 1;
    } else if (status === 'stale') {
      reasons.push(`critical_evidence_stale:${kind}`);
      missingOrStale += 1;
    } else if (status === 'below_threshold') {
      reasons.push(`below_sample_threshold:${kind}`);
      belowThreshold += 1;
    }
  }

  // Activation evidence is hard-critical: missing → exclude (not canary).
  const activation = factStatus(evidence.activationEvidence, nowMs, minSample);
  if (activation === 'missing') {
    return {
      layer: 'quality_reliability_gate',
      passed: false,
      band: 'excluded',
      reasons,
      sortKey: Number.POSITIVE_INFINITY,
    };
  }

  if (missingOrStale > 0 || belowThreshold > 0) {
    // D-065 ②: exclude OR canary-only when critical evidence is weak.
    // Prefer canary when activation exists but other samples are thin/stale.
    return {
      layer: 'quality_reliability_gate',
      passed: true,
      band: 'canary',
      reasons,
      sortKey: 1_000 + missingOrStale * 10 + belowThreshold,
    };
  }

  // Prefer higher success rate / lower p95 via sortKey (lower is better).
  const success =
    evidence.successRate?.value !== undefined
      ? 1 - Math.min(1, Math.max(0, evidence.successRate.value))
      : 0.5;
  const p95Norm =
    evidence.p95?.value !== undefined
      ? Math.min(1, evidence.p95.value / 60_000)
      : 0.5;
  return {
    layer: 'quality_reliability_gate',
    passed: true,
    band: 'production',
    reasons: [],
    sortKey: success * 100 + p95Norm * 10,
  };
}

/**
 * Layer 2 — health / capacity guardrail.
 * Consumes every input listed in SORT_INPUT_PROVENANCE_MATRIX.health_capacity_guardrail.
 */
export function evaluateHealthCapacityGuardrail(
  evidence: HealthCapacityEvidence,
): RankingLayerOutcome {
  const reasons: string[] = [];

  if (evidence.circuitOpen || evidence.healthState === 'circuit_open') {
    reasons.push('circuit_open');
  }
  if (
    evidence.rateLimited ||
    evidence.healthState === 'cooldown'
  ) {
    reasons.push('rate_limited');
  }
  if (isHealthOverlayBlocking(evidence.healthState)) {
    if (!reasons.includes('circuit_open') && !reasons.includes('rate_limited')) {
      reasons.push(`health_overlay_${evidence.healthState}`);
    }
  }
  if (evidence.balanceQuotaExhausted) {
    reasons.push('balance_quota_exhausted');
  }
  if (evidence.concurrencyExhausted) {
    reasons.push('concurrency_exhausted');
  }
  if (
    evidence.capacityHeadroom !== undefined &&
    evidence.capacityHeadroom !== null &&
    evidence.capacityHeadroom <= 0
  ) {
    reasons.push('capacity_headroom_exhausted');
  }

  if (reasons.length > 0) {
    return {
      layer: 'health_capacity_guardrail',
      passed: false,
      band: 'excluded',
      reasons,
      sortKey: Number.POSITIVE_INFINITY,
    };
  }

  // Higher headroom sorts earlier (lower sortKey).
  const headroom =
    evidence.capacityHeadroom === undefined || evidence.capacityHeadroom === null
      ? 0.5
      : Math.max(0, Math.min(1, evidence.capacityHeadroom));
  const degradedBoost = evidence.healthState === 'degraded' ? 10 : 0;
  return {
    layer: 'health_capacity_guardrail',
    passed: true,
    band: 'production',
    reasons: [],
    sortKey: (1 - headroom) * 100 + degradedBoost,
  };
}

/**
 * Layer 3 — cost optimization.
 * Consumes normalized supply cost + failure cost + latency + concentration.
 * invoice > observed_usage > gateway_estimate; estimate keeps risk discount.
 */
export function evaluateCostOptimization(
  cost: CostEvidence,
): RankingLayerOutcome {
  if (
    cost.isRecordedPlaceholder ||
    cost.source === 'recorded_placeholder'
  ) {
    // Story 18: recorded placeholder prices are not production sort inputs.
    return {
      layer: 'cost_optimization',
      passed: true,
      band: 'production',
      reasons: ['recorded_placeholder_ignored_for_sort'],
      sortKey: Number.MAX_SAFE_INTEGER / 4,
    };
  }

  const failure = cost.failureCostMicros ?? 0;
  const latency = cost.latencyMs ?? 0;
  const concentration = cost.concentration ?? 0;
  let amount = cost.amountMicros;
  let riskDiscountApplied = cost.riskDiscountApplied === true;

  if (cost.source === 'gateway_estimate') {
    // Estimate-only: apply risk discount (inflate cost) unless already applied.
    if (!riskDiscountApplied) {
      amount = Math.round(amount * 1.15);
      riskDiscountApplied = true;
    }
  }

  // Evidence quality bonus: better evidence slightly preferred at equal cost.
  const evidencePenalty =
    cost.source === 'invoice' ? 0 : cost.source === 'observed_usage' ? 1 : 5;

  const sortKey =
    amount +
    failure +
    latency * 10 +
    concentration * 50_000 +
    evidencePenalty;

  return {
    layer: 'cost_optimization',
    passed: true,
    band: 'production',
    reasons: riskDiscountApplied ? ['risk_discount_applied'] : [],
    sortKey,
  };
}

function collectFreshness(
  evidence: QualityGateEvidence,
  nowMs: number,
): CriticalEvidenceFact[] {
  const minSample =
    SORT_INPUT_PROVENANCE_MATRIX.quality_reliability_gate.sampleThreshold;
  const pairs: Array<[CriticalEvidenceKind, CriticalEvidenceFact | undefined]> =
    [
      ['conformance', evidence.conformance],
      ['mapping_trust', evidence.mappingTrust],
      ['activation_evidence', evidence.activationEvidence],
      ['versioned_quality_baseline', evidence.versionedQualityBaseline],
      ['success_rate', evidence.successRate],
      ['p95', evidence.p95],
      ['acceptance_completeness', evidence.acceptanceCompleteness],
    ];
  return pairs.map(([kind, fact]) => ({
    kind,
    status: factStatus(fact, nowMs, minSample),
    ...(fact?.observedAt ? { observedAt: fact.observedAt } : {}),
    ...(typeof fact?.sampleSize === 'number'
      ? { sampleSize: fact.sampleSize }
      : {}),
    ...(typeof fact?.value === 'number' ? { value: fact.value } : {}),
  }));
}

/**
 * Rank hard-filter-eligible candidates with the three-layer order.
 * Production band before canary; excluded omitted from rank sequence.
 */
export function rankCandidatesThreeLayer(
  candidates: readonly RankingCandidateInput[],
  options: { nowMs?: number } = {},
): ThreeLayerRankingResult {
  const nowMs = options.nowMs ?? Date.now();
  const evaluated: RankedCandidate[] = candidates.map((candidate) => {
    const gate = evaluateQualityReliabilityGate(candidate.quality, { nowMs });
    const guardrail = evaluateHealthCapacityGuardrail(candidate.health);
    const cost = evaluateCostOptimization(candidate.cost);

    const layerOutcomes = [gate, guardrail, cost];
    const exclusionReasons: string[] = [];
    let band: RankingBand = 'production';

    if (gate.band === 'excluded' || !gate.passed) {
      band = 'excluded';
      exclusionReasons.push(...gate.reasons);
    } else if (gate.band === 'canary') {
      band = 'canary';
      exclusionReasons.push(...gate.reasons);
    }

    if (guardrail.band === 'excluded' || !guardrail.passed) {
      band = 'excluded';
      exclusionReasons.push(...guardrail.reasons);
    }

    const costScore =
      band === 'excluded' ? null : (cost.sortKey ?? Number.MAX_SAFE_INTEGER);

    return {
      deploymentId: candidate.deploymentId,
      band,
      rank: null,
      layerOutcomes,
      exclusionReasons,
      costScore,
      costEvidenceSource:
        band === 'excluded'
          ? null
          : candidate.cost.isRecordedPlaceholder
            ? 'recorded_placeholder'
            : candidate.cost.source,
      riskDiscountApplied:
        candidate.cost.riskDiscountApplied === true ||
        (candidate.cost.source === 'gateway_estimate' &&
          cost.reasons.includes('risk_discount_applied')),
      evidenceFreshness: collectFreshness(candidate.quality, nowMs),
    };
  });

  const production = evaluated.filter((c) => c.band === 'production');
  const canary = evaluated.filter((c) => c.band === 'canary');
  const excluded = evaluated.filter((c) => c.band === 'excluded');

  const byCostThenGate = (left: RankedCandidate, right: RankedCandidate) => {
    const leftGate =
      left.layerOutcomes.find((o) => o.layer === 'quality_reliability_gate')
        ?.sortKey ?? 0;
    const rightGate =
      right.layerOutcomes.find((o) => o.layer === 'quality_reliability_gate')
        ?.sortKey ?? 0;
    const leftGuard =
      left.layerOutcomes.find((o) => o.layer === 'health_capacity_guardrail')
        ?.sortKey ?? 0;
    const rightGuard =
      right.layerOutcomes.find((o) => o.layer === 'health_capacity_guardrail')
        ?.sortKey ?? 0;
    // Layer order: gate key, then guardrail, then cost.
    if (leftGate !== rightGate) return leftGate - rightGate;
    if (leftGuard !== rightGuard) return leftGuard - rightGuard;
    return (left.costScore ?? 0) - (right.costScore ?? 0);
  };

  production.sort(byCostThenGate);
  canary.sort(byCostThenGate);

  let rank = 1;
  for (const candidate of production) {
    candidate.rank = rank++;
  }
  for (const candidate of canary) {
    candidate.rank = rank++;
  }

  return {
    ranked: [...production, ...canary, ...excluded],
    production,
    canary,
    excluded,
    matrix: SORT_INPUT_PROVENANCE_MATRIX,
  };
}

/**
 * Property helper: every matrix input id is referenced by the layer evaluator
 * source (static contract for tests).
 */
export function matrixInputsForLayer(
  layer: RankingLayerId,
): readonly string[] {
  return SORT_INPUT_PROVENANCE_MATRIX[layer].inputs;
}
