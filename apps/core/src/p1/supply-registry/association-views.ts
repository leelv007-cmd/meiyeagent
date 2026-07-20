/**
 * Five association views over the expanded supply registry (D-058 story 13):
 *  1. model
 *  2. counterparty-channel
 *  3. deployment
 *  4. credential
 *  5. route
 *
 * Each view exposes forward + reverse projections so operators can drill from
 * model→channels and from a failed channel→affected models/deployments.
 */
import type {
  CredentialAccountMetadata,
  RoutePolicyRevision,
  SupplyCatalogModel,
  SupplyDeployment,
  SupplyExecutionChannel,
  SupplyOperation,
  SupplyProviderProfile,
} from '@meiye/contracts';
import type { ExpandedSupplyRegistrySnapshot } from './expand.js';
import type { CredentialSlotMigrationRecord } from './credential-slots.js';

// ---------------------------------------------------------------------------
// Shared indexes
// ---------------------------------------------------------------------------

export interface SupplyRegistryIndexes {
  modelById: Map<string, SupplyCatalogModel>;
  providerById: Map<string, SupplyProviderProfile>;
  channelById: Map<string, SupplyExecutionChannel>;
  deploymentById: Map<string, SupplyDeployment>;
  deploymentsByModelId: Map<string, SupplyDeployment[]>;
  deploymentsByProviderId: Map<string, SupplyDeployment[]>;
  deploymentsByChannelId: Map<string, SupplyDeployment[]>;
  channelsByProviderId: Map<string, SupplyExecutionChannel[]>;
  credentialsByProviderId: Map<string, CredentialAccountMetadata[]>;
}

export function buildSupplyRegistryIndexes(
  snapshot: ExpandedSupplyRegistrySnapshot,
  credentials: CredentialAccountMetadata[] = [],
): SupplyRegistryIndexes {
  const modelById = new Map(snapshot.models.map((m) => [m.id, m]));
  const providerById = new Map(
    snapshot.providerProfiles.map((p) => [p.id, p]),
  );
  const channelById = new Map(
    snapshot.executionChannels.map((c) => [c.id, c]),
  );
  const deploymentById = new Map(snapshot.deployments.map((d) => [d.id, d]));

  const deploymentsByModelId = groupBy(
    snapshot.deployments,
    (d) => d.catalogModelId,
  );
  const deploymentsByProviderId = groupBy(
    snapshot.deployments,
    (d) => d.providerProfileId,
  );
  const deploymentsByChannelId = groupBy(
    snapshot.deployments,
    (d) => d.executionChannelId,
  );
  const channelsByProviderId = groupBy(
    snapshot.executionChannels,
    (c) => c.providerProfileId,
  );
  const credentialsByProviderId = groupBy(
    credentials,
    (c) => c.providerProfileId,
  );

  return {
    modelById,
    providerById,
    channelById,
    deploymentById,
    deploymentsByModelId,
    deploymentsByProviderId,
    deploymentsByChannelId,
    channelsByProviderId,
    credentialsByProviderId,
  };
}

