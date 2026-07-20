/**
 * Supply control-plane helpers for RoutePolicy + health overlay (G4)
 * and DataPolicy hard filter + three-layer ranking (G5).
 *
 * Evolves thin RouteRevision / planModelSupplyCandidates without a second
 * concurrent effective head: when a RoutePolicy is published for
 * (operation, qualityTier), it is the sole authority; otherwise planning
 * falls through to the characterized hard-filter behavior.
 *
 * Auto-fallback is authorized only for rejected_before_accept when the next
 * candidate still passes all hard constraints. accepted / acceptance_unknown
 * enter query/reconcile/manual recovery — never blind cross-channel resubmit.
 *
 * G5: DataPolicyRevision hard-filters restricted data classes (dual approval);
 * ranking is quality gate → health/capacity guardrail → cost optimization.
 * Simulator and task audit share `buildRouteDecisionExplanation`.
 */
import type {
  HealthOverlayPort,
  HealthOverlayRecord,
  PricingEvidenceSource,
  SupplyOperation,
} from '@meiye/contracts';
import type { Acceptance } from '../model-supply/supply-contracts.js';
import type {
  CatalogModel,
  DataClass,
  ModelDeployment,
  ModelOperation,
} from '../model-supply/supply-contracts.js';
import type {
  RequestedSelection,
  RouteCandidateExclusionReason,
} from '../model-supply/route-contracts.js';
import {
  planModelSupplyCandidates,
} from '../model-supply/route-planning.js';
import type { RouteRevision } from '../model-supply/catalog.js';
import {
  isHealthOverlayBlocking,
  resolveHealthOverlayRecord,
} from './health-overlay.js';
import {
  expandThinRouteRevision,
  type RoutePolicyPayload,
  type RoutePolicyQualityTier,
  type RoutePolicyRegistry,
  type RoutePolicyRevisionRecord,
  type RoutePolicySimulationSummary,
  toPublicRoutePolicyRevision,
} from './route-policy.js';
import {
  evaluateDataPolicyHardFilter,
  failClosedWithoutCompliantCandidate,
  isRestrictedDataClass,
  type ContentSensitivityDataClass,
  type DataPolicyPayload,
  type DualApprovalEvidence,
} from './data-policy.js';
import {
  rankCandidatesThreeLayer,
  type RankingCandidateInput,
  type ThreeLayerRankingResult,
} from './three-layer-ranking.js';
import {
  buildRouteDecisionExplanation,
  type BuildRouteDecisionExplanationInput,
  type ExplanationAcceptanceBranch,
  type ExplanationSurface,
  type RouteDecisionExplanation,
} from './route-explanation.js';

export type AutoFallbackDecision =
  | 'safe_auto_fallback'
  | 'query_reconcile_manual'
  | 'fallback_not_authorized'
  | 'no_safe_fallback_candidate'
  | 'stop';

/**
 * Auto-fallback gate (D-059): only rejected_before_accept may auto-advance,
 * and only when the next candidate still satisfies hard constraints.
 */
export function decideAutoFallback(input: {
  acceptance: Acceptance;
  fallbackAuthorized: boolean;
  nextCandidatePassesHardConstraints: boolean;
}): AutoFallbackDecision {
  if (
    input.acceptance === 'accepted' ||
    input.acceptance === 'acceptance_unknown'
  ) {
    return 'query_reconcile_manual';
  }
  if (input.acceptance !== 'rejected_before_accept') {
    return 'stop';
  }
  if (!input.fallbackAuthorized) {
    return 'fallback_not_authorized';
  }
  if (!input.nextCandidatePassesHardConstraints) {
    return 'no_safe_fallback_candidate';
  }
  return 'safe_auto_fallback';
}

