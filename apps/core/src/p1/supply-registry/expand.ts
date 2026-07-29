/**
 * Expand CatalogRevision payload thin records into four-layer supply entities
 * + SupplyContract (D-058). Preserves revision IDs from the source payload.
 *
 * Source of truth remains CatalogRevision; this is a projection/migration
 * expand — not a parallel catalog.
 */
import type {
  SupplyCatalogModel,
  SupplyChannelKind,
  SupplyContract,
  SupplyDeployment,
  SupplyExecutionChannel,
  SupplyOperation,
  SupplyProviderProfile,
} from '@meiye/contracts';
import {
  createDefaultCapabilityRevisions,
  createDefaultCatalogModels,
  createDefaultDeployments,
  createDefaultExecutionChannels,
  createDefaultPriceRevisions,
  createDefaultProviderProfiles,
  createDefaultRouteRevisions,
  type CatalogRevisionPayload,
  type ExecutionChannelRevision,
  type ProviderProfileRevision,
  type PublishedDeployment,
} from '../model-supply/catalog.js';
import type { CatalogModel } from '../model-supply/supply-contracts.js';

export interface ExpandedSupplyRegistrySnapshot {
  /** CatalogRevision.id that produced this expand (when known). */
  catalogRevisionId?: string;
  /** CatalogRevision.number when known. */
  catalogRevisionNumber?: number;
  models: SupplyCatalogModel[];
  providerProfiles: SupplyProviderProfile[];
  executionChannels: SupplyExecutionChannel[];
  deployments: SupplyDeployment[];
  contracts: SupplyContract[];
  /** Thin revisions preserved for dual-read / history. */
  source: {
    providerProfileRevisions: ProviderProfileRevision[];
    executionChannelRevisions: ExecutionChannelRevision[];
    publishedDeployments: PublishedDeployment[];
  };
}

export const LOCAL_FIXTURE_COMMERCIAL_USE_TERMS_SUFFIX =
  ':local-fixture-commercial-use';

function channelKind(
  channel: PublishedDeployment['channel'] | ExecutionChannelRevision['channel'],
): SupplyChannelKind {
  return channel === 'direct' ? 'official_direct' : 'upstream_reseller';
}

export function expandCatalogModel(model: CatalogModel): SupplyCatalogModel {
  return {
    id: model.id,
    modality: model.modality,
    operations: model.operations as SupplyOperation[],
    displayName: model.displayName,
    ...(model.manufacturer ? { manufacturer: model.manufacturer } : {}),
    ...(model.stableModelName ? { stableModelName: model.stableModelName } : {}),
    ...(model.version ? { version: model.version } : {}),
    ...(typeof model.qualityRank === 'number'
      ? { qualityRank: model.qualityRank }
      : {}),
  };
}

export function expandProviderProfile(
  revision: ProviderProfileRevision,
): SupplyProviderProfile {
  return {
    id: revision.id,
    displayName: revision.apiCounterparty || revision.manufacturer,
    counterparty: revision.apiCounterparty,
    gatewayFingerprint: gatewayFingerprintFor(revision.apiCounterparty),
    revisionId: `${revision.id}:r${revision.revision}`,
  };
}

function gatewayFingerprintFor(
  counterparty: string,
): SupplyProviderProfile['gatewayFingerprint'] {
  const normalized = counterparty.trim().toLowerCase();
  if (normalized.includes('new api') || normalized === 'new_api') {
    return 'new_api';
  }
  if (normalized.includes('sub2api') || normalized === 'sub2api') {
    return 'sub2api';
  }
  return 'none';
}

export function expandExecutionChannel(
  revision: ExecutionChannelRevision,
): SupplyExecutionChannel {
  return {
    id: revision.id,
    providerProfileId: revision.providerProfileId,
    kind: channelKind(revision.channel),
    region: revision.region,
    protocolFamily: revision.apiFamily,
    accountOwnership: revision.credentialOwner,
    revisionId: `${revision.id}:r${revision.revision}`,
  };
}

