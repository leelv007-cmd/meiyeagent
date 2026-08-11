/**
 * Expand-fidelity validation for the CatalogRevision payload → four-layer
 * supply registry expand (G1 / D-058). `validateDualRead` fails closed on
 * ID/field drift between the thin payload records and the expanded Supply*
 * entities; tests use it as the invariant that `expandCatalogRevisionPayload`
 * is faithful to its source.
 *
 * The migration-era `SupplyRegistryDualReadController` (backfill / active-source
 * switch / rollback) was removed 2026-08-12: the expand migration is closed and
 * the controller had no production callers.
 */
import type {
  SupplyDeployment,
  SupplyExecutionChannel,
  SupplyProviderProfile,
} from '@meiye/contracts';
import type {
  CatalogRevisionPayload,
  ExecutionChannelRevision,
  ProviderProfileRevision,
  PublishedDeployment,
} from '../model-supply/catalog.js';
import type { ExpandedSupplyRegistrySnapshot } from './expand.js';

export interface DualReadMismatch {
  entity:
    | 'provider_profile'
    | 'execution_channel'
    | 'deployment'
    | 'catalog_model';
  id: string;
  field: string;
  catalogValue: unknown;
  expandedValue: unknown;
}

export interface DualReadValidationResult {
  ok: boolean;
  mismatches: DualReadMismatch[];
  catalogCounts: {
    models: number;
    providerProfiles: number;
    executionChannels: number;
    deployments: number;
  };
  expandedCounts: {
    models: number;
    providerProfiles: number;
    executionChannels: number;
    deployments: number;
    contracts: number;
  };
}

function idsEqual(left: Iterable<string>, right: Iterable<string>): boolean {
  const a = new Set(left);
  const b = new Set(right);
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}

function pushMissing(
  mismatches: DualReadMismatch[],
  entity: DualReadMismatch['entity'],
  catalogIds: Set<string>,
  expandedIds: Set<string>,
): void {
  for (const id of catalogIds) {
    if (!expandedIds.has(id)) {
      mismatches.push({
        entity,
        id,
        field: 'presence',
        catalogValue: 'present',
        expandedValue: 'missing',
      });
    }
  }
  for (const id of expandedIds) {
    if (!catalogIds.has(id)) {
      mismatches.push({
        entity,
        id,
        field: 'presence',
        catalogValue: 'missing',
        expandedValue: 'present',
      });
    }
  }
}

function validateProviderProfile(
  revision: ProviderProfileRevision,
  expanded: SupplyProviderProfile | undefined,
  mismatches: DualReadMismatch[],
): void {
  if (!expanded) return;
  if (expanded.id !== revision.id) {
    mismatches.push({
      entity: 'provider_profile',
      id: revision.id,
      field: 'id',
      catalogValue: revision.id,
      expandedValue: expanded.id,
    });
  }
  if (expanded.counterparty !== revision.apiCounterparty) {
    mismatches.push({
      entity: 'provider_profile',
      id: revision.id,
      field: 'counterparty',
      catalogValue: revision.apiCounterparty,
      expandedValue: expanded.counterparty,
    });
  }
  const expectedRevisionId = `${revision.id}:r${revision.revision}`;
  if (expanded.revisionId !== expectedRevisionId) {
    mismatches.push({
      entity: 'provider_profile',
      id: revision.id,
      field: 'revisionId',
      catalogValue: expectedRevisionId,
      expandedValue: expanded.revisionId,
    });
  }
}

function validateExecutionChannel(
  revision: ExecutionChannelRevision,
  expanded: SupplyExecutionChannel | undefined,
  mismatches: DualReadMismatch[],
): void {
  if (!expanded) return;
  if (expanded.providerProfileId !== revision.providerProfileId) {
    mismatches.push({
      entity: 'execution_channel',
      id: revision.id,
      field: 'providerProfileId',
      catalogValue: revision.providerProfileId,
      expandedValue: expanded.providerProfileId,
    });
  }
  if (expanded.region !== revision.region) {
    mismatches.push({
      entity: 'execution_channel',
      id: revision.id,
      field: 'region',
      catalogValue: revision.region,
      expandedValue: expanded.region,
    });
  }
  if (expanded.accountOwnership !== revision.credentialOwner) {
    mismatches.push({
      entity: 'execution_channel',
      id: revision.id,
      field: 'accountOwnership',
      catalogValue: revision.credentialOwner,
      expandedValue: expanded.accountOwnership,
    });
  }
  const expectedKind =
    revision.channel === 'direct' ? 'official_direct' : 'upstream_reseller';
  if (expanded.kind !== expectedKind) {
    mismatches.push({
      entity: 'execution_channel',
      id: revision.id,
      field: 'kind',
      catalogValue: expectedKind,
      expandedValue: expanded.kind,
    });
  }
  const expectedRevisionId = `${revision.id}:r${revision.revision}`;
  if (expanded.revisionId !== expectedRevisionId) {
    mismatches.push({
      entity: 'execution_channel',
      id: revision.id,
      field: 'revisionId',
      catalogValue: expectedRevisionId,
      expandedValue: expanded.revisionId,
    });
  }
}

function expectedLifecycle(
  status: PublishedDeployment['status'],
): SupplyDeployment['lifecycleStatus'] {
  if (status === 'retired') return 'retired';
  if (status === 'active') return 'active';
  return 'inactive';
}