export function resolveRoutePolicyAuthority(input: {
  registry: RoutePolicyRegistry;
  operation: SupplyOperation | ModelOperation;
  qualityTier?: RoutePolicyQualityTier;
  /** Thin catalog routes — used only when no published policy head exists. */
  thinRoutes?: readonly RouteRevision[];
}): {
  source: 'published_policy' | 'thin_route_bootstrap' | 'unconstrained';
  policy: RoutePolicyPayload | null;
  head: RoutePolicyRevisionRecord | null;
} {
  const qualityTier = input.qualityTier ?? 'quality';
  const head = input.registry.getEffectiveHead(
    input.operation as SupplyOperation,
    qualityTier,
  );
  if (head) {
    return {
      source: 'published_policy',
      policy: structuredClone(head.payload),
      head,
    };
  }
  const thin = input.thinRoutes?.find(
    (route) => route.operation === input.operation,
  );
  if (thin) {
    // Bootstrap is not a second published head — only fills planning defaults
    // until an explicit RoutePolicy is published for this operation/tier.
    return {
      source: 'thin_route_bootstrap',
      policy: expandThinRouteRevision(thin, { qualityTier }),
      head: null,
    };
  }
  return { source: 'unconstrained', policy: null, head: null };
}

export async function collectHealthExcludedDeploymentIds(input: {
  overlay: HealthOverlayPort;
  deploymentIds: readonly string[];
  /** Optional workspace/credential scoping for isolation targets. */
  isolationTargetIds?: readonly string[];
  nowMs?: number;
}): Promise<string[]> {
  const nowMs = input.nowMs ?? Date.now();
  const excluded = new Set<string>();
  const targets: Array<{
    targetKind: HealthOverlayRecord['targetKind'];
    targetId: string;
    deploymentId?: string;
  }> = [
    ...input.deploymentIds.map((deploymentId) => ({
      targetKind: 'deployment' as const,
      targetId: deploymentId,
      deploymentId,
    })),
    ...(input.isolationTargetIds ?? []).map((targetId) => ({
      targetKind: 'deployment' as const,
      targetId,
    })),
  ];
  for (const target of targets) {
    const record = await input.overlay.get(target.targetKind, target.targetId);
    if (!record) continue;
    const resolved = resolveHealthOverlayRecord(record, nowMs);
    if (isHealthOverlayBlocking(resolved.state)) {
      if (target.deploymentId) {
        excluded.add(target.deploymentId);
      } else {
        // isolation targetId form: workspace:deploymentId:credential
        const parts = target.targetId.split(':');
        if (parts.length >= 2) excluded.add(parts[1]!);
      }
    }
  }
  return [...excluded];
}

/**
 * Plan candidates under the single effective RoutePolicy authority + overlay.
 * When no published policy exists, behavior matches planModelSupplyCandidates
 * characterization (plus optional overlay exclusions).
 */
export function planModelSupplyCandidatesWithPolicy(input: {
  catalog: {
    modelById: Map<string, CatalogModel>;
    deployments: ModelDeployment[];
  };
  operation: ModelOperation;
  selection: RequestedSelection;
  dataClass: DataClass[];
  unavailableDeploymentIds?: readonly string[];
  healthExcludedDeploymentIds?: readonly string[];
  routePolicy?: RoutePolicyPayload | null;
}): ReturnType<typeof planModelSupplyCandidates> {
  const healthExcluded = new Set(input.healthExcludedDeploymentIds ?? []);
  const unavailable = new Set([
    ...(input.unavailableDeploymentIds ?? []),
    ...healthExcluded,
  ]);

  // When a published policy lists candidates, restrict the planning catalog
  // to those deployments (order preserved via post-sort). Empty list = no
  // candidates (fail closed). Unconstrained/thin bootstrap with empty
  // candidateDeploymentIds keeps full catalog (thin routes have no deps).
  let catalog = input.catalog;
  let policyOrder: string[] | null = null;
  if (
    input.routePolicy &&
    input.routePolicy.candidateDeploymentIds.length > 0
  ) {
    const allowed = new Set(input.routePolicy.candidateDeploymentIds);
    policyOrder = [...input.routePolicy.candidateDeploymentIds];
    catalog = {
      modelById: input.catalog.modelById,
      deployments: input.catalog.deployments.filter((d) => allowed.has(d.id)),
    };
  }

  const plan = planModelSupplyCandidates({
    catalog,
    operation: input.operation,
    selection: input.selection,
    dataClass: input.dataClass,
    unavailableDeploymentIds: [...unavailable],
  });

  if (policyOrder) {
    const rank = new Map(policyOrder.map((id, index) => [id, index]));
    plan.candidates.sort(
      (left, right) =>
        (rank.get(left.deployment.id) ?? Number.MAX_SAFE_INTEGER) -
        (rank.get(right.deployment.id) ?? Number.MAX_SAFE_INTEGER),
    );
  }

  // Cost boundary hard constraint (policy): drop candidates over budget.
  if (
    input.routePolicy?.costBoundaryMicros !== undefined &&
    input.routePolicy.costBoundaryMicros >= 0
  ) {
    const boundary = input.routePolicy.costBoundaryMicros;
    for (const evaluation of plan.candidateEvaluations) {
      if (
        evaluation.eligible &&
        evaluation.costEstimate.amountMicros > boundary
      ) {
        evaluation.eligible = false;
        evaluation.exclusionReasons.push('cost_boundary_exceeded');
      }
    }
    plan.candidates = plan.candidates.filter((candidate) => {
      const evaluation = plan.candidateEvaluations.find(
        (e) => e.deploymentId === candidate.deployment.id,
      );
      return evaluation?.eligible === true;
    });
  }

  return plan;
}

