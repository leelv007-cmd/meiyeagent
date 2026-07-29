import type {
  ModelCapabilityProfile,
  ModelCapabilityRequirementAxis,
  ProviderFailoverBillingEvent,
} from '@meiye/contracts';

export interface ModelFailoverCandidate {
  catalogModelId: string;
  deploymentId: string;
  executionChannelId?: string | null;
  providerProfileId?: string | null;
  priceRevision: string;
  capabilityProfile?: ModelCapabilityProfile | null;
}

export type ModelFailoverDecision =
  | {
      allowed: true;
      event: ProviderFailoverBillingEvent;
    }
  | {
      allowed: false;
      reason:
        | 'same_execution_channel'
        | 'model_substitution_degradation_undeclared'
        | 'channel_bound_capability_not_equivalent';
      capabilityAxisIds?: string[];
    };

function channelBoundCapabilityIds(
  profile: ModelCapabilityProfile | null | undefined,
): string[] {
  return (profile?.modalityCapabilities ?? [])
    .filter((claim) => claim.channelBound && claim.supported)
    .map((claim) => `${claim.modality}:${claim.capability}`)
    .sort();
}

function hasEquivalentChannelBoundCapability(
  profile: ModelCapabilityProfile | null | undefined,
  capabilityId: string,
): boolean {
  return (profile?.modalityCapabilities ?? []).some(
    (claim) =>
      `${claim.modality}:${claim.capability}` === capabilityId &&
      claim.channelBound &&
      claim.supported,
  );
}

export function usedModalityCapabilityIds(
  requirements: readonly ModelCapabilityRequirementAxis[] | undefined,
): string[] {
  return [
    ...new Set(
      (requirements ?? []).flatMap((axis) =>
        axis.requiredModalityCapabilities.map(
          (requirement) =>
            `${requirement.modality}:${requirement.capability}`,
        ),
      ),
    ),
  ].sort();
}

export function evaluateModelFailover(input: {
  from: ModelFailoverCandidate;
  to: ModelFailoverCandidate;
  degradationSurfaces?: readonly string[];
  usedCapabilityIds?: readonly string[];
}): ModelFailoverDecision {
  const degradationSurfaces = [
    ...new Set(
      (input.degradationSurfaces ?? [])
        .map((surface) => surface.trim())
        .filter(Boolean),
    ),
  ].sort();
  const kind =
    input.from.catalogModelId === input.to.catalogModelId
      ? 'same_model_channel'
      : 'model_substitution';
  if (
    kind === 'same_model_channel' &&
    input.from.executionChannelId &&
    input.from.executionChannelId === input.to.executionChannelId
  ) {
    return { allowed: false, reason: 'same_execution_channel' };
  }
  if (kind === 'model_substitution' && degradationSurfaces.length === 0) {
    return {
      allowed: false,
      reason: 'model_substitution_degradation_undeclared',
    };
  }

  const usedCapabilityIds = new Set(input.usedCapabilityIds ?? []);
  const required = channelBoundCapabilityIds(input.from.capabilityProfile)
    .filter((capabilityId) => usedCapabilityIds.has(capabilityId));
  const staysOnKnownProvider =
    Boolean(input.from.providerProfileId) &&
    input.from.providerProfileId === input.to.providerProfileId;
  if (!staysOnKnownProvider && required.length > 0) {
    const missing = required.filter(
      (capabilityId) =>
        !hasEquivalentChannelBoundCapability(
          input.to.capabilityProfile,
          capabilityId,
        ),
    );
    if (missing.length > 0) {
      return {
        allowed: false,
        reason: 'channel_bound_capability_not_equivalent',
        capabilityAxisIds: missing,
      };
    }
  }

  return {
    allowed: true,
    event: {
      kind,
      fromCatalogModelId: input.from.catalogModelId,
      toCatalogModelId: input.to.catalogModelId,
      fromDeploymentId: input.from.deploymentId,
      toDeploymentId: input.to.deploymentId,
      fromExecutionChannelId: input.from.executionChannelId ?? null,
      toExecutionChannelId: input.to.executionChannelId ?? null,
      fromPriceRevision: input.from.priceRevision,
      toPriceRevision: input.to.priceRevision,
      degradationSurfaces,
    },
  };
}
