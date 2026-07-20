/**
 * Multi-channel publish gate (I4 → Z2-ACCEPT consumer).
 *
 * Core operation with <2 independent fault-domain qualified Deployments
 * MUST NOT mark multi-channel ready. Same-account dual token / same-endpoint
 * dual alias collapse via faultDomainKey and do not count twice.
 */
import type { SupplyOperation } from '@meiye/contracts';
import { channelLabelForStatus } from './channel-label.js';
import {
  CORE_FAULT_INJECTION_OPERATIONS,
  faultDomainKey,
  SECONDARY_FAULT_INJECTION_OPERATIONS,
  type CoreFaultInjectionOperation,
  type MultiChannelPublishGateResult,
  type MultiChannelReadinessStatus,
  type QualifiedDeploymentEvidence,
  type SecondaryFaultInjectionOperation,
} from './types.js';

export function isCoreFaultInjectionOperation(
  operation: SupplyOperation,
): operation is CoreFaultInjectionOperation {
  return (CORE_FAULT_INJECTION_OPERATIONS as readonly string[]).includes(
    operation,
  );
}

export function isSecondaryFaultInjectionOperation(
  operation: SupplyOperation,
): operation is SecondaryFaultInjectionOperation {
  return (SECONDARY_FAULT_INJECTION_OPERATIONS as readonly string[]).includes(
    operation,
  );
}

export function isQualifiedDeployment(
  deployment: QualifiedDeploymentEvidence,
  options: { requireLiveVerified?: boolean } = {},
): boolean {
  if (deployment.lifecycleStatus && deployment.lifecycleStatus !== 'active') {
    return false;
  }
  if (deployment.healthBlocking) return false;
  if (options.requireLiveVerified) {
    return deployment.activationStatus === 'live_verified';
  }
  return (
    deployment.activationStatus === 'live_verified' ||
    deployment.activationStatus === 'recorded'
  );
}

/**
 * Evaluate whether an operation may claim multi-channel ready.
 * Does not mutate registry — pure gate for publish / Z2-ACCEPT.
 */
export function evaluateMultiChannelPublishGate(input: {
  operation: SupplyOperation;
  catalogModelId: string | null;
  deployments: readonly QualifiedDeploymentEvidence[];
  /** Production claims require live_verified; unit matrix may use recorded. */
  requireLiveVerified?: boolean;
}): MultiChannelPublishGateResult {
  const requireLive = input.requireLiveVerified ?? true;
  const qualified = input.deployments.filter((d) =>
    isQualifiedDeployment(d, { requireLiveVerified: requireLive }),
  );

  // Re-key so dual-token / dual-alias collapse (callers may pass raw keys).
  const normalized = qualified.map((d) => ({
    ...d,
    faultDomainKey: faultDomainKey({
      providerProfileId: d.providerProfileId,
      channelKind: d.channelKind,
      endpointFingerprint: d.endpointFingerprint,
      accountIdentity: d.accountIdentity,
    }),
  }));

  const domainKeys = new Set(normalized.map((d) => d.faultDomainKey));
  const manufacturers = new Set(
    normalized.map((d) => d.manufacturer ?? 'unknown'),
  );
  const channelKinds = new Set(normalized.map((d) => d.channelKind));
  const hasOfficialDirect = channelKinds.has('official_direct');
  const hasUpstreamReseller = channelKinds.has('upstream_reseller');

  let faultDomainKind: MultiChannelPublishGateResult['faultDomainKind'] =
    'none';
  if (domainKeys.size >= 2) {
    faultDomainKind =
      manufacturers.size >= 2
        ? 'independent_counterparty'
        : 'independent_channel';
    if (manufacturers.size === 1 && domainKeys.size >= 2) {
      faultDomainKind = 'shared_manufacturer_only';
    }
  }

  // C5: multi-channel ready requires ≥2 independent fault domains AND both
// official_direct + upstream_reseller source kinds.
  const c5MultiChannelReady =
    domainKeys.size >= 2 && hasOfficialDirect && hasUpstreamReseller;

  let status: MultiChannelReadinessStatus;
  let reason: string;
  if (!input.catalogModelId || normalized.length === 0) {
    status =
      !input.catalogModelId && input.deployments.length === 0
        ? 'blocked'
        : 'not_verified';
    reason =
      status === 'blocked'
        ? 'No catalog model / deployments registered'
        : 'No qualified live_verified (or recorded) deployments';
  } else if (c5MultiChannelReady) {
    status = 'multi_channel_ready';
    reason =
      manufacturers.size < 2
        ? `Channel-level resilience across ${domainKeys.size} independent fault domains (shared manufacturer)`
        : `Manufacturer-level dual supply across ${domainKeys.size} independent fault domains`;
  } else if (normalized.length >= 1) {
    status = 'single_channel';
    reason =
      domainKeys.size < 2
        ? 'Fewer than 2 independent fault domains — cannot mark multi-channel ready'
        : !hasOfficialDirect || !hasUpstreamReseller
          ? 'Missing official_direct or upstream_reseller channel kind'
          : 'Not multi-channel ready';
  } else {
    status = 'not_verified';
    reason = 'No qualified deployments';
  }

  const isCore = isCoreFaultInjectionOperation(input.operation);
  const isSecondary = isSecondaryFaultInjectionOperation(input.operation);

  // Single-channel publish is allowed when labeled; multi-channel claim is gated.
  const publishAllowed =
    status === 'multi_channel_ready' ||
    (status === 'single_channel' && (isSecondary || isCore));

  return {
    operation: input.operation,
    catalogModelId: input.catalogModelId,
    status,
    multiChannelReady: c5MultiChannelReady,
    independentFaultDomainCount: domainKeys.size,
    faultDomainKind: c5MultiChannelReady
      ? manufacturers.size >= 2
        ? 'independent_counterparty'
        : 'shared_manufacturer_only'
      : faultDomainKind,
    manufacturerIndependent: c5MultiChannelReady && manufacturers.size >= 2,
    hasOfficialDirect,
    hasUpstreamReseller,
    qualifiedDeployments: normalized,
    channelLabel: channelLabelForStatus(status),
    reason,
    publishAllowed,
  };
}