export function buildRoutePolicySimulationSummary(
  plan: ReturnType<typeof planModelSupplyCandidates>,
): RoutePolicySimulationSummary {
  const eligibleDeploymentIds = plan.candidates.map((c) => c.deployment.id);
  const excluded = plan.candidateEvaluations
    .filter((e) => !e.eligible)
    .map((e) => ({
      deploymentId: e.deploymentId,
      reasons: [...e.exclusionReasons],
    }));
  const costs = plan.candidates.map((c) => {
    const evaluation = plan.candidateEvaluations.find(
      (e) => e.deploymentId === c.deployment.id,
    );
    return evaluation?.costEstimate.amountMicros ?? 0;
  });
  return {
    eligibleDeploymentIds,
    excluded,
    estimatedMaximumCostMicros:
      costs.length === 0 ? null : costs.reduce((sum, value) => sum + value, 0),
    simulatedAt: new Date().toISOString(),
  };
}

/**
 * Full candidate→simulate helper that never publishes.
 * Used by the publish aggregate before approve.
 */
export function simulateRoutePolicyCandidate(input: {
  registry: RoutePolicyRegistry;
  revisionId: string;
  catalog: {
    modelById: Map<string, CatalogModel>;
    deployments: ModelDeployment[];
  };
  selection: RequestedSelection;
  dataClass: DataClass[];
  unavailableDeploymentIds?: readonly string[];
  healthExcludedDeploymentIds?: readonly string[];
  actorId?: string;
  correlationId?: string;
}) {
  const revision = input.registry.get(input.revisionId);
  if (!revision) {
    throw new Error(`Unknown RoutePolicy revision ${input.revisionId}.`);
  }
  const plan = planModelSupplyCandidatesWithPolicy({
    catalog: input.catalog,
    operation: revision.payload.operation as ModelOperation,
    selection: input.selection,
    dataClass: input.dataClass,
    unavailableDeploymentIds: input.unavailableDeploymentIds,
    healthExcludedDeploymentIds: input.healthExcludedDeploymentIds,
    routePolicy: revision.payload,
  });
  const summary = buildRoutePolicySimulationSummary(plan);
  const simulated = input.registry.simulate(
    input.revisionId,
    summary,
    input.actorId && input.correlationId
      ? {
          actorId: input.actorId,
          correlationId: input.correlationId,
        }
      : undefined,
  );
  return {
    revision: simulated,
    plan,
    summary,
    publicView: toPublicRoutePolicyRevision(simulated),
  };
}

export type DeploymentDataPolicyBinding = {
  deploymentId: string;
  dataPolicy: DataPolicyPayload;
  dataPolicyRevisionId: string;
  dualApproval?: DualApprovalEvidence | null;
};

