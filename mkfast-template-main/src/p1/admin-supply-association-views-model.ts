/**
 * Five association views (J4 / D-058): model · counterparty-channel ·
 * deployment · credential · route — each with forward + reverse projection.
 *
 * Frontend-local pure projection over SupplyControlSnapshot (mirrors core
 * association-views contract without importing apps/core).
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

import { buildDefaultSupplyControlSnapshot } from './admin-supply-fixture';
import type { SupplyControlSnapshot } from './admin-supply-types';
import {
  admin_supply_counterparty_channel_associations_bc2cb47d,
  admin_supply_credential_associations_d7c44840,
  admin_supply_deployment_associations_523d4aea,
  admin_supply_model_associations_f19395ed,
  admin_supply_route_associations_2bf36c13,
} from '@/locale/paraglide/messages';

export const ASSOCIATION_VIEW_IDS = [
  'model',
  'counterparty-channel',
  'deployment',
  'credential',
  'route',
] as const;

export type AssociationViewId = (typeof ASSOCIATION_VIEW_IDS)[number];

export const ASSOCIATION_VIEW_PATHS: Record<AssociationViewId, string> = {
  model: '/admin/supply/views/model',
  'counterparty-channel': '/admin/supply/views/counterparty-channel',
  deployment: '/admin/supply/views/deployment',
  credential: '/admin/supply/views/credential',
  route: '/admin/supply/views/route',
};

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
  credentialById: Map<string, CredentialAccountMetadata>;
}

function groupBy<T>(
  items: readonly T[],
  keyOf: (item: T) => string
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const list = map.get(key);
    if (list) list.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function unique<T extends string>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

export function buildSupplyRegistryIndexes(
  snapshot: SupplyControlSnapshot
): SupplyRegistryIndexes {
  return {
    modelById: new Map(snapshot.models.map((m) => [m.id, m])),
    providerById: new Map(snapshot.providerProfiles.map((p) => [p.id, p])),
    channelById: new Map(snapshot.executionChannels.map((c) => [c.id, c])),
    deploymentById: new Map(snapshot.deployments.map((d) => [d.id, d])),
    deploymentsByModelId: groupBy(
      snapshot.deployments,
      (d) => d.catalogModelId
    ),
    deploymentsByProviderId: groupBy(
      snapshot.deployments,
      (d) => d.providerProfileId
    ),
    deploymentsByChannelId: groupBy(
      snapshot.deployments,
      (d) => d.executionChannelId
    ),
    channelsByProviderId: groupBy(
      snapshot.executionChannels,
      (c) => c.providerProfileId
    ),
    credentialsByProviderId: groupBy(
      snapshot.credentials,
      (c) => c.providerProfileId
    ),
    credentialById: new Map(snapshot.credentials.map((c) => [c.id, c])),
  };
}

// --- 1. Model ---

export interface ModelViewForward {
  direction: 'forward';
  view: 'model';
  catalogModelId: string;
  model: SupplyCatalogModel | null;
  deployments: SupplyDeployment[];
  providerProfileIds: string[];
  executionChannelIds: string[];
}

export interface ModelViewReverse {
  direction: 'reverse';
  view: 'model';
  deploymentId: string;
  catalogModelId: string;
  model: SupplyCatalogModel | null;
}

export function projectModelForward(
  indexes: SupplyRegistryIndexes,
  catalogModelId: string
): ModelViewForward {
  const deployments = indexes.deploymentsByModelId.get(catalogModelId) ?? [];
  return {
    direction: 'forward',
    view: 'model',
    catalogModelId,
    model: indexes.modelById.get(catalogModelId) ?? null,
    deployments,
    providerProfileIds: unique(deployments.map((d) => d.providerProfileId)),
    executionChannelIds: unique(deployments.map((d) => d.executionChannelId)),
  };
}

export function projectModelReverse(
  indexes: SupplyRegistryIndexes,
  deploymentId: string
): ModelViewReverse {
  const deployment = indexes.deploymentById.get(deploymentId);
  const catalogModelId = deployment?.catalogModelId ?? '';
  return {
    direction: 'reverse',
    view: 'model',
    deploymentId,
    catalogModelId,
    model: catalogModelId
      ? (indexes.modelById.get(catalogModelId) ?? null)
      : null,
  };
}

// --- 2. Counterparty-channel ---

export interface CounterpartyChannelViewForward {
  direction: 'forward';
  view: 'counterparty-channel';
  providerProfileId: string;
  provider: SupplyProviderProfile | null;
  channels: SupplyExecutionChannel[];
  deployments: SupplyDeployment[];
  affectedCatalogModelIds: string[];
}

export interface CounterpartyChannelViewReverse {
  direction: 'reverse';
  view: 'counterparty-channel';
  executionChannelId: string;
  channel: SupplyExecutionChannel | null;
  provider: SupplyProviderProfile | null;
  deployments: SupplyDeployment[];
  affectedCatalogModelIds: string[];
}

export function projectCounterpartyChannelForward(
  indexes: SupplyRegistryIndexes,
  providerProfileId: string
): CounterpartyChannelViewForward {
  const channels = indexes.channelsByProviderId.get(providerProfileId) ?? [];
  const deployments =
    indexes.deploymentsByProviderId.get(providerProfileId) ?? [];
  return {
    direction: 'forward',
    view: 'counterparty-channel',
    providerProfileId,
    provider: indexes.providerById.get(providerProfileId) ?? null,
    channels,
    deployments,
    affectedCatalogModelIds: unique(deployments.map((d) => d.catalogModelId)),
  };
}

export function projectCounterpartyChannelReverse(
  indexes: SupplyRegistryIndexes,
  executionChannelId: string
): CounterpartyChannelViewReverse {
  const channel = indexes.channelById.get(executionChannelId) ?? null;
  const deployments =
    indexes.deploymentsByChannelId.get(executionChannelId) ?? [];
  const provider = channel
    ? (indexes.providerById.get(channel.providerProfileId) ?? null)
    : null;
  return {
    direction: 'reverse',
    view: 'counterparty-channel',
    executionChannelId,
    channel,
    provider,
    deployments,
    affectedCatalogModelIds: unique(deployments.map((d) => d.catalogModelId)),
  };
}

// --- 3. Deployment ---

export interface DeploymentViewForward {
  direction: 'forward';
  view: 'deployment';
  deploymentId: string;
  deployment: SupplyDeployment | null;
  model: SupplyCatalogModel | null;
  provider: SupplyProviderProfile | null;
  channel: SupplyExecutionChannel | null;
}

export interface DeploymentViewReverse {
  direction: 'reverse';
  view: 'deployment';
  catalogModelId: string;
  executionChannelId: string;
  deployments: SupplyDeployment[];
}

export function projectDeploymentForward(
  indexes: SupplyRegistryIndexes,
  deploymentId: string
): DeploymentViewForward {
  const deployment = indexes.deploymentById.get(deploymentId) ?? null;
  return {
    direction: 'forward',
    view: 'deployment',
    deploymentId,
    deployment,
    model: deployment
      ? (indexes.modelById.get(deployment.catalogModelId) ?? null)
      : null,
    provider: deployment
      ? (indexes.providerById.get(deployment.providerProfileId) ?? null)
      : null,
    channel: deployment
      ? (indexes.channelById.get(deployment.executionChannelId) ?? null)
      : null,
  };
}

export function projectDeploymentReverse(
  indexes: SupplyRegistryIndexes,
  catalogModelId: string,
  executionChannelId: string
): DeploymentViewReverse {
  const byModel = indexes.deploymentsByModelId.get(catalogModelId) ?? [];
  return {
    direction: 'reverse',
    view: 'deployment',
    catalogModelId,
    executionChannelId,
    deployments: byModel.filter(
      (d) => d.executionChannelId === executionChannelId
    ),
  };
}

// --- 4. Credential ---

export interface CredentialViewForward {
  direction: 'forward';
  view: 'credential';
  credentialAccountId: string;
  metadata: CredentialAccountMetadata | null;
  provider: SupplyProviderProfile | null;
  deployments: SupplyDeployment[];
}

export interface CredentialViewReverse {
  direction: 'reverse';
  view: 'credential';
  providerProfileId: string;
  credentials: CredentialAccountMetadata[];
  deployments: SupplyDeployment[];
}

export function projectCredentialForward(
  indexes: SupplyRegistryIndexes,
  credentialAccountId: string
): CredentialViewForward {
  const metadata = indexes.credentialById.get(credentialAccountId) ?? null;
  if (!metadata) {
    return {
      direction: 'forward',
      view: 'credential',
      credentialAccountId,
      metadata: null,
      provider: null,
      deployments: [],
    };
  }
  return {
    direction: 'forward',
    view: 'credential',
    credentialAccountId,
    metadata,
    provider: indexes.providerById.get(metadata.providerProfileId) ?? null,
    deployments:
      indexes.deploymentsByProviderId.get(metadata.providerProfileId) ?? [],
  };
}

export function projectCredentialReverse(
  indexes: SupplyRegistryIndexes,
  providerProfileId: string
): CredentialViewReverse {
  return {
    direction: 'reverse',
    view: 'credential',
    providerProfileId,
    credentials: indexes.credentialsByProviderId.get(providerProfileId) ?? [],
    deployments: indexes.deploymentsByProviderId.get(providerProfileId) ?? [],
  };
}

// --- 5. Route ---

export interface RouteViewForward {
  direction: 'forward';
  view: 'route';
  operation: SupplyOperation;
  policy: RoutePolicyRevision | null;
  candidateDeployments: SupplyDeployment[];
  catalogModelIds: string[];
  providerProfileIds: string[];
  executionChannelIds: string[];
}

export interface RouteViewReverse {
  direction: 'reverse';
  view: 'route';
  deploymentId: string;
  operations: SupplyOperation[];
  policies: RoutePolicyRevision[];
}

export function projectRouteForward(
  indexes: SupplyRegistryIndexes,
  operation: SupplyOperation,
  policies: readonly RoutePolicyRevision[]
): RouteViewForward {
  const policy =
    policies.find((p) => p.operation === operation && p.publishedAt) ??
    policies.find((p) => p.operation === operation) ??
    null;
  const candidateDeployments = (policy?.candidateDeploymentIds ?? [])
    .map((id) => indexes.deploymentById.get(id))
    .filter((d): d is SupplyDeployment => Boolean(d));
  return {
    direction: 'forward',
    view: 'route',
    operation,
    policy,
    candidateDeployments,
    catalogModelIds: unique(candidateDeployments.map((d) => d.catalogModelId)),
    providerProfileIds: unique(
      candidateDeployments.map((d) => d.providerProfileId)
    ),
    executionChannelIds: unique(
      candidateDeployments.map((d) => d.executionChannelId)
    ),
  };
}

export function projectRouteReverse(
  _indexes: SupplyRegistryIndexes,
  deploymentId: string,
  policies: readonly RoutePolicyRevision[]
): RouteViewReverse {
  const matching = policies.filter((p) =>
    p.candidateDeploymentIds.includes(deploymentId)
  );
  return {
    direction: 'reverse',
    view: 'route',
    deploymentId,
    operations: unique(matching.map((p) => p.operation)),
    policies: matching,
  };
}

export type AssociationProjection =
  | ModelViewForward
  | ModelViewReverse
  | CounterpartyChannelViewForward
  | CounterpartyChannelViewReverse
  | DeploymentViewForward
  | DeploymentViewReverse
  | CredentialViewForward
  | CredentialViewReverse
  | RouteViewForward
  | RouteViewReverse;

export interface AssociationViewPanelModel {
  viewId: AssociationViewId;
  path: string;
  title: string;
  forward: AssociationProjection;
  reverse: AssociationProjection;
}

const VIEW_TITLES: Record<AssociationViewId, string> = {
  model: admin_supply_model_associations_f19395ed(),
  'counterparty-channel':
    admin_supply_counterparty_channel_associations_bc2cb47d(),
  deployment: admin_supply_deployment_associations_523d4aea(),
  credential: admin_supply_credential_associations_d7c44840(),
  route: admin_supply_route_associations_2bf36c13(),
};

export function buildAssociationViewPanel(
  viewId: AssociationViewId,
  snapshot: SupplyControlSnapshot = buildDefaultSupplyControlSnapshot(),
  seeds?: {
    catalogModelId?: string;
    providerProfileId?: string;
    deploymentId?: string;
    executionChannelId?: string;
    credentialAccountId?: string;
    operation?: SupplyOperation;
  }
): AssociationViewPanelModel {
  const indexes = buildSupplyRegistryIndexes(snapshot);
  const catalogModelId = seeds?.catalogModelId ?? snapshot.models[0]?.id ?? '';
  const providerProfileId =
    seeds?.providerProfileId ?? snapshot.providerProfiles[0]?.id ?? '';
  const deploymentId = seeds?.deploymentId ?? snapshot.deployments[0]?.id ?? '';
  const executionChannelId =
    seeds?.executionChannelId ?? snapshot.executionChannels[0]?.id ?? '';
  const credentialAccountId =
    seeds?.credentialAccountId ?? snapshot.credentials[0]?.id ?? '';
  const operation = seeds?.operation ?? 'copy.generate';

  let forward: AssociationProjection;
  let reverse: AssociationProjection;

  switch (viewId) {
    case 'model':
      forward = projectModelForward(indexes, catalogModelId);
      reverse = projectModelReverse(indexes, deploymentId);
      break;
    case 'counterparty-channel':
      forward = projectCounterpartyChannelForward(indexes, providerProfileId);
      reverse = projectCounterpartyChannelReverse(indexes, executionChannelId);
      break;
    case 'deployment':
      forward = projectDeploymentForward(indexes, deploymentId);
      reverse = projectDeploymentReverse(
        indexes,
        catalogModelId,
        executionChannelId
      );
      break;
    case 'credential':
      forward = projectCredentialForward(indexes, credentialAccountId);
      reverse = projectCredentialReverse(indexes, providerProfileId);
      break;
    case 'route':
      forward = projectRouteForward(indexes, operation, snapshot.routePolicies);
      reverse = projectRouteReverse(
        indexes,
        deploymentId,
        snapshot.routePolicies
      );
      break;
  }

  return {
    viewId,
    path: ASSOCIATION_VIEW_PATHS[viewId],
    title: VIEW_TITLES[viewId],
    forward,
    reverse,
  };
}

export function listAssociationViewReachability(): Array<{
  viewId: AssociationViewId;
  path: string;
  title: string;
}> {
  return ASSOCIATION_VIEW_IDS.map((viewId) => ({
    viewId,
    path: ASSOCIATION_VIEW_PATHS[viewId],
    title: VIEW_TITLES[viewId],
  }));
}

export function isAssociationViewId(value: string): value is AssociationViewId {
  return (ASSOCIATION_VIEW_IDS as readonly string[]).includes(value);
}
