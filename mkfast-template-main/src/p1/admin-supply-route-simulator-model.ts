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
import {
  admin_supply_protected_channel_restricted_data_classe_530568cb,
  admin_supply_standard_data_processing_level_fe4edd0a,
} from '@/locale/paraglide/messages';

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
    ['contains_face', 'pii', 'medical', 'medical-health'].includes(c)
  );
  return {
    level: restricted ? 'protected' : 'standard',
    protectedChannel: restricted,
    copy: restricted
      ? admin_supply_protected_channel_restricted_data_classe_530568cb()
      : admin_supply_standard_data_processing_level_fe4edd0a(),
  };
}

/**
 * Build the shared explanation projection used by simulator and task audit.
 */
export function buildRouteDecisionExplanationView(
  input: BuildRouteDecisionExplanationViewInput
): RouteDecisionExplanationView {
  const hardExcluded: ExplanationExclusion[] = input.hardFilterExcluded.map(
    (entry) => ({
      deploymentId: entry.deploymentId,
      reasons: [...entry.reasons],
      layer: 'hard_filter' as const,
    })
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
  taskAudit: RouteDecisionExplanationView
): void {
  const strip = (value: RouteDecisionExplanationView) => {
    const { surface: _surface, ...rest } = value;
    return rest;
  };
  const left = JSON.stringify(strip(simulator));
  const right = JSON.stringify(strip(taskAudit));
  if (left !== right) {
    throw new Error(
      'Simulator and task-audit explanation projections diverged.'
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
  explanation: RouteDecisionExplanationView
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

/**
 * Live route-simulator UI state (F-J-02).
 * Fixture path uses ready+demo; live always mounts the panel with idle/error/ready.
 */
export type LiveRouteSimulatorState =
  | { status: 'idle' }
  | { status: 'error'; message: string }
  | { status: 'ready'; view: RouteSimulatorPanelView };

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? value
    : undefined;
}

function asStringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

function asRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const record = asRecord(item);
        return record ? [record] : [];
      })
    : [];
}

function projectExclusion(
  record: Record<string, unknown>
): ExplanationExclusion | null {
  const deploymentId = asString(record.deploymentId);
  if (!deploymentId) return null;
  const layer = asString(record.layer);
  return {
    deploymentId,
    reasons: asStringList(record.reasons),
    ...(layer
      ? {
          layer: layer as ExplanationExclusion['layer'],
        }
      : {}),
  };
}

function projectRankEntry(
  record: Record<string, unknown>
): ExplanationRankEntry | null {
  const deploymentId = asString(record.deploymentId);
  const rank = asNumber(record.rank);
  if (!deploymentId || rank == null) return null;
  const bandRaw = asString(record.band);
  const band: ExplanationRankEntry['band'] =
    bandRaw === 'canary' ? 'canary' : 'production';
  return {
    deploymentId,
    rank,
    band,
    sortKeys: {},
  };
}

/**
 * Project Core / BFF routeDecision payloads into the shared panel view.
 * Accepts either a flat explanation (preview) or `{ simulator, taskAudit }` (execute).
 */