export type PlanWithDataPolicyAndRankingInput = {
  catalog: {
    modelById: Map<string, CatalogModel>;
    deployments: ModelDeployment[];
  };
  operation: ModelOperation;
  selection: RequestedSelection;
  dataClass: Array<DataClass | ContentSensitivityDataClass | 'public'>;
  unavailableDeploymentIds?: readonly string[];
  healthExcludedDeploymentIds?: readonly string[];
  routePolicy?: RoutePolicyPayload | null;
  /** Per-deployment DataPolicy bindings (G5). Missing → thin data-class filter. */
  dataPolicyByDeploymentId?: ReadonlyMap<string, DeploymentDataPolicyBinding>;
  /** When true, content-safety rejection forbids vendor switch. */
  contentSafetyRejected?: boolean;
  /** Optional ranking evidence for three-layer sort (eligible candidates only). */
  rankingInputsByDeploymentId?: ReadonlyMap<string, RankingCandidateInput>;
  /** Apply three-layer ranking after hard filters (default true when ranking inputs provided). */
  applyThreeLayerRanking?: boolean;
};

export type PlanWithDataPolicyAndRankingResult = {
  plan: ReturnType<typeof planModelSupplyCandidates>;
  ranking: ThreeLayerRankingResult | null;
  failClosed: boolean;
  failClosedReason: 'no_compliant_candidate' | null;
  dataPolicyExcluded: Array<{
    deploymentId: string;
    reasons: string[];
  }>;
};

/**
 * Plan under RoutePolicy + DataPolicy hard filter + optional three-layer ranking.
 * No compliant candidate after hard filters → fail closed (D-064).
 */