/**
 * Attempt to mark multi-channel ready. Rejects when gate is not satisfied.
 * Z2-ACCEPT negative path: single-channel / <2 domains must throw.
 */
export function assertMultiChannelReadyClaim(input: {
  operation: SupplyOperation;
  catalogModelId: string | null;
  deployments: readonly QualifiedDeploymentEvidence[];
  requireLiveVerified?: boolean;
  /** Explicit claim the caller wants to stamp. */
  claim: 'multi_channel_ready' | 'single_channel' | 'not_verified';
}): MultiChannelPublishGateResult {
  const gate = evaluateMultiChannelPublishGate({
    operation: input.operation,
    catalogModelId: input.catalogModelId,
    deployments: input.deployments,
    requireLiveVerified: input.requireLiveVerified,
  });

  if (input.claim === 'multi_channel_ready' && !gate.multiChannelReady) {
    throw new MultiChannelPublishGateError(
      `Publish gate denied multi_channel_ready for ${input.operation}: ${gate.reason}`,
      gate,
    );
  }

  if (
    input.claim === 'single_channel' &&
    gate.status !== 'single_channel' &&
    gate.status !== 'multi_channel_ready'
  ) {
    // Allow multi to also be labeled single? No — single claim when not verified fails.
    if (gate.qualifiedDeployments.length === 0) {
      throw new MultiChannelPublishGateError(
        `Publish gate denied single_channel for ${input.operation}: ${gate.reason}`,
        gate,
      );
    }
  }

  return gate;
}

export class MultiChannelPublishGateError extends Error {
  readonly gate: MultiChannelPublishGateResult;

  constructor(message: string, gate: MultiChannelPublishGateResult) {
    super(message);
    this.name = 'MultiChannelPublishGateError';
    this.gate = gate;
  }
}

/** Convenience builders for tests / live matrix evidence. */
export function qualifiedDeployment(input: {
  deploymentId: string;
  catalogModelId: string;
  providerProfileId: string;
  executionChannelId: string;
  channelKind: QualifiedDeploymentEvidence['channelKind'];
  activationStatus: QualifiedDeploymentEvidence['activationStatus'];
  manufacturer?: string;
  endpointFingerprint?: string;
  accountIdentity?: string;
  lifecycleStatus?: QualifiedDeploymentEvidence['lifecycleStatus'];
  healthBlocking?: boolean;
}): QualifiedDeploymentEvidence {
  return {
    deploymentId: input.deploymentId,
    catalogModelId: input.catalogModelId,
    providerProfileId: input.providerProfileId,
    executionChannelId: input.executionChannelId,
    channelKind: input.channelKind,
    activationStatus: input.activationStatus,
    manufacturer: input.manufacturer,
    endpointFingerprint: input.endpointFingerprint,
    accountIdentity: input.accountIdentity,
    lifecycleStatus: input.lifecycleStatus ?? 'active',
    healthBlocking: input.healthBlocking ?? false,
    faultDomainKey: faultDomainKey({
      providerProfileId: input.providerProfileId,
      channelKind: input.channelKind,
      endpointFingerprint: input.endpointFingerprint,
      accountIdentity: input.accountIdentity,
    }),
  };
}
