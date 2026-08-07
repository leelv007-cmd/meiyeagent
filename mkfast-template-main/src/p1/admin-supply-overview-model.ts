/**
 * Supply control center overview projection (J4 / D-070 · D-069).
 *
 * Pure: tri-modal operation readiness, dual-channel coverage, six-entity
 * relations, Pool/RoutePolicy effective revisions, data class / health /
 * capacity / balance / quota / cost, sync+async lifecycle, affected
 * accounts/tasks, recent changes + unified audit. External gateway Console
 * is deep-link only (never second source of truth).
 */
import type {
  HealthOverlayState,
  SupplyDataClass,
  SupplyDeployment,
  SupplyOperation,
} from '@meiye/contracts';

import { buildDefaultSupplyControlSnapshot } from './admin-supply-fixture';
import {
  CORE_SUPPLY_OPERATIONS,
  type CoreSupplyOperation,
  type DualChannelCoverageStatus,
  type FaultDomainKind,
  type OperationReadinessStatus,
  type SupplyControlSnapshot,
  type SupplyGatewayDeepLink,
  type SupplyRunRecord,
} from './admin-supply-types';
import {
  admin_capability_blocked_a00db105,
  admin_capability_degraded_d8518883,
  admin_capability_not_verified_0800371a,
  admin_creation_video_fa4e33b6,
  admin_plan_reference_image_be8da62e,
  admin_supply_channel_resilience_domains,
  admin_supply_core_catalogmodel_not_configured_bb8d400d,
  admin_supply_dual_channel_ready_b194fa4d,
  admin_supply_independent_fault_domains,
  admin_supply_missing_official_direct_or_upstream_rela_c6e5ad69,
  admin_supply_missing_stable_account_or_endpoint_ident_3b5e8292,
  admin_supply_no_available_deployment_1438a7dd,
  admin_supply_no_deployments_e5bf9daa,
  admin_supply_no_live_verified_healthy_deployment_22dfb0b5,
  admin_supply_only_one_qualifying_failure_domain_publi_5f363d37,
  admin_supply_single_channel_0ff813d8,
  admin_supply_single_channel_no_fallback_7d020774,
  admin_supply_text_f1926e9b,
} from '@/locale/paraglide/messages';

export interface QualifiedDeploymentProjection {
  deploymentId: string;
  catalogModelId: string;
  providerProfileId: string;
  executionChannelId: string;
  channelKind: string;
  manufacturer?: string;
  lifecycleStatus: SupplyDeployment['lifecycleStatus'];
  activationStatus: string;
  healthState: HealthOverlayState | 'healthy';
  accountIdentity?: string;
  endpointFingerprint?: string;
  faultDomainKey: string | null;
}

export interface DualChannelCoverageProjection {
  operation: CoreSupplyOperation;
  catalogModelId: string | null;
  catalogModelDisplayName: string | null;
  status: DualChannelCoverageStatus;
  qualifiedDeployments: QualifiedDeploymentProjection[];
  independentFaultDomainCount: number;
  faultDomainKind: FaultDomainKind | 'none';
  /** True only when ≥2 independent counterparty/channel domains. */
  multiChannelReady: boolean;
  /** Manufacturer-level independence (stricter than channel-level). */
  manufacturerIndependent: boolean;
  label: string;
  note: string;
}

export interface OperationReadinessProjection {
  operation: CoreSupplyOperation;
  modalityLabel: string;
  status: OperationReadinessStatus;
  dualChannel: DualChannelCoverageProjection;
  publishedRoutePolicyRevisionId: string | null;
  candidateCount: number;
  healthBlockingCount: number;
  label: string;
}

export interface SixEntityRelationCounts {
  catalogModels: number;
  providerProfiles: number;
  supplyContracts: number;
  credentialAccounts: number;
  executionChannels: number;
  deployments: number;
}

export interface EffectiveRevisionProjection {
  kind: 'pool' | 'route_policy';
  id: string;
  displayName: string;
  revisionId: string;
  publishedAt?: string;
  operation?: SupplyOperation;
}

export interface DataClassCoverageRow {
  dataClass: SupplyDataClass;
  deploymentCount: number;
  singleChannelOnly: boolean;
}

export interface CapacityBalanceView {
  poolId: string;
  displayName: string;
  kind: string;
  revisionId: string;
  rpm?: number;
  tpm?: number;
  supplyConcurrency?: number;
  productConcurrency?: number;
  systemConcurrency?: number;
  balanceHeadroom?: number | 'unknown';
  quotaHint: string;
}