export function planModelSupplyCandidatesWithDataPolicy(
  input: PlanWithDataPolicyAndRankingInput,
): PlanWithDataPolicyAndRankingResult {
  // Thin planner DataClass has no medical-health; alias to medical for the
  // regional ceiling, then DataPolicy hard filter refines dual-approval.
  const thinDataClass: DataClass[] = [];
  for (const value of input.dataClass) {
    if (value === 'contains_face' || value === 'pii' || value === 'medical') {
      if (!thinDataClass.includes(value)) thinDataClass.push(value);
    } else if (value === 'medical-health') {
      if (!thinDataClass.includes('medical')) thinDataClass.push('medical');
    }
  }

  const base = planModelSupplyCandidatesWithPolicy({
    catalog: input.catalog,
    operation: input.operation,
    selection: input.selection,
    dataClass: thinDataClass,
    unavailableDeploymentIds: input.unavailableDeploymentIds,
    healthExcludedDeploymentIds: input.healthExcludedDeploymentIds,
    routePolicy: input.routePolicy,
  });

  // When medical-health is requested, thin DataClass filter does not see it —
  // re-run via DataPolicy / thin medical alias below for every evaluation.
  const dataPolicyExcluded: Array<{ deploymentId: string; reasons: string[] }> =
    [];
  const policyMap = input.dataPolicyByDeploymentId;

  // F-G-03: restricted classes with no/empty binding map fail closed globally.
  const hasRestrictedRequest = input.dataClass.some((dc) =>
    isRestrictedDataClass(dc as ContentSensitivityDataClass),
  );
  if ((!policyMap || policyMap.size === 0) && hasRestrictedRequest) {
    for (const evaluation of base.candidateEvaluations) {
      if (!evaluation.eligible) continue;
      evaluation.eligible = false;
      if (
        !evaluation.exclusionReasons.includes(
          'data_policy_missing_for_restricted_class',
        )
      ) {
        evaluation.exclusionReasons.push(
          'data_policy_missing_for_restricted_class',
        );
      }
      dataPolicyExcluded.push({
        deploymentId: evaluation.deploymentId,
        reasons: ['data_policy_missing_for_restricted_class'],
      });
    }
    base.candidates = [];
  } else if (policyMap && policyMap.size > 0) {
    for (const evaluation of base.candidateEvaluations) {
      const binding = policyMap.get(evaluation.deploymentId);
      const deployment = input.catalog.deployments.find(
        (d) => d.id === evaluation.deploymentId,
      );
      if (!deployment) continue;

      const result = evaluateDataPolicyHardFilter({
        deployment,
        requestedDataClasses: input.dataClass,
        dataPolicy: binding?.dataPolicy ?? null,
        dataPolicyRevisionId: binding?.dataPolicyRevisionId ?? null,
        dualApproval: binding?.dualApproval ?? null,
        contentSafetyRejected: input.contentSafetyRejected === true,
      });

      if (!result.allowed) {
        evaluation.eligible = false;
        for (const reason of result.reasons) {
          const code = reason as RouteCandidateExclusionReason;
          if (!evaluation.exclusionReasons.includes(code)) {
            evaluation.exclusionReasons.push(code);
          }
        }
        dataPolicyExcluded.push({
          deploymentId: evaluation.deploymentId,
          reasons: [...result.reasons],
        });
      }
    }

    base.candidates = base.candidates.filter((candidate) => {
      const evaluation = base.candidateEvaluations.find(
        (e) => e.deploymentId === candidate.deployment.id,
      );
      return evaluation?.eligible === true;
    });
  } else if (input.contentSafetyRejected) {
    for (const evaluation of base.candidateEvaluations) {
      if (!evaluation.eligible) continue;
      evaluation.eligible = false;
      evaluation.exclusionReasons.push('content_safety_no_vendor_switch');
    }
    base.candidates = [];
  }

  const closed = failClosedWithoutCompliantCandidate({
    eligibleCount: base.candidates.length,
  });

  let ranking: ThreeLayerRankingResult | null = null;
  const shouldRank =
    input.applyThreeLayerRanking === true ||
    (input.applyThreeLayerRanking !== false &&
      input.rankingInputsByDeploymentId !== undefined &&
      input.rankingInputsByDeploymentId.size > 0);

  if (shouldRank && base.candidates.length > 0) {
    // F-G-04: never synthesize perfect fresh evidence. Missing inputs → exclude.
    const rankingInputs: RankingCandidateInput[] = [];
    for (const candidate of base.candidates) {
      const provided = input.rankingInputsByDeploymentId?.get(
        candidate.deployment.id,
      );
      if (provided) {
        rankingInputs.push(provided);
        continue;
      }
      const evaluation = base.candidateEvaluations.find(
        (e) => e.deploymentId === candidate.deployment.id,
      );
      if (evaluation) {
        evaluation.eligible = false;
        if (!evaluation.exclusionReasons.includes('missing_ranking_evidence')) {
          evaluation.exclusionReasons.push('missing_ranking_evidence');
        }
      }
    }
    base.candidates = base.candidates.filter((candidate) => {
      const evaluation = base.candidateEvaluations.find(
        (e) => e.deploymentId === candidate.deployment.id,
      );
      return evaluation?.eligible === true;
    });
    ranking =
      rankingInputs.length > 0
        ? rankCandidatesThreeLayer(rankingInputs)
        : null;

    if (ranking) {
      // Reorder plan.candidates: production then canary by rank; drop excluded.
      const order = new Map(
        ranking.ranked
          .filter((c) => c.band !== 'excluded' && c.rank !== null)
          .map((c) => [c.deploymentId, c.rank as number]),
      );
      const excludedIds = new Set(
        ranking.excluded.map((c) => c.deploymentId),
      );
      for (const evaluation of base.candidateEvaluations) {
        if (excludedIds.has(evaluation.deploymentId) && evaluation.eligible) {
          evaluation.eligible = false;
          const reasons =
            ranking.excluded.find(
              (c) => c.deploymentId === evaluation.deploymentId,
            )?.exclusionReasons ?? [];
          for (const reason of reasons) {
            evaluation.exclusionReasons.push(
              reason as RouteCandidateExclusionReason,
            );
          }
        }
      }
      base.candidates = base.candidates
        .filter((c) => order.has(c.deployment.id))
        .sort(
          (left, right) =>
            (order.get(left.deployment.id) ?? Number.MAX_SAFE_INTEGER) -
            (order.get(right.deployment.id) ?? Number.MAX_SAFE_INTEGER),
        );
    }
  }

  const closedAfterRank = failClosedWithoutCompliantCandidate({
    eligibleCount: base.candidates.length,
  });

  return {
    plan: base,
    ranking,
    failClosed: closed.failClosed || closedAfterRank.failClosed,
    failClosedReason: closedAfterRank.reason ?? closed.reason,
    dataPolicyExcluded,
  };
}

/**
 * Build the shared simulator / task-audit explanation from a G5 plan result.
 */