function validateDeployment(
  published: PublishedDeployment,
  expanded: SupplyDeployment | undefined,
  mismatches: DualReadMismatch[],
): void {
  if (!expanded) return;
  if (expanded.catalogModelId !== published.catalogModelId) {
    mismatches.push({
      entity: 'deployment',
      id: published.id,
      field: 'catalogModelId',
      catalogValue: published.catalogModelId,
      expandedValue: expanded.catalogModelId,
    });
  }
  if (expanded.providerProfileId !== (published.providerProfileId ?? '')) {
    mismatches.push({
      entity: 'deployment',
      id: published.id,
      field: 'providerProfileId',
      catalogValue: published.providerProfileId,
      expandedValue: expanded.providerProfileId,
    });
  }
  if (expanded.executionChannelId !== (published.executionChannelId ?? '')) {
    mismatches.push({
      entity: 'deployment',
      id: published.id,
      field: 'executionChannelId',
      catalogValue: published.executionChannelId,
      expandedValue: expanded.executionChannelId,
    });
  }
  const expected = expectedLifecycle(published.status);
  if (expanded.lifecycleStatus !== expected) {
    mismatches.push({
      entity: 'deployment',
      id: published.id,
      field: 'lifecycleStatus',
      catalogValue: expected,
      expandedValue: expanded.lifecycleStatus,
    });
  }
  const expectedRevisionId =
    published.lifecycleRevision ?? `${published.id}:lifecycle-missing`;
  if (expanded.revisionId !== expectedRevisionId) {
    mismatches.push({
      entity: 'deployment',
      id: published.id,
      field: 'revisionId',
      catalogValue: expectedRevisionId,
      expandedValue: expanded.revisionId,
    });
  }
  if (
    published.activationEvidence?.status !==
    expanded.activationEvidence?.status
  ) {
    mismatches.push({
      entity: 'deployment',
      id: published.id,
      field: 'activationEvidence.status',
      catalogValue: published.activationEvidence?.status,
      expandedValue: expanded.activationEvidence?.status,
    });
  }
}

/**
 * Compare catalog payload thin records against an expanded registry snapshot.
 * Returns mismatches (empty when dual-read is consistent).
 */
export function validateDualRead(
  payload: CatalogRevisionPayload,
  expanded: ExpandedSupplyRegistrySnapshot,
): DualReadValidationResult {
  const mismatches: DualReadMismatch[] = [];

  const catalogModelIds = new Set(payload.models.map((m) => m.id));
  const expandedModelIds = new Set(expanded.models.map((m) => m.id));
  pushMissing(mismatches, 'catalog_model', catalogModelIds, expandedModelIds);

  const catalogProfiles = payload.providerProfiles ?? [];
  const catalogProfileIds = new Set(catalogProfiles.map((p) => p.id));
  const expandedProfileIds = new Set(
    expanded.providerProfiles.map((p) => p.id),
  );
  pushMissing(
    mismatches,
    'provider_profile',
    catalogProfileIds,
    expandedProfileIds,
  );
  const expandedProfileById = new Map(
    expanded.providerProfiles.map((p) => [p.id, p]),
  );
  for (const revision of catalogProfiles) {
    validateProviderProfile(
      revision,
      expandedProfileById.get(revision.id),
      mismatches,
    );
  }

  const catalogChannels = payload.executionChannels ?? [];
  const catalogChannelIds = new Set(catalogChannels.map((c) => c.id));
  const expandedChannelIds = new Set(
    expanded.executionChannels.map((c) => c.id),
  );
  pushMissing(
    mismatches,
    'execution_channel',
    catalogChannelIds,
    expandedChannelIds,
  );
  const expandedChannelById = new Map(
    expanded.executionChannels.map((c) => [c.id, c]),
  );
  for (const revision of catalogChannels) {
    validateExecutionChannel(
      revision,
      expandedChannelById.get(revision.id),
      mismatches,
    );
  }

  const catalogDeploymentIds = new Set(payload.deployments.map((d) => d.id));
  const expandedDeploymentIds = new Set(expanded.deployments.map((d) => d.id));
  pushMissing(
    mismatches,
    'deployment',
    catalogDeploymentIds,
    expandedDeploymentIds,
  );
  const expandedDeploymentById = new Map(
    expanded.deployments.map((d) => [d.id, d]),
  );
  for (const published of payload.deployments) {
    validateDeployment(
      published,
      expandedDeploymentById.get(published.id),
      mismatches,
    );
  }

  // Contract set must cover every expanded provider profile (1:1).
  if (
    !idsEqual(
      expanded.providerProfiles.map((p) => p.id),
      expanded.contracts.map((c) => c.providerProfileId),
    )
  ) {
    mismatches.push({
      entity: 'provider_profile',
      id: '*',
      field: 'contracts.coverage',
      catalogValue: expanded.providerProfiles.map((p) => p.id).sort(),
      expandedValue: expanded.contracts.map((c) => c.providerProfileId).sort(),
    });
  }

  return {
    ok: mismatches.length === 0,
    mismatches,
    catalogCounts: {
      models: payload.models.length,
      providerProfiles: catalogProfiles.length,
      executionChannels: catalogChannels.length,
      deployments: payload.deployments.length,
    },
    expandedCounts: {
      models: expanded.models.length,
      providerProfiles: expanded.providerProfiles.length,
      executionChannels: expanded.executionChannels.length,
      deployments: expanded.deployments.length,
      contracts: expanded.contracts.length,
    },
  };
}