export interface CostSummaryView {
  knownRunCostMicros: number;
  currencyMix: string[];
  unknownCostRunCount: number;
  priceEvidenceSources: string[];
}

export interface LifecycleSummaryView {
  syncAttempts: number;
  asyncSubmit: number;
  asyncPoll: number;
  asyncRecover: number;
  terminal: number;
}

export interface AffectedSurfaceView {
  accountIds: string[];
  workspaceIds: string[];
  taskIds: string[];
  openFailureTaskIds: string[];
}

export interface SupplyOverviewView {
  capturedAt: string;
  catalogRevisionId: string;
  catalogRevisionNumber: number;
  operationReadiness: OperationReadinessProjection[];
  dualChannelCoverage: DualChannelCoverageProjection[];
  sixEntityRelations: SixEntityRelationCounts;
  effectiveRevisions: EffectiveRevisionProjection[];
  dataClassCoverage: DataClassCoverageRow[];
  health: {
    overlays: Array<{
      targetId: string;
      state: HealthOverlayState;
      reason: string;
      endsAt?: string;
    }>;
    blockingCount: number;
  };
  capacity: CapacityBalanceView[];
  cost: CostSummaryView;
  lifecycle: LifecycleSummaryView;
  affected: AffectedSurfaceView;
  recentChanges: SupplyControlSnapshot['recentChanges'];
  gatewayDeepLinks: SupplyGatewayDeepLink[];
  /** Always true — external console is evidence deep-link only. */
  externalGatewayIsDeepLinkOnly: true;
}

const MODALITY_LABEL: Record<CoreSupplyOperation, string> = {
  'copy.generate': admin_supply_text_f1926e9b(),
  'image.generate': admin_plan_reference_image_be8da62e(),
  'video.generate': admin_creation_video_fa4e33b6(),
};

const BLOCKING_HEALTH: ReadonlySet<HealthOverlayState> = new Set([
  'cooldown',
  'circuit_open',
  'unavailable',
]);

function isQualifiedDeployment(
  deployment: SupplyDeployment,
  healthByTarget: Map<string, HealthOverlayState>
): boolean {
  if (deployment.lifecycleStatus !== 'active') return false;
  if (deployment.activationEvidence?.status !== 'live_verified') return false;
  const health =
    healthByTarget.get(deployment.id) ??
    healthByTarget.get(deployment.executionChannelId);
  if (health && BLOCKING_HEALTH.has(health)) return false;
  return true;
}

function faultDomainKey(
  accountIdentity: string | undefined,
  endpointFingerprint: string | undefined
): string | null {
  const account = accountIdentity?.trim();
  const endpoint = endpointFingerprint?.trim();
  return account && endpoint ? `${account}::${endpoint}` : null;
}

/**
 * Project dual-channel coverage for one CatalogModel (D-069).
 * Dual-channel requires ≥2 independent fault domains (counterparty or channel).
 * Same-manufacturer multi-channel is still channel-level, not manufacturer-level.
 */
