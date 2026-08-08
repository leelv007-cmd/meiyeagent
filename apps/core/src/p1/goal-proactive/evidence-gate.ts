/**
 * Proactive evidence-coverage gate (V31-24 / V3.1 §25 R11 / U2 / U13).
 *
 * - Threshold unset ⇒ gate closed (no suggestions); coverage is observational only.
 * - Baseline period: ops may open via proactive_opportunity_v1 workspace allowlist.
 * - disable_proactive_agent kill switch force-closes the pipeline.
 */

export const PROACTIVE_FEATURE_FLAGS = {
  marketingGoal: 'marketing_goal_v1',
  proactiveOpportunity: 'proactive_opportunity_v1',
  /** Numeric threshold 0–1; unset/null ⇒ gate closed (U13). */
  evidenceCoverageThreshold: 'proactive_evidence_coverage_threshold',
} as const;

export const PROACTIVE_KILL_SWITCH_KEYS = {
  disableProactiveAgent: 'disable_proactive_agent',
} as const;

export type EvidenceCoverageObservation = {
  resourceId: string;
  /** Delivered works / packages considered in the observation window. */
  denominator: number;
  /** Subset that has at least one OutcomeEvidence (non-withdrawn). */
  numerator: number;
  coverage: number | null;
  /** True when threshold is configured and coverage meets it. */
  gateOpenByCoverage: boolean;
  /** Threshold as read from admin-config; null when unset. */
  threshold: number | null;
};

export type ProactiveGateDecision = {
  open: boolean;
  reason:
    | 'kill_switch'
    | 'feature_flag_off'
    | 'threshold_unset'
    | 'coverage_below_threshold'
    | 'workspace_allowlist'
    | 'coverage_met';
  observation: EvidenceCoverageObservation;
  killSwitchEnabled: boolean;
  featureFlagOn: boolean;
  workspaceAllowlisted: boolean;
};

export type ProactiveGateConfig = {
  /** Global/workspace kill switch; true ⇒ force closed. */
  disableProactiveAgent: boolean;
  /** marketing_goal_v1 / proactive feature on (default true when unset for goal product). */
  proactiveFeatureOn: boolean;
  /** U13: workspace allowlisted via proactive_opportunity_v1. */
  workspaceAllowlisted: boolean;
  /** Coverage threshold 0–1; null/undefined ⇒ unset. */
  coverageThreshold: number | null;
};

export function computeEvidenceCoverage(input: {
  resourceId: string;
  denominator: number;
  numerator: number;
  threshold: number | null;
}): EvidenceCoverageObservation {
  const denominator = Math.max(0, Math.floor(input.denominator));
  const numerator = Math.max(
    0,
    Math.min(denominator, Math.floor(input.numerator)),
  );
  const coverage = denominator === 0 ? null : numerator / denominator;
  const threshold = input.threshold;
  const gateOpenByCoverage =
    threshold !== null &&
    threshold !== undefined &&
    Number.isFinite(threshold) &&
    coverage !== null &&
    coverage >= threshold;
  return {
    resourceId: input.resourceId,
    denominator,
    numerator,
    coverage,
    gateOpenByCoverage,
    threshold: threshold ?? null,
  };
}

/**
 * Gate policy:
 * 1. kill switch → closed
 * 2. feature flag off → closed
 * 3. workspace allowlist (U13 pilot) → open even when threshold unset
 * 4. threshold unset → closed (coverage observation only)
 * 5. coverage ≥ threshold → open
 */
export function decideProactiveGate(input: {
  resourceId: string;
  config: ProactiveGateConfig;
  denominator: number;
  numerator: number;
}): ProactiveGateDecision {
  const observation = computeEvidenceCoverage({
    resourceId: input.resourceId,
    denominator: input.denominator,
    numerator: input.numerator,
    threshold: input.config.coverageThreshold,
  });

  if (input.config.disableProactiveAgent) {
    return {
      open: false,
      reason: 'kill_switch',
      observation,
      killSwitchEnabled: true,
      featureFlagOn: input.config.proactiveFeatureOn,
      workspaceAllowlisted: input.config.workspaceAllowlisted,
    };
  }
  if (!input.config.proactiveFeatureOn) {
    return {
      open: false,
      reason: 'feature_flag_off',
      observation,
      killSwitchEnabled: false,
      featureFlagOn: false,
      workspaceAllowlisted: input.config.workspaceAllowlisted,
    };
  }
  if (input.config.workspaceAllowlisted) {
    return {
      open: true,
      reason: 'workspace_allowlist',
      observation,
      killSwitchEnabled: false,
      featureFlagOn: true,
      workspaceAllowlisted: true,
    };
  }
  if (observation.threshold === null) {
    return {
      open: false,
      reason: 'threshold_unset',
      observation,
      killSwitchEnabled: false,
      featureFlagOn: true,
      workspaceAllowlisted: false,
    };
  }
  if (!observation.gateOpenByCoverage) {
    return {
      open: false,
      reason: 'coverage_below_threshold',
      observation,
      killSwitchEnabled: false,
      featureFlagOn: true,
      workspaceAllowlisted: false,
    };
  }
  return {
    open: true,
    reason: 'coverage_met',
    observation,
    killSwitchEnabled: false,
    featureFlagOn: true,
    workspaceAllowlisted: false,
  };
}

export type AdminConfigHeadReader = {
  get(
    scope: 'global' | 'workspace',
    workspaceId: string,
    key: string,
  ): Promise<{ value: unknown } | null>;
};

/**
 * Hot-read proactive flags + kill switch from admin-config heads.
 * Workspace allowlist = workspace-scoped proactive_opportunity_v1 === true.
 */
export async function resolveProactiveGateConfig(
  reader: AdminConfigHeadReader,
  workspaceId: string,
): Promise<ProactiveGateConfig> {
  const global = '__global__';
  const [kill, marketingGoal, allowlist, thresholdHead] = await Promise.all([
    reader.get(
      'global',
      global,
      PROACTIVE_KILL_SWITCH_KEYS.disableProactiveAgent,
    ),
    // marketing_goal_v1 / product master — default on when unset.
    reader.get('global', global, PROACTIVE_FEATURE_FLAGS.marketingGoal),
    // U13: workspace-scoped proactive_opportunity_v1 === true → pilot allowlist.
    reader.get(
      'workspace',
      workspaceId,
      PROACTIVE_FEATURE_FLAGS.proactiveOpportunity,
    ),
    reader.get(
      'global',
      global,
      PROACTIVE_FEATURE_FLAGS.evidenceCoverageThreshold,
    ),
  ]);

  const thresholdValue = thresholdHead?.value;
  let coverageThreshold: number | null = null;
  if (typeof thresholdValue === 'number' && Number.isFinite(thresholdValue)) {
    coverageThreshold = thresholdValue;
  }

  return {
    disableProactiveAgent: kill?.value === true,
    proactiveFeatureOn: marketingGoal?.value !== false,
    workspaceAllowlisted: allowlist?.value === true,
    coverageThreshold,
  };
}
