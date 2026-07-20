/**
 * Shared route decision explanation projection (G5 / D-065 ④).
 *
 * Route simulator and task audit MUST project through this module so operators
 * see the same hard-filter / sort / live-exclude / max-cost / acceptance
 * branch / not-selected reasons / evidence freshness / cost evidence source.
 */
import type { PricingEvidenceSource } from '@meiye/contracts';
import type { Acceptance } from '../model-supply/supply-contracts.js';
import type { RouteCandidateExclusionReason } from '../model-supply/route-contracts.js';
import type {
  DataProcessingLevelView,
  DataPolicyHardFilterReason,
} from './data-policy.js';
import { projectDataProcessingLevel } from './data-policy.js';
import type {
  CriticalEvidenceFact,
  RankedCandidate,
  RankingLayerId,
  ThreeLayerRankingResult,
} from './three-layer-ranking.js';
import { THREE_LAYER_ORDER } from './three-layer-ranking.js';

export type ExplanationSurface = 'simulator' | 'task_audit';

/** Acceptance / auto-fallback decisions mirrored for explanation (no circular import). */
export type ExplanationAcceptanceDecision =
  | 'safe_auto_fallback'
  | 'query_reconcile_manual'
  | 'fallback_not_authorized'
  | 'no_safe_fallback_candidate'
  | 'complete'
  | 'awaiting_selection'
  | 'stop';

export type ExplanationExclusion = {
  deploymentId: string;
  reasons: string[];
  layer?: RankingLayerId | 'hard_filter' | 'live';
};

export type ExplanationRankEntry = {
  deploymentId: string;
  rank: number;
  band: 'production' | 'canary';
  sortKeys: Partial<Record<RankingLayerId, number | null>>;
};

export type ExplanationCostEvidence = {
  deploymentId: string;
  source: PricingEvidenceSource | 'recorded_placeholder' | 'catalog' | 'recorded_estimate' | null;
  amountMicros?: number;
  riskDiscountApplied?: boolean;
  trafficCapHint?: string;
};

export type ExplanationEvidenceFreshness = {
  deploymentId: string;
  criticalEvidence: CriticalEvidenceFact[];
};

export type ExplanationAcceptanceBranch = {
  acceptance: Acceptance | 'not_attempted';
  decision: ExplanationAcceptanceDecision;
  reason: string;
  primaryDeploymentId?: string;
  fallbackDeploymentId?: string;
};

export type RouteDecisionExplanation = {
  /** Which surface requested the projection (same shape either way). */
  surface: ExplanationSurface;
  /** Hard-filter pass/fail before any ranking. */
  hardFilter: {
    passedDeploymentIds: string[];
    excluded: ExplanationExclusion[];
  };
  /** Three-layer sort outcomes for candidates that passed hard filter. */
  sort: {
    layerOrder: readonly RankingLayerId[];
    ranked: ExplanationRankEntry[];
  };
  /** Runtime exclusions (health overlay / capacity / simulator inject). */
  liveExclusions: ExplanationExclusion[];
  /** Maximum estimated cost across ranked production+canary candidates. */
  maxCost: {
    amountMicros: number;
    currency: 'CNY' | 'USD';
    evidenceSource: PricingEvidenceSource | 'catalog' | 'recorded_estimate' | 'mixed' | null;
  } | null;
  /** Acceptance / auto-fallback branch explanation. */
  acceptanceBranch: ExplanationAcceptanceBranch;
  /** Unified not-selected reasons (hard + sort + live). */
  notSelectedReasons: ExplanationExclusion[];
  /** Critical evidence freshness per candidate. */
  evidenceFreshness: ExplanationEvidenceFreshness[];
  /** Cost evidence source per candidate. */
  costEvidenceSource: ExplanationCostEvidence[];
  /** Frontend-safe data processing level (no vendor identity). */
  dataProcessingLevel: DataProcessingLevelView;
  /** Fail-closed when zero compliant candidates. */
  failClosed: boolean;
  failClosedReason: 'no_compliant_candidate' | null;
};

export type BuildRouteDecisionExplanationInput = {
  surface: ExplanationSurface;
  requestedDataClasses: readonly string[];
  hardFilterPassedDeploymentIds: readonly string[];
  hardFilterExcluded: ReadonlyArray<{
    deploymentId: string;
    reasons: readonly (
      | RouteCandidateExclusionReason
      | DataPolicyHardFilterReason
      | string
    )[];
  }>;
  liveExclusions?: ReadonlyArray<{
    deploymentId: string;
    reasons: readonly string[];
  }>;
  ranking?: ThreeLayerRankingResult | null;
  costByDeploymentId?: ReadonlyMap<
    string,
    {
      amountMicros: number;
      currency: 'CNY' | 'USD';
      source: PricingEvidenceSource | 'catalog' | 'recorded_estimate';
      riskDiscountApplied?: boolean;
      trafficCapHint?: string;
    }
  >;
  acceptanceBranch: ExplanationAcceptanceBranch;
};