export function projectDualChannelCoverage(input: {
  operation: CoreSupplyOperation;
  catalogModelId: string | null;
  snapshot: SupplyControlSnapshot;
}): DualChannelCoverageProjection {
  const { operation, catalogModelId, snapshot } = input;
  const model = catalogModelId
    ? (snapshot.models.find((m) => m.id === catalogModelId) ?? null)
    : null;
  const healthByTarget = new Map(
    snapshot.healthOverlays.map((h) => [h.targetId, h.state])
  );
  const channelById = new Map(snapshot.executionChannels.map((c) => [c.id, c]));

  if (!catalogModelId || !model) {
    return {
      operation,
      catalogModelId: null,
      catalogModelDisplayName: null,
      status: 'not_verified',
      qualifiedDeployments: [],
      independentFaultDomainCount: 0,
      faultDomainKind: 'none',
      multiChannelReady: false,
      manufacturerIndependent: false,
      label: admin_capability_not_verified_0800371a(),
      note: admin_supply_core_catalogmodel_not_configured_bb8d400d(),
    };
  }

  const candidates = snapshot.deployments.filter(
    (d) => d.catalogModelId === catalogModelId
  );
  const qualified: QualifiedDeploymentProjection[] = [];
  for (const deployment of candidates) {
    const channel = channelById.get(deployment.executionChannelId);
    if (!channel) continue;
    if (!isQualifiedDeployment(deployment, healthByTarget)) continue;
    qualified.push({
      deploymentId: deployment.id,
      catalogModelId: deployment.catalogModelId,
      providerProfileId: deployment.providerProfileId,
      executionChannelId: deployment.executionChannelId,
      channelKind: channel.kind,
      manufacturer: model.manufacturer,
      lifecycleStatus: deployment.lifecycleStatus,
      activationStatus: deployment.activationEvidence?.status ?? 'none',
      healthState: healthByTarget.get(deployment.id) ?? 'healthy',
      accountIdentity: deployment.accountIdentity,
      endpointFingerprint: deployment.endpointFingerprint,
      faultDomainKey: faultDomainKey(
        deployment.accountIdentity,
        deployment.endpointFingerprint
      ),
    });
  }

  const identityVerified = qualified.filter(
    (
      deployment
    ): deployment is QualifiedDeploymentProjection & {
      faultDomainKey: string;
    } => deployment.faultDomainKey !== null
  );
  const domainKeys = new Set(
    identityVerified.map((deployment) => deployment.faultDomainKey)
  );
  const accountIdentities = new Set(
    identityVerified.map((deployment) => deployment.accountIdentity!.trim())
  );
  const endpointIdentities = new Set(
    identityVerified.map((deployment) => deployment.endpointFingerprint!.trim())
  );
  const independentFaultDomainCount = Math.min(
    domainKeys.size,
    accountIdentities.size,
    endpointIdentities.size
  );
  const providers = new Set(qualified.map((q) => q.providerProfileId));
  const channelKinds = new Set(
    identityVerified.map((deployment) => deployment.channelKind)
  );
  const manufacturers = new Set(
    qualified.map((q) => q.manufacturer ?? 'unknown')
  );

  let faultDomainKind: FaultDomainKind | 'none' = 'none';
  if (independentFaultDomainCount >= 2) {
    faultDomainKind =
      manufacturers.size >= 2
        ? 'independent_counterparty'
        : providers.size >= 2 || channelKinds.size >= 2
          ? 'independent_channel'
          : 'shared_manufacturer_only';
  }

  const multiChannelReady =
    independentFaultDomainCount >= 2 &&
    channelKinds.has('official_direct') &&
    channelKinds.has('upstream_reseller');
  const manufacturerIndependent = manufacturers.size >= 2 && multiChannelReady;

  let status: DualChannelCoverageStatus;
  let label: string;
  let note: string;

  if (qualified.length === 0) {
    status = candidates.length === 0 ? 'blocked' : 'not_verified';
    label =
      status === 'blocked'
        ? admin_supply_no_deployments_e5bf9daa()
        : admin_capability_not_verified_0800371a();
    note =
      status === 'blocked'
        ? admin_supply_no_available_deployment_1438a7dd()
        : admin_supply_no_live_verified_healthy_deployment_22dfb0b5();
  } else if (multiChannelReady) {
    status = 'multi_channel_ready';
    label = admin_supply_dual_channel_ready_b194fa4d();
    note = manufacturerIndependent
      ? admin_supply_independent_fault_domains({
          count: independentFaultDomainCount,
        })
      : admin_supply_channel_resilience_domains({
          count: independentFaultDomainCount,
        });
  } else {
    status = 'single_channel';
    label = admin_supply_single_channel_no_fallback_7d020774();
    note =
      identityVerified.length < qualified.length
        ? admin_supply_missing_stable_account_or_endpoint_ident_3b5e8292()
        : independentFaultDomainCount < 2
          ? admin_supply_only_one_qualifying_failure_domain_publi_5f363d37()
          : admin_supply_missing_official_direct_or_upstream_rela_c6e5ad69();
  }

  return {
    operation,
    catalogModelId,
    catalogModelDisplayName: model.displayName,
    status,
    qualifiedDeployments: qualified,
    independentFaultDomainCount,
    faultDomainKind,
    multiChannelReady,
    manufacturerIndependent,
    label,
    note,
  };
}