export function projectLiveRouteDecision(
  value: unknown
): RouteSimulatorPanelView | null {
  const root = asRecord(value);
  if (!root) return null;

  const explanation =
    asRecord(root.simulator) ??
    (asRecord(root.hardFilter) || asRecord(root.sort) ? root : undefined);
  if (!explanation) return null;

  const hardFilter = asRecord(explanation.hardFilter) ?? {};
  const sort = asRecord(explanation.sort) ?? {};
  const acceptance = asRecord(explanation.acceptanceBranch) ?? {};
  const maxCostRaw = asRecord(explanation.maxCost);
  const dataProcessing = asRecord(explanation.dataProcessingLevel) ?? {};

  const hardFilterPassed = asStringList(hardFilter.passedDeploymentIds);
  const hardFilterExcluded = asRecordList(hardFilter.excluded)
    .map(projectExclusion)
    .filter((row): row is ExplanationExclusion => row != null);
  const sortRanked = asRecordList(sort.ranked)
    .map(projectRankEntry)
    .filter((row): row is ExplanationRankEntry => row != null);
  const layerOrderRaw = asStringList(sort.layerOrder);
  const layerOrder =
    layerOrderRaw.length > 0
      ? (layerOrderRaw as RankingLayerId[])
      : THREE_LAYER_ORDER;
  const liveExclusions = asRecordList(explanation.liveExclusions)
    .map(projectExclusion)
    .filter((row): row is ExplanationExclusion => row != null);
  const notSelectedReasons = asRecordList(explanation.notSelectedReasons)
    .map(projectExclusion)
    .filter((row): row is ExplanationExclusion => row != null);

  const evidenceFreshness: ExplanationEvidenceFreshness[] = asRecordList(
    explanation.evidenceFreshness
  ).flatMap((row) => {
    const deploymentId = asString(row.deploymentId);
    if (!deploymentId) return [];
    const criticalEvidence: CriticalEvidenceFactView[] = asRecordList(
      row.criticalEvidence
    ).flatMap((fact) => {
      const kind = asString(fact.kind);
      const status = asString(fact.status);
      if (!kind || !status) return [];
      return [
        {
          kind,
          status: status as CriticalEvidenceFactView['status'],
          ...(asString(fact.observedAt)
            ? { observedAt: asString(fact.observedAt) }
            : {}),
          ...(asNumber(fact.sampleSize) != null
            ? { sampleSize: asNumber(fact.sampleSize) }
            : {}),
          ...(asNumber(fact.value) != null
            ? { value: asNumber(fact.value) }
            : {}),
        },
      ];
    });
    return [{ deploymentId, criticalEvidence }];
  });

  const costEvidenceSource: ExplanationCostEvidence[] = asRecordList(
    explanation.costEvidenceSource
  ).flatMap((row) => {
    const deploymentId = asString(row.deploymentId);
    if (!deploymentId) return [];
    return [
      {
        deploymentId,
        source:
          (asString(row.source) as ExplanationCostEvidence['source']) ?? null,
        ...(asNumber(row.amountMicros) != null
          ? { amountMicros: asNumber(row.amountMicros) }
          : {}),
        ...(row.riskDiscountApplied === true
          ? { riskDiscountApplied: true }
          : {}),
      },
    ];
  });

  const decisionRaw = asString(acceptance.decision) ?? 'stop';
  const acceptanceBranch: ExplanationAcceptanceBranch = {
    acceptance:
      (asString(
        acceptance.acceptance
      ) as ExplanationAcceptanceBranch['acceptance']) ?? 'acceptance_unknown',
    decision: decisionRaw as ExplanationAcceptanceDecision,
    reason: asString(acceptance.reason) ?? decisionRaw,
    ...(asString(acceptance.primaryDeploymentId)
      ? { primaryDeploymentId: asString(acceptance.primaryDeploymentId) }
      : {}),
    ...(asString(acceptance.fallbackDeploymentId)
      ? { fallbackDeploymentId: asString(acceptance.fallbackDeploymentId) }
      : {}),
  };

  const currencyRaw = asString(maxCostRaw?.currency);
  const maxCost =
    maxCostRaw && asNumber(maxCostRaw.amountMicros) != null
      ? {
          amountMicros: asNumber(maxCostRaw.amountMicros)!,
          currency: (currencyRaw === 'USD' ? 'USD' : 'CNY') as 'CNY' | 'USD',
          evidenceSource: (asString(maxCostRaw.evidenceSource) ??
            null) as NonNullable<
            RouteDecisionExplanationView['maxCost']
          >['evidenceSource'],
        }
      : null;

  const surfaceRaw = asString(explanation.surface);
  const surface: RouteExplanationSurface =
    surfaceRaw === 'task_audit' ? 'task_audit' : 'simulator';

  const failClosed = explanation.failClosed === true;
  const failClosedReason =
    failClosed || explanation.failClosedReason === 'no_compliant_candidate'
      ? ('no_compliant_candidate' as const)
      : null;

  return {
    surface,
    hardFilterPassed,
    hardFilterExcluded,
    sortRanked,
    layerOrder,
    liveExclusions,
    maxCost,
    acceptanceBranch,
    notSelectedReasons,
    evidenceFreshness,
    costEvidenceSource,
    dataProcessingLevel: {
      level: asString(dataProcessing.level) ?? 'standard',
      protectedChannel: dataProcessing.protectedChannel === true,
      copy:
        asString(dataProcessing.copy) ??
        (dataProcessing.protectedChannel === true
          ? admin_supply_protected_channel_restricted_data_classe_530568cb()
          : admin_supply_standard_data_processing_level_fe4edd0a()),
    },
    failClosed,
    failClosedReason,
  };
}
