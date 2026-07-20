/**
 * Multi-channel publish gate (Z2-ACCEPT / D-069 story 34).
 *
 * Core operation may claim multi_channel_ready only when ≥2 independent
 * fault domains have qualified Deployments. Single-channel must be labeled
 * single-channel / no-fallback — never silently upgraded.
 */
import type { ActivationEvidenceStatus, SupplyChannelKind } from '@meiye/contracts';
import { dualChannelActivationGateReady } from '../model-supply/provider-conformance/activation-evidence-input.js';
import type { ActivationEvidenceInput } from '../model-supply/provider-conformance/types.js';

export type MultiChannelClaim =
  | 'multi_channel_ready'
  | 'single_channel'
  | 'no_fallback'
  | 'not_verified'
  | 'blocked';

export interface QualifiedDeploymentForGate {
  deploymentId: string;
  channelKind: SupplyChannelKind;
  /** Independent fault domain key (providerProfileId::channelKind). */
  faultDomainKey: string;
  activationStatus: ActivationEvidenceStatus | 'none';
  /** When false, deployment is not counted as qualified. */
  healthy?: boolean;
}

export interface MultiChannelPublishClaim {
  /** Core operation id (copy.generate / image.generate / video.generate). */
  operation: string;
  catalogModelId: string | null;
  /** Operator / system claim under evaluation. */
  claim: MultiChannelClaim;
  qualifiedDeployments: readonly QualifiedDeploymentForGate[];
}

export interface MultiChannelPublishGateResult {
  allowed: boolean;
  reason: string;
  independentFaultDomainCount: number;
  qualifiedCount: number;
  /** Honest surface label for UI both ends. */
  surfaceLabel: string;
  /** True when single-channel / no-fallback labeling is required. */
  requiresNoFallbackLabel: boolean;
  /** Claim that is honest for this qualified set. */
  honestClaim: MultiChannelClaim;
}

const QUALIFIED_ACTIVATION: ReadonlySet<ActivationEvidenceStatus | 'none'> =
  new Set(['recorded', 'live_verified']);

function countIndependentFaultDomains(
  deployments: readonly QualifiedDeploymentForGate[],
): number {
  const domains = new Set<string>();
  for (const deployment of deployments) {
    if (deployment.healthy === false) continue;
    if (!QUALIFIED_ACTIVATION.has(deployment.activationStatus)) continue;
    if (!deployment.faultDomainKey.trim()) continue;
    domains.add(deployment.faultDomainKey);
  }
  return domains.size;
}

function countQualified(
  deployments: readonly QualifiedDeploymentForGate[],
): number {
  let count = 0;
  for (const deployment of deployments) {
    if (deployment.healthy === false) continue;
    if (!QUALIFIED_ACTIVATION.has(deployment.activationStatus)) continue;
    count += 1;
  }
  return count;
}

/**
 * Evaluate whether a multi-channel readiness claim is publishable.
 * Rejects multi_channel_ready when independent fault domains < 2.
 */
export function evaluateMultiChannelPublishGate(
  input: MultiChannelPublishClaim,
): MultiChannelPublishGateResult {
  const independentFaultDomainCount = countIndependentFaultDomains(
    input.qualifiedDeployments,
  );
  const qualifiedCount = countQualified(input.qualifiedDeployments);

  let honestClaim: MultiChannelClaim;
  if (!input.catalogModelId || qualifiedCount === 0) {
    honestClaim = input.qualifiedDeployments.length === 0 ? 'blocked' : 'not_verified';
  } else if (independentFaultDomainCount >= 2) {
    honestClaim = 'multi_channel_ready';
  } else if (qualifiedCount >= 1) {
    honestClaim = 'single_channel';
  } else {
    honestClaim = 'not_verified';
  }

  const requiresNoFallbackLabel =
    honestClaim === 'single_channel' || honestClaim === 'no_fallback';

  const surfaceLabel =
    honestClaim === 'multi_channel_ready'
      ? '双渠道就绪'
      : honestClaim === 'single_channel' || honestClaim === 'no_fallback'
        ? '单渠道 / 无回退'
        : honestClaim === 'blocked'
          ? '无部署'
          : '未核验';

  if (input.claim === 'multi_channel_ready') {
    if (independentFaultDomainCount < 2 || qualifiedCount < 2) {
      return {
        allowed: false,
        reason:
          'Publish gate rejects multi_channel_ready: core operation needs ≥2 independent fault-domain qualified Deployments.',
        independentFaultDomainCount,
        qualifiedCount,
        surfaceLabel,
        requiresNoFallbackLabel: true,
        honestClaim,
      };
    }
    return {
      allowed: true,
      reason: 'multi_channel_ready with ≥2 independent fault domains',
      independentFaultDomainCount,
      qualifiedCount,
      surfaceLabel,
      requiresNoFallbackLabel: false,
      honestClaim: 'multi_channel_ready',
    };
  }

  // Non multi-channel claims are always allowed if they match honesty.
  if (
    (input.claim === 'single_channel' || input.claim === 'no_fallback') &&
    requiresNoFallbackLabel
  ) {
    return {
      allowed: true,
      reason: 'single-channel / no-fallback claim matches qualified set',
      independentFaultDomainCount,
      qualifiedCount,
      surfaceLabel: '单渠道 / 无回退',
      requiresNoFallbackLabel: true,
      honestClaim,
    };
  }

  return {
    allowed: true,
    reason: `claim ${input.claim} accepted (honest=${honestClaim})`,
    independentFaultDomainCount,
    qualifiedCount,
    surfaceLabel,
    requiresNoFallbackLabel,
    honestClaim,
  };
}

/**
 * Assert dual-channel activation evidence is publish-gate ready.
 * Thin wrapper around dualChannelActivationGateReady for Z2-ACCEPT imports.
 */
export function assertDualChannelActivationPublishable(
  inputs: readonly ActivationEvidenceInput[],
  options: { requireLiveVerified?: boolean } = {},
): { ready: boolean; reason: string } {
  const ready = dualChannelActivationGateReady(inputs, options);
  return {
    ready,
    reason: ready
      ? options.requireLiveVerified
        ? 'official_direct + upstream_reseller both live_verified'
        : 'official_direct + upstream_reseller both recorded|live_verified'
      : options.requireLiveVerified
        ? 'missing live_verified dual channels (env-gated live matrix required)'
        : 'missing dual-channel activation evidence (official_direct + upstream_reseller)',
  };
}

export { dualChannelActivationGateReady };