export function projectOperationReadiness(
  operation: CoreSupplyOperation,
  snapshot: SupplyControlSnapshot
): OperationReadinessProjection {
  const featuredId = snapshot.featuredCoreModelIds[operation] ?? null;
  const dualChannel = projectDualChannelCoverage({
    operation,
    catalogModelId: featuredId,
    snapshot,
  });
  const policy =
    snapshot.routePolicies.find(
      (p) => p.operation === operation && p.publishedAt
    ) ?? snapshot.routePolicies.find((p) => p.operation === operation);
  const healthByTarget = new Map(
    snapshot.healthOverlays.map((h) => [h.targetId, h.state])
  );
  const candidates = policy?.candidateDeploymentIds ?? [];
  const healthBlockingCount = candidates.filter((id) => {
    const state = healthByTarget.get(id);
    return state ? BLOCKING_HEALTH.has(state) : false;
  }).length;

  let status: OperationReadinessStatus;
  if (dualChannel.status === 'blocked') status = 'blocked';
  else if (dualChannel.status === 'not_verified') status = 'not_verified';
  else if (
    healthBlockingCount > 0 &&
    dualChannel.independentFaultDomainCount < 2
  )
    status = 'degraded';
  else if (dualChannel.multiChannelReady) status = 'multi_channel_ready';
  else if (dualChannel.status === 'single_channel') status = 'single_channel';
  else status = 'degraded';

  const labelMap: Record<OperationReadinessStatus, string> = {
    multi_channel_ready: admin_supply_dual_channel_ready_b194fa4d(),
    single_channel: admin_supply_single_channel_0ff813d8(),
    degraded: admin_capability_degraded_d8518883(),
    blocked: admin_capability_blocked_a00db105(),
    not_verified: admin_capability_not_verified_0800371a(),
  };

  return {
    operation,
    modalityLabel: MODALITY_LABEL[operation],
    status,
    dualChannel,
    publishedRoutePolicyRevisionId: policy?.revisionId ?? null,
    candidateCount: candidates.length,
    healthBlockingCount,
    label: labelMap[status],
  };
}

function projectLifecycle(runs: SupplyRunRecord[]): LifecycleSummaryView {
  const counts: LifecycleSummaryView = {
    syncAttempts: 0,
    asyncSubmit: 0,
    asyncPoll: 0,
    asyncRecover: 0,
    terminal: 0,
  };
  for (const run of runs) {
    switch (run.lifecycle) {
      case 'sync_attempt':
        counts.syncAttempts += 1;
        break;
      case 'async_submit':
        counts.asyncSubmit += 1;
        break;
      case 'async_poll':
        counts.asyncPoll += 1;
        break;
      case 'async_recover':
        counts.asyncRecover += 1;
        break;
      case 'terminal':
        counts.terminal += 1;
        break;
    }
  }
  return counts;
}