export function expandDeployment(
  deployment: PublishedDeployment,
): SupplyDeployment {
  const lifecycleStatus =
    deployment.status === 'retired'
      ? 'retired'
      : deployment.status === 'active'
        ? 'active'
        : 'inactive';
  return {
    id: deployment.id,
    catalogModelId: deployment.catalogModelId,
    providerProfileId: deployment.providerProfileId ?? '',
    executionChannelId: deployment.executionChannelId ?? '',
    ...(deployment.endpointRevision
      ? { endpointRevision: deployment.endpointRevision }
      : {}),
    lifecycleStatus,
    // F-S2-02: never alias deployment/route policyRevision as dataPolicy.
    // Only set dataPolicyRevisionId when a real DataPolicy binding exists.
    ...((deployment as { dataPolicyRevisionId?: string }).dataPolicyRevisionId
      ? {
          dataPolicyRevisionId: (deployment as { dataPolicyRevisionId?: string })
            .dataPolicyRevisionId,
        }
      : {}),
    ...(deployment.priceRevision
      ? { priceRevisionId: deployment.priceRevision }
      : {}),
    ...(deployment.credentialAccountId
      ? { credentialAccountId: deployment.credentialAccountId }
      : {}),
    ...(deployment.activationEvidence
      ? { activationEvidence: structuredClone(deployment.activationEvidence) }
      : {}),
    ...(deployment.capabilityProfile
      ? { capabilityProfile: structuredClone(deployment.capabilityProfile) }
      : {}),
    revisionId:
      deployment.lifecycleRevision ?? `${deployment.id}:lifecycle-missing`,
  };
}

/**
 * Derive a minimal SupplyContract per provider profile from catalog evidence.
 * Terms revision is stable for a given catalog revision so dual-read is idempotent.
 */
export function expandSupplyContracts(
  profiles: SupplyProviderProfile[],
  catalogRevisionId: string | undefined,
  effectiveFrom: string,
): SupplyContract[] {
  return profiles.map((profile) => ({
    id: `contract:${profile.id}`,
    providerProfileId: profile.id,
    termsRevisionId: catalogRevisionId
      ? `${profile.id}:terms:${catalogRevisionId}`
      : `${profile.id}:terms:unversioned`,
    dataProcessingSummary: `Counterparty ${profile.counterparty} under platform supply contract.`,
    effectiveFrom,
  }));
}

/**
 * Expand a full CatalogRevision payload into the four-layer registry snapshot.
 * Missing optional historical fields expand to empty arrays (pre-P1 revisions).
 */
export function expandCatalogRevisionPayload(
  payload: CatalogRevisionPayload,
  options: {
    catalogRevisionId?: string;
    catalogRevisionNumber?: number;
    effectiveFrom?: string;
  } = {},
): ExpandedSupplyRegistrySnapshot {
  const providerProfileRevisions = payload.providerProfiles
    ? structuredClone(payload.providerProfiles)
    : [];
  const executionChannelRevisions = payload.executionChannels
    ? structuredClone(payload.executionChannels)
    : [];
  const publishedDeployments = structuredClone(payload.deployments);

  const models = payload.models.map(expandCatalogModel);
  const providerProfiles = providerProfileRevisions.map(expandProviderProfile);
  const executionChannels = executionChannelRevisions.map(
    expandExecutionChannel,
  );
  const deployments = publishedDeployments.map(expandDeployment);
  const effectiveFrom = options.effectiveFrom ?? new Date(0).toISOString();
  const contracts = expandSupplyContracts(
    providerProfiles,
    options.catalogRevisionId,
    effectiveFrom,
  );

  return {
    ...(options.catalogRevisionId
      ? { catalogRevisionId: options.catalogRevisionId }
      : {}),
    ...(typeof options.catalogRevisionNumber === 'number'
      ? { catalogRevisionNumber: options.catalogRevisionNumber }
      : {}),
    models,
    providerProfiles,
    executionChannels,
    deployments,
    contracts,
    source: {
      providerProfileRevisions,
      executionChannelRevisions,
      publishedDeployments,
    },
  };
}

/** Build a default expanded snapshot from the live default catalog factories. */
export function expandDefaultCatalog(options: {
  activatedDeploymentIds?: string[];
  activationEvidenceByDeploymentId?: Readonly<
    Record<
      string,
      NonNullable<PublishedDeployment['activationEvidence']>
    >
  >;
  catalogRevisionId?: string;
  catalogRevisionNumber?: number;
  effectiveFrom?: string;
} = {}): ExpandedSupplyRegistrySnapshot {
  const payload: CatalogRevisionPayload = {
    models: createDefaultCatalogModels(),
    deployments: createDefaultDeployments({
      activatedDeploymentIds: options.activatedDeploymentIds,
      activationEvidenceByDeploymentId:
        options.activationEvidenceByDeploymentId,
    }),
    capabilities: createDefaultCapabilityRevisions(),
    prices: createDefaultPriceRevisions(),
    routes: createDefaultRouteRevisions(),
    providerProfiles: createDefaultProviderProfiles(),
    executionChannels: createDefaultExecutionChannels(),
  };
  return expandCatalogRevisionPayload(payload, {
    catalogRevisionId: options.catalogRevisionId ?? 'catalog-default-expand',
    catalogRevisionNumber: options.catalogRevisionNumber ?? 1,
    effectiveFrom: options.effectiveFrom ?? '2026-07-01T00:00:00.000Z',
  });
}