function groupBy<T>(items: readonly T[], keyOf: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

// ---------------------------------------------------------------------------
// 1. Model view
// ---------------------------------------------------------------------------

export interface ModelAssociationForward {
  catalogModelId: string;
  model: SupplyCatalogModel | null;
  deployments: SupplyDeployment[];
  providerProfileIds: string[];
  executionChannelIds: string[];
}

export interface ModelAssociationReverse {
  deploymentId: string;
  catalogModelId: string;
  model: SupplyCatalogModel | null;
}

export function projectModelViewForward(
  indexes: SupplyRegistryIndexes,
  catalogModelId: string,
): ModelAssociationForward {
  const deployments = indexes.deploymentsByModelId.get(catalogModelId) ?? [];
  return {
    catalogModelId,
    model: indexes.modelById.get(catalogModelId) ?? null,
    deployments: structuredClone(deployments),
    providerProfileIds: unique(deployments.map((d) => d.providerProfileId)),
    executionChannelIds: unique(deployments.map((d) => d.executionChannelId)),
  };
}

export function projectModelViewReverse(
  indexes: SupplyRegistryIndexes,
  deploymentId: string,
): ModelAssociationReverse {
  const deployment = indexes.deploymentById.get(deploymentId);
  const catalogModelId = deployment?.catalogModelId ?? '';
  return {
    deploymentId,
    catalogModelId,
    model: catalogModelId
      ? indexes.modelById.get(catalogModelId) ?? null
      : null,
  };
}

// ---------------------------------------------------------------------------
// 2. Counterparty-channel view
// ---------------------------------------------------------------------------

export interface CounterpartyChannelForward {
  providerProfileId: string;
  provider: SupplyProviderProfile | null;
  channels: SupplyExecutionChannel[];
  deployments: SupplyDeployment[];
  affectedCatalogModelIds: string[];
}

export interface CounterpartyChannelReverse {
  executionChannelId: string;
  channel: SupplyExecutionChannel | null;
  provider: SupplyProviderProfile | null;
  deployments: SupplyDeployment[];
  affectedCatalogModelIds: string[];
}

export function projectCounterpartyChannelForward(
  indexes: SupplyRegistryIndexes,
  providerProfileId: string,
): CounterpartyChannelForward {
  const channels = indexes.channelsByProviderId.get(providerProfileId) ?? [];
  const deployments =
    indexes.deploymentsByProviderId.get(providerProfileId) ?? [];
  return {
    providerProfileId,
    provider: indexes.providerById.get(providerProfileId) ?? null,
    channels: structuredClone(channels),
    deployments: structuredClone(deployments),
    affectedCatalogModelIds: unique(deployments.map((d) => d.catalogModelId)),
  };
}

export function projectCounterpartyChannelReverse(
  indexes: SupplyRegistryIndexes,
  executionChannelId: string,
): CounterpartyChannelReverse {
  const channel = indexes.channelById.get(executionChannelId) ?? null;
  const deployments =
    indexes.deploymentsByChannelId.get(executionChannelId) ?? [];
  const provider = channel
    ? indexes.providerById.get(channel.providerProfileId) ?? null
    : null;
  return {
    executionChannelId,
    channel: channel ? structuredClone(channel) : null,
    provider: provider ? structuredClone(provider) : null,
    deployments: structuredClone(deployments),
    affectedCatalogModelIds: unique(deployments.map((d) => d.catalogModelId)),
  };
}

// ---------------------------------------------------------------------------
// 3. Deployment view
// ---------------------------------------------------------------------------

export interface DeploymentAssociationForward {
  deploymentId: string;
  deployment: SupplyDeployment | null;
  model: SupplyCatalogModel | null;
  provider: SupplyProviderProfile | null;
  channel: SupplyExecutionChannel | null;
}

export interface DeploymentAssociationReverse {
  /** Reverse: from model+channel pair back to matching deployments. */
  catalogModelId: string;
  executionChannelId: string;
  deployments: SupplyDeployment[];
}

export function projectDeploymentViewForward(
  indexes: SupplyRegistryIndexes,
  deploymentId: string,
): DeploymentAssociationForward {
  const deployment = indexes.deploymentById.get(deploymentId) ?? null;
  return {
    deploymentId,
    deployment: deployment ? structuredClone(deployment) : null,
    model: deployment
      ? indexes.modelById.get(deployment.catalogModelId) ?? null
      : null,
    provider: deployment
      ? indexes.providerById.get(deployment.providerProfileId) ?? null
      : null,
    channel: deployment
      ? indexes.channelById.get(deployment.executionChannelId) ?? null
      : null,
  };
}

export function projectDeploymentViewReverse(
  indexes: SupplyRegistryIndexes,
  catalogModelId: string,
  executionChannelId: string,
): DeploymentAssociationReverse {
  const byModel = indexes.deploymentsByModelId.get(catalogModelId) ?? [];
  const deployments = byModel.filter(
    (d) => d.executionChannelId === executionChannelId,
  );
  return {
    catalogModelId,
    executionChannelId,
    deployments: structuredClone(deployments),
  };
}

// ---------------------------------------------------------------------------
// 4. Credential view
// ---------------------------------------------------------------------------

export interface CredentialAssociationForward {
  credentialAccountId: string;
  metadata: CredentialAccountMetadata | null;
  provider: SupplyProviderProfile | null;
  deployments: SupplyDeployment[];
  runtimeBound?: boolean;
  runtimeAssemblyKind?: string;
}

export interface CredentialAssociationReverse {
  providerProfileId: string;
  credentials: CredentialAccountMetadata[];
  deployments: SupplyDeployment[];
}

export function projectCredentialViewForward(
  indexes: SupplyRegistryIndexes,
  credential: CredentialAccountMetadata | null,
  slotRecord?: CredentialSlotMigrationRecord,
): CredentialAssociationForward {
  if (!credential) {
    return {
      credentialAccountId: '',
      metadata: null,
      provider: null,
      deployments: [],
    };
  }
  const deployments =
    indexes.deploymentsByProviderId.get(credential.providerProfileId) ?? [];
  return {
    credentialAccountId: credential.id,
    metadata: structuredClone(credential),
    provider:
      indexes.providerById.get(credential.providerProfileId) ?? null,
    deployments: structuredClone(deployments),
    ...(slotRecord
      ? {
          runtimeBound: slotRecord.runtimeBound,
          runtimeAssemblyKind: slotRecord.runtimeAssembly.kind,
        }
      : {}),
  };
}

export function projectCredentialViewReverse(
  indexes: SupplyRegistryIndexes,
  providerProfileId: string,
): CredentialAssociationReverse {
  return {
    providerProfileId,
    credentials: structuredClone(
      indexes.credentialsByProviderId.get(providerProfileId) ?? [],
    ),
    deployments: structuredClone(
      indexes.deploymentsByProviderId.get(providerProfileId) ?? [],
    ),
  };
}

// ---------------------------------------------------------------------------
// 5. Route view
// ---------------------------------------------------------------------------

export interface RouteAssociationForward {
  operation: SupplyOperation;
  policy: RoutePolicyRevision | null;
  candidateDeployments: SupplyDeployment[];
  catalogModelIds: string[];
  providerProfileIds: string[];
  executionChannelIds: string[];
}

export interface RouteAssociationReverse {
  deploymentId: string;
  operations: SupplyOperation[];
  policies: RoutePolicyRevision[];
}

export function projectRouteViewForward(
  indexes: SupplyRegistryIndexes,
  operation: SupplyOperation,
  policies: readonly RoutePolicyRevision[],
): RouteAssociationForward {
  const policy =
    policies.find((p) => p.operation === operation && p.publishedAt) ??
    policies.find((p) => p.operation === operation) ??
    null;
  const candidateIds = policy?.candidateDeploymentIds ?? [];
  const candidateDeployments = candidateIds
    .map((id) => indexes.deploymentById.get(id))
    .filter((d): d is SupplyDeployment => Boolean(d))
    .map((d) => structuredClone(d));
  return {
    operation,
    policy: policy ? structuredClone(policy) : null,
    candidateDeployments,
    catalogModelIds: unique(candidateDeployments.map((d) => d.catalogModelId)),
    providerProfileIds: unique(
      candidateDeployments.map((d) => d.providerProfileId),
    ),
    executionChannelIds: unique(
      candidateDeployments.map((d) => d.executionChannelId),
    ),
  };
}

export function projectRouteViewReverse(
  indexes: SupplyRegistryIndexes,
  deploymentId: string,
  policies: readonly RoutePolicyRevision[],
): RouteAssociationReverse {
  const matching = policies.filter((p) =>
    p.candidateDeploymentIds.includes(deploymentId),
  );
  return {
    deploymentId,
    operations: unique(matching.map((p) => p.operation)),
    policies: structuredClone(matching),
  };
}

// ---------------------------------------------------------------------------
// Aggregate five-view projector
// ---------------------------------------------------------------------------

export interface FiveAssociationViews {
  model: {
    forward: (catalogModelId: string) => ModelAssociationForward;
    reverse: (deploymentId: string) => ModelAssociationReverse;
  };
  counterpartyChannel: {
    forward: (providerProfileId: string) => CounterpartyChannelForward;
    reverse: (executionChannelId: string) => CounterpartyChannelReverse;
  };
  deployment: {
    forward: (deploymentId: string) => DeploymentAssociationForward;
    reverse: (
      catalogModelId: string,
      executionChannelId: string,
    ) => DeploymentAssociationReverse;
  };
  credential: {
    forward: (
      credential: CredentialAccountMetadata | null,
      slotRecord?: CredentialSlotMigrationRecord,
    ) => CredentialAssociationForward;
    reverse: (providerProfileId: string) => CredentialAssociationReverse;
  };
  route: {
    forward: (
      operation: SupplyOperation,
      policies: readonly RoutePolicyRevision[],
    ) => RouteAssociationForward;
    reverse: (
      deploymentId: string,
      policies: readonly RoutePolicyRevision[],
    ) => RouteAssociationReverse;
  };
}

export function createFiveAssociationViews(
  snapshot: ExpandedSupplyRegistrySnapshot,
  credentials: CredentialAccountMetadata[] = [],
): FiveAssociationViews {
  const indexes = buildSupplyRegistryIndexes(snapshot, credentials);
  return {
    model: {
      forward: (id) => projectModelViewForward(indexes, id),
      reverse: (id) => projectModelViewReverse(indexes, id),
    },
    counterpartyChannel: {
      forward: (id) => projectCounterpartyChannelForward(indexes, id),
      reverse: (id) => projectCounterpartyChannelReverse(indexes, id),
    },
    deployment: {
      forward: (id) => projectDeploymentViewForward(indexes, id),
      reverse: (modelId, channelId) =>
        projectDeploymentViewReverse(indexes, modelId, channelId),
    },
    credential: {
      forward: (credential, slot) =>
        projectCredentialViewForward(indexes, credential, slot),
      reverse: (id) => projectCredentialViewReverse(indexes, id),
    },
    route: {
      forward: (operation, policies) =>
        projectRouteViewForward(indexes, operation, policies),
      reverse: (deploymentId, policies) =>
        projectRouteViewReverse(indexes, deploymentId, policies),
    },
  };
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}
