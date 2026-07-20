/**
 * Route simulator + task audit shared explanation projection (J5 / G5 / D-065 ④).
 *
 * Frontend pure mirror of Core `buildRouteDecisionExplanation` shape so the
 * simulator panel and task audit drilldown render identical hard-filter / sort /
 * live-exclude / max-cost / acceptance / not-selected / evidence freshness /
 * cost evidence source fields. Live ranking stays in Core; this module only
 * projects already-computed planning facts.
 */
import type { PricingEvidenceSource } from '@meiye/contracts';

export type RouteExplanationSurface = 'simulator' | 'task_audit';

export type RankingLayerId =
  | 'quality_reliability_gate'
  | 'health_capacity_guardrail'
  | 'cost_optimization';

export const THREE_LAYER_ORDER = [
  'quality_reliability_gate',
  'health_capacity_guardrail',
  'cost_optimization',
] as const satisfies readonly RankingLayerId[];

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
  source:
    | PricingEvidenceSource
    | 'recorded_placeholder'
    | 'catalog'
    | 'recorded_estimate'
    | null;
  amountMicros?: number;
  riskDiscountApplied?: boolean;
  trafficCapHint?: string;
};

export type CriticalEvidenceFactView = {
  kind: string;
  status: 'fresh' | 'stale' | 'missing' | 'below_sample';
  observedAt?: string;
  sampleSize?: number;
  value?: number;
};

export type ExplanationEvidenceFreshness = {
  deploymentId: string;
  criticalEvidence: CriticalEvidenceFactView[];
};

export type ExplanationAcceptanceBranch = {
  acceptance:
    | 'rejected_before_accept'
    | 'accepted'
    | 'acceptance_unknown'
    | 'not_attempted'
    | string;
  decision: ExplanationAcceptanceDecision;
  reason: string;
  primaryDeploymentId?: string;
  fallbackDeploymentId?: string;
};

/** Shared G5 explanation projection (simulator ≡ task_audit shape). */
export type RouteDecisionExplanationView = {
  surface: RouteExplanationSurface;
  hardFilter: {
    passedDeploymentIds: string[];
    excluded: ExplanationExclusion[];
  };
  sort: {
    layerOrder: readonly RankingLayerId[];
    ranked: ExplanationRankEntry[];
  };
  liveExclusions: ExplanationExclusion[];
  maxCost: {
    amountMicros: number;
    currency: 'CNY' | 'USD';
    evidenceSource:
      | PricingEvidenceSource
      | 'catalog'
      | 'recorded_estimate'
      | 'mixed'
      | null;
  } | null;
  acceptanceBranch: ExplanationAcceptanceBranch;
  notSelectedReasons: ExplanationExclusion[];
  evidenceFreshness: ExplanationEvidenceFreshness[];
  costEvidenceSource: ExplanationCostEvidence[];
  dataProcessingLevel: {
    level: string;
    protectedChannel: boolean;
    copy: string;
  };
  failClosed: boolean;
  failClosedReason: 'no_compliant_candidate' | null;
};

export type BuildRouteDecisionExplanationViewInput = {
  surface: RouteExplanationSurface;
  requestedDataClasses: readonly string[];
  hardFilterPassedDeploymentIds: readonly string[];
  hardFilterExcluded: ReadonlyArray<{
    deploymentId: string;
    reasons: readonly string[];
  }>;
  liveExclusions?: ReadonlyArray<{
    deploymentId: string;
    reasons: readonly string[];
  }>;
  ranked?: ReadonlyArray<ExplanationRankEntry>;
  sortExcluded?: ReadonlyArray<ExplanationExclusion>;
  evidenceFreshness?: ReadonlyArray<ExplanationEvidenceFreshness>;
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

function projectDataProcessingLevel(dataClasses: readonly string[]): {
  level: string;
  protectedChannel: boolean;
  copy: string;
} {
  const restricted = dataClasses.some((c) =>
    ['contains_face', 'pii', 'medical', 'medical-health'].includes(c),
  );
  return {
    level: restricted ? 'protected' : 'standard',
    protectedChannel: restricted,
    copy: restricted
      ? '受保护通道：受限数据类仅进入双批准 Deployment'
      : '标准数据处理等级',
  };
}

/**
 * Build the shared explanation projection used by simulator and task audit.
 */
export function buildRouteDecisionExplanationView(
  input: BuildRouteDecisionExplanationViewInput,
): RouteDecisionExplanationView {
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

  const sortExcluded = [...(input.sortExcluded ?? [])];
  const ranked = [...(input.ranked ?? [])];

  const costEvidenceSource: ExplanationCostEvidence[] = [];
  let maxAmount = 0;
  let maxCurrency: 'CNY' | 'USD' = 'CNY';
  const sources = new Set<string>();

  for (const entry of ranked) {
    const cost = input.costByDeploymentId?.get(entry.deploymentId);
    costEvidenceSource.push({
      deploymentId: entry.deploymentId,
      source: cost?.source ?? null,
      ...(cost ? { amountMicros: cost.amountMicros } : {}),
      ...(cost?.riskDiscountApplied ? { riskDiscountApplied: true } : {}),
      ...(cost?.trafficCapHint ? { trafficCapHint: cost.trafficCapHint } : {}),
    });
    if (cost) {
      maxAmount += cost.amountMicros;
      maxCurrency = cost.currency;
      sources.add(cost.source);
    }
  }

  const evidenceFreshness: ExplanationEvidenceFreshness[] = [
    ...(input.evidenceFreshness ??
      ranked.map((entry) => ({
        deploymentId: entry.deploymentId,
        criticalEvidence: [] as CriticalEvidenceFactView[],
      }))),
  ];

  const notSelectedReasons = [
    ...hardExcluded,
    ...sortExcluded,
    ...liveExclusions,
  ];

  const failClosed =
    input.hardFilterPassedDeploymentIds.length === 0 && ranked.length === 0;

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
    dataProcessingLevel: projectDataProcessingLevel(input.requestedDataClasses),
    failClosed,
    failClosedReason: failClosed ? 'no_compliant_candidate' : null,
  };
}