export function explainPlanDecision(input: {
  surface: ExplanationSurface;
  planResult: PlanWithDataPolicyAndRankingResult;
  requestedDataClasses: readonly string[];
  liveExclusions?: BuildRouteDecisionExplanationInput['liveExclusions'];
  acceptanceBranch: ExplanationAcceptanceBranch;
  costEvidenceSourceByDeploymentId?: ReadonlyMap<
    string,
    PricingEvidenceSource | 'catalog' | 'recorded_estimate'
  >;
}): RouteDecisionExplanation {
  const { plan, ranking, failClosed } = input.planResult;
  const hardFilterPassedDeploymentIds = plan.candidateEvaluations
    .filter((e) => e.eligible)
    .map((e) => e.deploymentId);
  // Prefer pre-ranking eligibility for hard-filter section when ranking ran.
  const isRankingReason = (r: string): boolean =>
    r.startsWith('critical_evidence_') ||
    r.startsWith('below_sample_threshold') ||
    r === 'circuit_open' ||
    r === 'rate_limited' ||
    r.startsWith('health_overlay_') ||
    r === 'balance_quota_exhausted' ||
    r === 'concurrency_exhausted' ||
    r === 'capacity_headroom_exhausted' ||
    r === 'recorded_placeholder_ignored_for_sort' ||
    r === 'risk_discount_applied' ||
    r === 'missing_ranking_evidence';

  const isHardFilterReason = (r: string): boolean =>
    r === 'catalog_model_missing' ||
    r === 'deployment_inactive' ||
    r === 'operation_unsupported' ||
    r === 'fixed_model_mismatch' ||
    r === 'custom_requires_fixed_selection' ||
    r === 'data_class_disallowed' ||
    r === 'simulated_unavailable' ||
    r === 'cost_boundary_exceeded' ||
    r === 'dual_approval_missing' ||
    r === 'data_policy_region_mismatch' ||
    r === 'data_policy_missing_for_restricted_class' ||
    r === 'content_safety_no_vendor_switch' ||
    r === 'no_compliant_candidate';

  const hardPassed =
    ranking === null
      ? hardFilterPassedDeploymentIds
      : plan.candidateEvaluations
          .filter(
            (e) =>
              e.eligible ||
              e.exclusionReasons.some((r) => isRankingReason(String(r))),
          )
          .filter((e) => {
            const hardOnly = e.exclusionReasons.filter((r) =>
              isHardFilterReason(String(r)),
            );
            return hardOnly.length === 0;
          })
          .map((e) => e.deploymentId);

  const hardFilterExcluded = plan.candidateEvaluations
    .filter((e) => !hardPassed.includes(e.deploymentId))
    .map((e) => ({
      deploymentId: e.deploymentId,
      reasons: e.exclusionReasons.filter(
        (r) => isHardFilterReason(String(r)) || !isRankingReason(String(r)),
      ),
    }))
    .filter((e) => e.reasons.length > 0);

  const costByDeploymentId = new Map(
    plan.candidateEvaluations.map((e) => {
      const source =
        input.costEvidenceSourceByDeploymentId?.get(e.deploymentId) ??
        (e.costEstimate.source === 'catalog'
          ? 'catalog'
          : e.costEstimate.source === 'recorded_estimate'
            ? 'recorded_estimate'
            : 'gateway_estimate');
      return [
        e.deploymentId,
        {
          amountMicros: e.costEstimate.amountMicros,
          currency: e.costEstimate.currency,
          source: source as PricingEvidenceSource | 'catalog' | 'recorded_estimate',
        },
      ] as const;
    }),
  );

  const explanation = buildRouteDecisionExplanation({
    surface: input.surface,
    requestedDataClasses: input.requestedDataClasses,
    hardFilterPassedDeploymentIds: hardPassed,
    hardFilterExcluded,
    liveExclusions: input.liveExclusions,
    ranking,
    costByDeploymentId,
    acceptanceBranch: input.acceptanceBranch,
  });

  // Align fail-closed with plan result when ranking emptied the set.
  if (failClosed && !explanation.failClosed) {
    return {
      ...explanation,
      failClosed: true,
      failClosedReason: 'no_compliant_candidate',
    };
  }
  return explanation;
}