/** Build full overview projection from a supply control snapshot. */
export function buildSupplyOverviewView(
  snapshot: SupplyControlSnapshot = buildDefaultSupplyControlSnapshot()
): SupplyOverviewView {
  const operationReadiness = CORE_SUPPLY_OPERATIONS.map((op) =>
    projectOperationReadiness(op, snapshot)
  );
  const dualChannelCoverage = operationReadiness.map((row) => row.dualChannel);

  const sixEntityRelations: SixEntityRelationCounts = {
    catalogModels: snapshot.models.length,
    providerProfiles: snapshot.providerProfiles.length,
    supplyContracts: snapshot.contracts.length,
    credentialAccounts: snapshot.credentials.length,
    executionChannels: snapshot.executionChannels.length,
    deployments: snapshot.deployments.length,
  };

  const effectiveRevisions: EffectiveRevisionProjection[] = [
    ...snapshot.pools.map((pool) => ({
      kind: 'pool' as const,
      id: pool.id,
      displayName: pool.displayName,
      revisionId: pool.revisionId,
    })),
    ...snapshot.routePolicies
      .filter((p) => p.publishedAt)
      .map((p) => ({
        kind: 'route_policy' as const,
        id: p.id,
        displayName: p.operation,
        revisionId: p.revisionId,
        publishedAt: p.publishedAt,
        operation: p.operation,
      })),
  ];

  const dataClassSet = new Set<SupplyDataClass>();
  for (const run of snapshot.runs) dataClassSet.add(run.dataClass);
  // Always surface the restricted classes even if no runs yet.
  for (const dc of [
    'public',
    'contains_face',
    'pii',
    'medical',
    'medical-health',
  ] as const) {
    dataClassSet.add(dc);
  }

  const dataClassCoverage: DataClassCoverageRow[] = [...dataClassSet].map(
    (dataClass) => {
      const runDeps = new Set(
        snapshot.runs
          .filter((r) => r.dataClass === dataClass)
          .map((r) => r.deploymentId)
      );
      const deploymentCount =
        runDeps.size > 0
          ? runDeps.size
          : dataClass === 'public'
            ? snapshot.deployments.length
            : 0;
      return {
        dataClass,
        deploymentCount,
        singleChannelOnly: deploymentCount === 1,
      };
    }
  );

  const capacity: CapacityBalanceView[] = snapshot.pools.map((pool) => {
    const hints = snapshot.credentials
      .filter((c) => pool.credentialAccountIds.includes(c.id))
      .map((c) => c.publicQuotaHint)
      .filter(Boolean);
    return {
      poolId: pool.id,
      displayName: pool.displayName,
      kind: pool.kind,
      revisionId: pool.revisionId,
      rpm: pool.capacity?.supplyAccount?.rpm,
      tpm: pool.capacity?.supplyAccount?.tpm,
      supplyConcurrency: pool.capacity?.supplyAccount?.concurrency,
      productConcurrency: pool.capacity?.productAccount?.concurrency,
      systemConcurrency: pool.capacity?.systemTotal?.concurrency,
      balanceHeadroom:
        pool.capacity?.supplyAccount?.balanceHeadroom ?? 'unknown',
      quotaHint: hints[0] ?? 'unknown (quota_not_instrumented)',
    };
  });

  let knownRunCostMicros = 0;
  let unknownCostRunCount = 0;
  const currencyMix = new Set<string>();
  for (const run of snapshot.runs) {
    if (typeof run.costMicros === 'number') {
      knownRunCostMicros += run.costMicros;
      if (run.currency) currencyMix.add(run.currency);
    } else {
      unknownCostRunCount += 1;
    }
  }
  const priceEvidenceSources = [
    ...new Set(
      snapshot.priceRevisions.map((p) => p.evidence.source).filter(Boolean)
    ),
  ];

  const accountIds = [...new Set(snapshot.runs.map((r) => r.accountId))];
  const workspaceIds = [...new Set(snapshot.runs.map((r) => r.workspaceId))];
  const taskIds = [...new Set(snapshot.runs.map((r) => r.taskId))];
  const openFailureTaskIds = [
    ...new Set(
      snapshot.runs
        .filter(
          (r) =>
            r.status === 'failed' ||
            r.status === 'acceptance_unknown' ||
            r.status === 'draining'
        )
        .map((r) => r.taskId)
    ),
  ];

  const blockingCount = snapshot.healthOverlays.filter((h) =>
    BLOCKING_HEALTH.has(h.state)
  ).length;

  return {
    capturedAt: snapshot.capturedAt,
    catalogRevisionId: snapshot.catalogRevisionId,
    catalogRevisionNumber: snapshot.catalogRevisionNumber,
    operationReadiness,
    dualChannelCoverage,
    sixEntityRelations,
    effectiveRevisions,
    dataClassCoverage,
    health: {
      overlays: snapshot.healthOverlays.map((h) => ({
        targetId: h.targetId,
        state: h.state,
        reason: h.reason,
        endsAt: h.endsAt,
      })),
      blockingCount,
    },
    capacity,
    cost: {
      knownRunCostMicros,
      currencyMix: [...currencyMix],
      unknownCostRunCount,
      priceEvidenceSources,
    },
    lifecycle: projectLifecycle(snapshot.runs),
    affected: {
      accountIds,
      workspaceIds,
      taskIds,
      openFailureTaskIds,
    },
    recentChanges: snapshot.recentChanges,
    gatewayDeepLinks: snapshot.gatewayDeepLinks.map((link) => ({
      ...link,
      evidenceOnly: true as const,
    })),
    externalGatewayIsDeepLinkOnly: true,
  };
}

export function operationReadinessLabel(
  status: OperationReadinessStatus
): string {
  switch (status) {
    case 'multi_channel_ready':
      return admin_supply_dual_channel_ready_b194fa4d();
    case 'single_channel':
      return admin_supply_single_channel_0ff813d8();
    case 'degraded':
      return admin_capability_degraded_d8518883();
    case 'blocked':
      return admin_capability_blocked_a00db105();
    case 'not_verified':
      return admin_capability_not_verified_0800371a();
    default:
      return status;
  }
}