/**
 * Assert simulator and audit projections are structurally identical for the
 * same planning facts (surface field may differ).
 */
export function assertSharedExplanationProjection(
  simulator: RouteDecisionExplanationView,
  taskAudit: RouteDecisionExplanationView,
): void {
  const strip = (value: RouteDecisionExplanationView) => {
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

/** Panel-friendly sections for the route simulator UI. */
export type RouteSimulatorPanelView = {
  surface: RouteExplanationSurface;
  hardFilterPassed: string[];
  hardFilterExcluded: ExplanationExclusion[];
  sortRanked: ExplanationRankEntry[];
  layerOrder: readonly RankingLayerId[];
  liveExclusions: ExplanationExclusion[];
  maxCost: RouteDecisionExplanationView['maxCost'];
  acceptanceBranch: ExplanationAcceptanceBranch;
  notSelectedReasons: ExplanationExclusion[];
  evidenceFreshness: ExplanationEvidenceFreshness[];
  costEvidenceSource: ExplanationCostEvidence[];
  dataProcessingLevel: RouteDecisionExplanationView['dataProcessingLevel'];
  failClosed: boolean;
  failClosedReason: RouteDecisionExplanationView['failClosedReason'];
};

export function projectRouteSimulatorPanel(
  explanation: RouteDecisionExplanationView,
): RouteSimulatorPanelView {
  return {
    surface: explanation.surface,
    hardFilterPassed: explanation.hardFilter.passedDeploymentIds,
    hardFilterExcluded: explanation.hardFilter.excluded,
    sortRanked: explanation.sort.ranked,
    layerOrder: explanation.sort.layerOrder,
    liveExclusions: explanation.liveExclusions,
    maxCost: explanation.maxCost,
    acceptanceBranch: explanation.acceptanceBranch,
    notSelectedReasons: explanation.notSelectedReasons,
    evidenceFreshness: explanation.evidenceFreshness,
    costEvidenceSource: explanation.costEvidenceSource,
    dataProcessingLevel: explanation.dataProcessingLevel,
    failClosed: explanation.failClosed,
    failClosedReason: explanation.failClosedReason,
  };
}

/** Sample planning facts for SSR demos / contract tests (no Core import). */
export function buildDemoRouteExplanationFacts(): BuildRouteDecisionExplanationViewInput {
  return {
    surface: 'simulator',
    requestedDataClasses: ['public'],
    hardFilterPassedDeploymentIds: ['dep-text-ark', 'dep-text-tuzi'],
    hardFilterExcluded: [
      {
        deploymentId: 'dep-image-single',
        reasons: ['operation_unsupported'],
      },
    ],
    liveExclusions: [
      {
        deploymentId: 'dep-text-tuzi',
        reasons: ['health_circuit_open'],
      },
    ],
    ranked: [
      {
        deploymentId: 'dep-text-ark',
        rank: 1,
        band: 'production',
        sortKeys: {
          quality_reliability_gate: 90,
          health_capacity_guardrail: 0.8,
          cost_optimization: 1200,
        },
      },
    ],
    sortExcluded: [
      {
        deploymentId: 'dep-text-tuzi',
        reasons: ['critical_evidence_stale'],
        layer: 'quality_reliability_gate',
      },
    ],
    evidenceFreshness: [
      {
        deploymentId: 'dep-text-ark',
        criticalEvidence: [
          {
            kind: 'conformance',
            status: 'fresh',
            observedAt: '2026-07-20T10:00:00.000Z',
            sampleSize: 50,
            value: 1,
          },
          {
            kind: 'activation_evidence',
            status: 'fresh',
            observedAt: '2026-07-20T10:00:00.000Z',
          },
          {
            kind: 'success_rate',
            status: 'fresh',
            observedAt: '2026-07-20T10:00:00.000Z',
            sampleSize: 120,
            value: 0.97,
          },
        ],
      },
    ],
    costByDeploymentId: new Map([
      [
        'dep-text-ark',
        {
          amountMicros: 1_200,
          currency: 'CNY',
          source: 'invoice',
        },
      ],
    ]),
    acceptanceBranch: {
      acceptance: 'rejected_before_accept',
      decision: 'safe_auto_fallback',
      reason: 'safe_auto_fallback',
      primaryDeploymentId: 'dep-text-ark',
      fallbackDeploymentId: 'dep-text-tuzi',
    },
  };
}

export function buildDemoRouteSimulatorPanel(): RouteSimulatorPanelView {
  const facts = buildDemoRouteExplanationFacts();
  const explanation = buildRouteDecisionExplanationView(facts);
  return projectRouteSimulatorPanel(explanation);
}
