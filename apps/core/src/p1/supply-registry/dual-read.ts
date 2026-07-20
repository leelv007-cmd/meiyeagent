/**
 * Dual-read migration validation + active-source switch/rollback for the
 * CatalogRevision payload → four-layer supply registry expand (G1 / D-058).
 *
 * Reads remain available against both:
 *  - catalog_payload: thin ProviderProfileRevision / ExecutionChannelRevision /
 *    PublishedDeployment records inside CatalogRevision
 *  - expanded_registry: expanded Supply* entities
 *
 * Switch flips which source is "active" for new reads; rollback restores the
 * previous source. Dual-read validation fails closed on ID/field drift.
 */
import type {
  SupplyDeployment,
  SupplyExecutionChannel,
  SupplyProviderProfile,
} from '@meiye/contracts';
import type {
  CatalogRevision,
  CatalogRevisionPayload,
  ExecutionChannelRevision,
  ProviderProfileRevision,
  PublishedDeployment,
} from '../model-supply/catalog.js';
import {
  expandCatalogRevisionPayload,
  type ExpandedSupplyRegistrySnapshot,
} from './expand.js';

export type SupplyRegistryReadSource =
  | 'catalog_payload'
  | 'expanded_registry';

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

export interface SupplyRegistryMigrationState {
  activeSource: SupplyRegistryReadSource;
  previousSource: SupplyRegistryReadSource | null;
  catalogRevisionId: string | null;
  expanded: ExpandedSupplyRegistrySnapshot | null;
  lastValidation: DualReadValidationResult | null;
  switchedAt: string | null;
}

/**
 * In-memory dual-read controller: expand from catalog, validate, switch,
 * rollback. Does not own catalog history — callers keep CatalogRevisionRegistry.
 */
export class SupplyRegistryDualReadController {
  private state: SupplyRegistryMigrationState = {
    activeSource: 'catalog_payload',
    previousSource: null,
    catalogRevisionId: null,
    expanded: null,
    lastValidation: null,
    switchedAt: null,
  };

  getState(): SupplyRegistryMigrationState {
    return structuredClone(this.state);
  }

  activeSource(): SupplyRegistryReadSource {
    return this.state.activeSource;
  }

  /**
   * Expand a catalog revision into the registry snapshot and dual-read validate.
   * Does not switch the active source.
   */
  backfillFromCatalogRevision(
    revision: CatalogRevision,
  ): DualReadValidationResult {
    const expanded = expandCatalogRevisionPayload(revision.payload, {
      catalogRevisionId: revision.id,
      catalogRevisionNumber: revision.number,
      effectiveFrom: revision.createdAt,
    });
    const validation = validateDualRead(revision.payload, expanded);
    this.state = {
      ...this.state,
      catalogRevisionId: revision.id,
      expanded,
      lastValidation: validation,
    };
    return validation;
  }

  /** Expand an arbitrary payload (tests / historical reads). */
  backfillFromPayload(
    payload: CatalogRevisionPayload,
    options: {
      catalogRevisionId?: string;
      catalogRevisionNumber?: number;
      effectiveFrom?: string;
    } = {},
  ): DualReadValidationResult {
    const expanded = expandCatalogRevisionPayload(payload, options);
    const validation = validateDualRead(payload, expanded);
    this.state = {
      ...this.state,
      catalogRevisionId: options.catalogRevisionId ?? null,
      expanded,
      lastValidation: validation,
    };
    return validation;
  }

  /**
   * Switch active read source. Requires a successful dual-read validation when
   * moving to expanded_registry.
   */
  switchTo(
    source: SupplyRegistryReadSource,
    now: () => Date = () => new Date(),
  ): SupplyRegistryMigrationState {
    if (source === this.state.activeSource) {
      return this.getState();
    }
    if (source === 'expanded_registry') {
      if (!this.state.expanded) {
        throw new Error(
          'Cannot switch to expanded_registry before backfillFromCatalogRevision.',
        );
      }
      if (!this.state.lastValidation?.ok) {
        throw new Error(
          'Cannot switch to expanded_registry while dual-read validation fails.',
        );
      }
    }
    this.state = {
      ...this.state,
      previousSource: this.state.activeSource,
      activeSource: source,
      switchedAt: now().toISOString(),
    };
    return this.getState();
  }

  /** Roll back to the previous active source (if any). */
  rollback(now: () => Date = () => new Date()): SupplyRegistryMigrationState {
    if (!this.state.previousSource) {
      throw new Error('No previous supply-registry source to roll back to.');
    }
    const restored = this.state.previousSource;
    this.state = {
      ...this.state,
      previousSource: this.state.activeSource,
      activeSource: restored,
      switchedAt: now().toISOString(),
    };
    return this.getState();
  }

  /**
   * Read provider profiles from the active source. History still available via
   * the original CatalogRevision when source is catalog_payload.
   */
  readProviderProfiles(
    payload: CatalogRevisionPayload,
  ): Array<ProviderProfileRevision | SupplyProviderProfile> {
    if (this.state.activeSource === 'expanded_registry' && this.state.expanded) {
      return structuredClone(this.state.expanded.providerProfiles);
    }
    return structuredClone(payload.providerProfiles ?? []);
  }

  readExecutionChannels(
    payload: CatalogRevisionPayload,
  ): Array<ExecutionChannelRevision | SupplyExecutionChannel> {
    if (this.state.activeSource === 'expanded_registry' && this.state.expanded) {
      return structuredClone(this.state.expanded.executionChannels);
    }
    return structuredClone(payload.executionChannels ?? []);
  }

  readDeployments(
    payload: CatalogRevisionPayload,
  ): Array<PublishedDeployment | SupplyDeployment> {
    if (this.state.activeSource === 'expanded_registry' && this.state.expanded) {
      return structuredClone(this.state.expanded.deployments);
    }
    return structuredClone(payload.deployments);
  }

  /** Always returns the expanded snapshot when backfilled (for views). */
  expandedSnapshot(): ExpandedSupplyRegistrySnapshot | null {
    return this.state.expanded
      ? structuredClone(this.state.expanded)
      : null;
  }
}
