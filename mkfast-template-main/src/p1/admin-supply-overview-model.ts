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
  faultDomainKey: string;
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
  'copy.generate': '文本',
  'image.generate': '图片',
  'video.generate': '视频',
};

const BLOCKING_HEALTH: ReadonlySet<HealthOverlayState> = new Set([
  'cooldown',
  'circuit_open',
  'unavailable',
]);

function isQualifiedDeployment(
  deployment: SupplyDeployment,
  healthByTarget: Map<string, HealthOverlayState>,
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
  providerProfileId: string,
  channelKind: string,
): string {
  return `${providerProfileId}::${channelKind}`;
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
    ? snapshot.models.find((m) => m.id === catalogModelId) ?? null
    : null;
  const healthByTarget = new Map(
    snapshot.healthOverlays.map((h) => [h.targetId, h.state]),
  );
  const channelById = new Map(
    snapshot.executionChannels.map((c) => [c.id, c]),
  );

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
      label: '未核验',
      note: '未配置核心 CatalogModel',
    };
  }

  const candidates = snapshot.deployments.filter(
    (d) => d.catalogModelId === catalogModelId,
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
      faultDomainKey: faultDomainKey(
        deployment.providerProfileId,
        channel.kind,
      ),
    });
  }

  const domainKeys = new Set(qualified.map((q) => q.faultDomainKey));
  const providers = new Set(qualified.map((q) => q.providerProfileId));
  const channelKinds = new Set(qualified.map((q) => q.channelKind));
  const manufacturers = new Set(
    qualified.map((q) => q.manufacturer ?? 'unknown'),
  );

  let faultDomainKind: FaultDomainKind | 'none' = 'none';
  if (domainKeys.size >= 2) {
    faultDomainKind =
      manufacturers.size >= 2
        ? 'independent_counterparty'
        : providers.size >= 2 || channelKinds.size >= 2
          ? 'independent_channel'
          : 'shared_manufacturer_only';
  }

  const multiChannelReady = domainKeys.size >= 2;
  const manufacturerIndependent = manufacturers.size >= 2 && multiChannelReady;

  let status: DualChannelCoverageStatus;
  let label: string;
  let note: string;

  if (qualified.length === 0) {
    status = candidates.length === 0 ? 'blocked' : 'not_verified';
    label = status === 'blocked' ? '无部署' : '未核验';
    note =
      status === 'blocked'
        ? '无可用 Deployment'
        : '无 live_verified 且健康的 Deployment';
  } else if (multiChannelReady) {
    status = 'multi_channel_ready';
    label = '双渠道就绪';
    note = manufacturerIndependent
      ? `独立故障域 ${domainKeys.size}（含制造商级独立）`
      : `渠道级容灾 ${domainKeys.size} 域（共享制造商，非制造商级双供应）`;
  } else {
    status = 'single_channel';
    label = '单渠道 / 无回退';
    note = '仅一条合格故障域；发布门不得标记 multi-channel ready';
  }

  return {
    operation,
    catalogModelId,
    catalogModelDisplayName: model.displayName,
    status,
    qualifiedDeployments: qualified,
    independentFaultDomainCount: domainKeys.size,
    faultDomainKind,
    multiChannelReady,
    manufacturerIndependent,
    label,
    note,
  };
}

export function projectOperationReadiness(
  operation: CoreSupplyOperation,
  snapshot: SupplyControlSnapshot,
): OperationReadinessProjection {
  const featuredId = snapshot.featuredCoreModelIds[operation] ?? null;
  const dualChannel = projectDualChannelCoverage({
    operation,
    catalogModelId: featuredId,
    snapshot,
  });
  const policy =
    snapshot.routePolicies.find(
      (p) => p.operation === operation && p.publishedAt,
    ) ?? snapshot.routePolicies.find((p) => p.operation === operation);
  const healthByTarget = new Map(
    snapshot.healthOverlays.map((h) => [h.targetId, h.state]),
  );
  const candidates = policy?.candidateDeploymentIds ?? [];
  const healthBlockingCount = candidates.filter((id) => {
    const state = healthByTarget.get(id);
    return state ? BLOCKING_HEALTH.has(state) : false;
  }).length;

  let status: OperationReadinessStatus;
  if (dualChannel.status === 'blocked') status = 'blocked';
  else if (dualChannel.status === 'not_verified') status = 'not_verified';
  else if (healthBlockingCount > 0 && dualChannel.independentFaultDomainCount < 2)
    status = 'degraded';
  else if (dualChannel.multiChannelReady) status = 'multi_channel_ready';
  else if (dualChannel.status === 'single_channel') status = 'single_channel';
  else status = 'degraded';

  const labelMap: Record<OperationReadinessStatus, string> = {
    multi_channel_ready: '双渠道就绪',
    single_channel: '单渠道',
    degraded: '降级',
    blocked: '阻塞',
    not_verified: '未核验',
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
  snapshot: SupplyControlSnapshot = buildDefaultSupplyControlSnapshot(),
): SupplyOverviewView {
  const operationReadiness = CORE_SUPPLY_OPERATIONS.map((op) =>
    projectOperationReadiness(op, snapshot),
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
          .map((r) => r.deploymentId),
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
    },
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
      snapshot.priceRevisions.map((p) => p.evidence.source).filter(Boolean),
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
            r.status === 'draining',
        )
        .map((r) => r.taskId),
    ),
  ];

  const blockingCount = snapshot.healthOverlays.filter((h) =>
    BLOCKING_HEALTH.has(h.state),
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
  status: OperationReadinessStatus,
): string {
  switch (status) {
    case 'multi_channel_ready':
      return '双渠道就绪';
    case 'single_channel':
      return '单渠道';
    case 'degraded':
      return '降级';
    case 'blocked':
      return '阻塞';
    case 'not_verified':
      return '未核验';
    default:
      return status;
  }
}