function asRankedEntries(
  ranking: ThreeLayerRankingResult | null | undefined,
): ExplanationRankEntry[] {
  if (!ranking) return [];
  return ranking.ranked
    .filter(
      (candidate): candidate is RankedCandidate & { rank: number; band: 'production' | 'canary' } =>
        candidate.band !== 'excluded' && candidate.rank !== null,
    )
    .map((candidate) => ({
      deploymentId: candidate.deploymentId,
      rank: candidate.rank,
      band: candidate.band,
      sortKeys: Object.fromEntries(
        candidate.layerOutcomes.map((outcome) => [
          outcome.layer,
          outcome.sortKey ?? null,
        ]),
      ) as Partial<Record<RankingLayerId, number | null>>,
    }));
}

/**
 * Build the shared explanation projection used by simulator and task audit.
 */
export function buildRouteDecisionExplanation(
  input: BuildRouteDecisionExplanationInput,
): RouteDecisionExplanation {
  const hardExcluded: ExplanationExclusion[] = input.hardFilterExcluded.map(
    (entry) => ({
      deploymentId: entry.deploymentId,
      reasons: [...entry.reasons],
      layer: 'hard_filter' as const,
    }),
  );

  const liveExclusions: ExplanationExclusion[] = (
    input.liveExclusions ?? []
  ).map((entry) => ({
    deploymentId: entry.deploymentId,
    reasons: [...entry.reasons],
    layer: 'live' as const,
  }));

  const sortExcluded: ExplanationExclusion[] = (input.ranking?.excluded ?? []).map(
    (candidate) => ({
      deploymentId: candidate.deploymentId,
      reasons: [...candidate.exclusionReasons],
      layer:
        (candidate.layerOutcomes.find((o) => !o.passed || o.band === 'excluded')
          ?.layer as RankingLayerId | undefined) ?? 'quality_reliability_gate',
    }),
  );

  const ranked = asRankedEntries(input.ranking);
  const costEvidenceSource: ExplanationCostEvidence[] = [];
  let maxAmount = 0;
  let maxCurrency: 'CNY' | 'USD' = 'CNY';
  const sources = new Set<string>();

  for (const entry of ranked) {
    const cost = input.costByDeploymentId?.get(entry.deploymentId);
    const rankedMeta = input.ranking?.ranked.find(
      (c) => c.deploymentId === entry.deploymentId,
    );
    costEvidenceSource.push({
      deploymentId: entry.deploymentId,
      source: rankedMeta?.costEvidenceSource ?? cost?.source ?? null,
      ...(cost ? { amountMicros: cost.amountMicros } : {}),
      ...(rankedMeta?.riskDiscountApplied || cost?.riskDiscountApplied
        ? { riskDiscountApplied: true }
        : {}),
      ...(cost?.trafficCapHint ? { trafficCapHint: cost.trafficCapHint } : {}),
    });
    if (cost) {
      maxAmount += cost.amountMicros;
      maxCurrency = cost.currency;
      sources.add(cost.source);
    }
  }

  const evidenceFreshness: ExplanationEvidenceFreshness[] = (
    input.ranking?.ranked ?? []
  ).map((candidate) => ({
    deploymentId: candidate.deploymentId,
    criticalEvidence: [...candidate.evidenceFreshness],
  }));

  const notSelectedReasons = [
    ...hardExcluded,
    ...sortExcluded,
    ...liveExclusions,
  ];

  const failClosed = input.hardFilterPassedDeploymentIds.length === 0 && ranked.length === 0;

  return {
    surface: input.surface,
    hardFilter: {
      passedDeploymentIds: [...input.hardFilterPassedDeploymentIds],
      excluded: hardExcluded,
    },
    sort: {
      layerOrder: THREE_LAYER_ORDER,
      ranked,
    },
    liveExclusions,
    maxCost:
      ranked.length === 0
        ? null
        : {
            amountMicros: maxAmount,
            currency: maxCurrency,
            evidenceSource:
              sources.size === 0
                ? null
                : sources.size === 1
                  ? ([...sources][0] as
                      | PricingEvidenceSource
                      | 'catalog'
                      | 'recorded_estimate')
                  : 'mixed',
          },
    acceptanceBranch: { ...input.acceptanceBranch },
    notSelectedReasons,
    evidenceFreshness,
    costEvidenceSource,
    dataProcessingLevel: projectDataProcessingLevel(
      input.requestedDataClasses as never,
    ),
    failClosed,
    failClosedReason: failClosed ? 'no_compliant_candidate' : null,
  };
}

/**
 * Assert simulator and audit projections are structurally identical for the
 * same planning facts (surface field may differ).
 */
export function assertSharedExplanationProjection(
  simulator: RouteDecisionExplanation,
  taskAudit: RouteDecisionExplanation,
): void {
  const strip = (value: RouteDecisionExplanation) => {
    const { surface: _surface, ...rest } = value;
    return rest;
  };
  const left = JSON.stringify(strip(simulator));
  const right = JSON.stringify(strip(taskAudit));
  if (left !== right) {
    throw new Error(
      'Simulator and task-audit explanation projections diverged.',
    );
  }
}
