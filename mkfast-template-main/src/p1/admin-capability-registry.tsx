import type {
  CapabilityAvailabilityStatus,
  CapabilityRegistryEntry,
  OperationalMetricEnvelope,
  SupplyOperation,
} from '@meiye/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { CapabilityRegistryPanel } from '@/components/admin/capability/capability-registry-panel';
import {
  buildCapabilityRegistry,
  projectSixQuestionCompleteness,
  type CapabilityRegistryView,
} from '@/p1/admin-capability-registry-model';
import {
  normalizeOperationalMetrics,
  type OperationalMetricView,
  type OperationalMetricsView,
} from '@/p1/admin-operations-health';
import type {
  SupplyControlSnapshot,
  SupplyRunRecord,
} from '@/p1/admin-supply-types';
import { queryP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import { useAdminSupplyControlSnapshot } from '@/p1/use-admin-supply-control';

export const adminOperationalMetricsQueryKey = p1QueryKeys.request(
  'job-runtime',
  'observability'
);

export function readAdminOperationalMetrics(signal?: AbortSignal) {
  return queryP1<unknown>(
    'job-runtime',
    { action: 'observability', payload: {} },
    signal
  );
}

function unknownMetric(reason: string): OperationalMetricEnvelope<number> {
  return { status: 'unknown', reason };
}

function metricValue<T>(metric: OperationalMetricView<T>): string {
  return metric.status === 'known'
    ? String(metric.value)
    : `unknown (${metric.reason})`;
}

function sumOutcomes(
  metric: OperationalMetricsView['runner']['outcomeCounts']
): OperationalMetricEnvelope<number> {
  if (metric.status === 'unknown') return metric;
  return {
    status: 'known',
    value: Object.values(metric.value).reduce((sum, value) => sum + value, 0),
    ...(metric.scope ? { scope: metric.scope } : {}),
  };
}

function successRate(
  metric: OperationalMetricsView['runner']['outcomeCounts']
): OperationalMetricEnvelope<number> {
  if (metric.status === 'unknown') return metric;
  const total = Object.values(metric.value).reduce(
    (sum, value) => sum + value,
    0
  );
  if (total === 0) {
    return unknownMetric('no_runner_events_in_window');
  }
  return {
    status: 'known',
    value: metric.value.completed / total,
    ...(metric.scope ? { scope: metric.scope } : {}),
  };
}

function failureCount(
  metric: OperationalMetricsView['runner']['failuresByKind']
): number | undefined {
  if (metric.status === 'unknown') return undefined;
  return Object.values(metric.value).reduce((sum, value) => sum + value, 0);
}

function replaceRegistryEntry(
  view: CapabilityRegistryView,
  entry: CapabilityRegistryEntry
): CapabilityRegistryView {
  return {
    ...view,
    entries: view.entries.map((candidate) =>
      candidate.id === entry.id ? entry : candidate
    ),
    projections: view.projections.map((projection) =>
      projection.capabilityId === entry.id
        ? projectSixQuestionCompleteness(entry, projection.name)
        : projection
    ),
  };
}

/**
 * Project the existing Core OperationalMetric response onto J1's registry.
 * Invalid/missing evidence remains unknown; a failed read marks the evidence
 * stale instead of preserving the skeleton's apparent snapshot as current.
 */
export function projectOperationalMetricsCapabilityRegistry(
  value: unknown,
  state: { failed?: boolean } = {}
): CapabilityRegistryView {
  const view = buildCapabilityRegistry();
  const current = view.entries.find(
    (entry) => entry.id === 'job_queue_harness'
  );
  if (!current) return view;

  const metrics = normalizeOperationalMetrics(value);
  if (!metrics) {
    const reason = state.failed
      ? 'operational_metrics_query_failed'
      : 'operational_metrics_loading';
    return replaceRegistryEntry(view, {
      ...current,
      availability: state.failed ? 'stale' : 'not_verified',
      runtimeFacts: {
        calls: unknownMetric(reason),
        successRate: unknownMetric(reason),
        p95LatencyMs: unknownMetric(reason),
        note: `Core OperationalMetric ${reason}; no synthetic zero or green status.`,
      },
      evidenceFreshness: {
        capturedAt: current.evidenceFreshness?.capturedAt,
        staleAfterMs: current.evidenceFreshness?.staleAfterMs,
        source: reason,
      },
    });
  }

  const failures = failureCount(metrics.runner.failuresByKind);
  return replaceRegistryEntry(view, {
    ...current,
    availability: state.failed
      ? 'stale'
      : failures !== undefined && failures > 0
        ? 'attention'
        : 'not_verified',
    runtimeFacts: {
      calls: sumOutcomes(metrics.runner.outcomeCounts),
      successRate: successRate(metrics.runner.outcomeCounts),
      p95LatencyMs: unknownMetric('p95_not_reported_average_only'),
      note: [
        state.failed
          ? 'OperationalMetric refresh failed; showing stale retained evidence.'
          : null,
        `queueDepth=${metricValue(metrics.queue.queueDepth)}`,
        `averageClaimLatencyMs=${metricValue(
          metrics.queue.averageClaimLatencyMs
        )}`,
        `failuresByKind=${metricValue(metrics.runner.failuresByKind)}`,
        'Availability remains not_verified unless an explicit domain availability contract reports it.',
      ]
        .filter(Boolean)
        .join(' · '),
    },
    recentEvidenceRefs: [
      {
        kind: 'audit',
        ref: 'job-runtime.operational-metrics.live',
        at: metrics.capturedAt,
      },
    ],
    evidenceFreshness: {
      capturedAt: metrics.capturedAt,
      source: state.failed
        ? 'operational_metrics_refresh_failed_using_stale_data'
        : 'live_job_runtime_operational_metrics',
      staleAfterMs: 5 * 60 * 1000,
    },
  });
}

const MODEL_SUPPLY_OPERATIONS: Record<string, readonly SupplyOperation[]> = {
  generation_copy: ['copy.generate', 'copy.adapt', 'text.respond'],
  generation_image: ['image.generate', 'image.edit'],
  generation_video: ['video.generate'],
  model_supply_routing_quality: [
    'copy.generate',
    'copy.adapt',
    'text.respond',
    'image.generate',
    'image.edit',
    'video.generate',
  ],
};

function p95Latency(
  runs: SupplyRunRecord[]
): OperationalMetricEnvelope<number> {
  const samples = runs
    .map((run) => run.latencyMs)
    .filter((value): value is number => typeof value === 'number')
    .sort((left, right) => left - right);
  if (samples.length === 0) {
    return unknownMetric('supply_run_latency_not_reported');
  }
  return {
    status: 'known',
    value: samples[Math.ceil(samples.length * 0.95) - 1],
    scope: 'admin_supply_control.runs',
  };
}

function supplyRunCost(
  runs: SupplyRunRecord[]
): OperationalMetricEnvelope<number> {
  if (runs.length === 0) {
    return unknownMetric('no_supply_runs_in_snapshot');
  }
  if (runs.some((run) => typeof run.costMicros !== 'number')) {
    return unknownMetric('supply_run_cost_evidence_incomplete');
  }
  return {
    status: 'known',
    value: runs.reduce((sum, run) => sum + (run.costMicros ?? 0), 0),
    scope: 'admin_supply_control.runs',
  };
}

function modelSupplyAvailability(
  snapshot: SupplyControlSnapshot,
  operations: readonly SupplyOperation[]
): CapabilityAvailabilityStatus {
  const modelIds = new Set(
    snapshot.models
      .filter((model) =>
        model.operations.some((operation) => operations.includes(operation))
      )
      .map((model) => model.id)
  );
  const deployments = snapshot.deployments.filter(
    (deployment) =>
      modelIds.has(deployment.catalogModelId) &&
      deployment.lifecycleStatus === 'active'
  );
  if (deployments.length === 0) return 'blocked';
  const publishedOperations = new Set(
    snapshot.routePolicies
      .filter((policy) => typeof policy.publishedAt === 'string')
      .map((policy) => policy.operation)
  );
  if (operations.some((operation) => !publishedOperations.has(operation))) {
    return 'not_verified';
  }

  const overlayStates = new Set(
    snapshot.healthOverlays
      .filter((overlay) =>
        deployments.some((deployment) => deployment.id === overlay.targetId)
      )
      .map((overlay) => overlay.state)
  );
  if (overlayStates.has('unavailable') || overlayStates.has('circuit_open')) {
    return 'degraded';
  }
  if (overlayStates.has('degraded') || overlayStates.has('cooldown')) {
    return 'attention';
  }
  return deployments.every(
    (deployment) => deployment.activationEvidence?.status === 'live_verified'
  )
    ? 'available'
    : 'not_verified';
}

function projectModelSupplyEntry(
  current: CapabilityRegistryEntry,
  snapshot: SupplyControlSnapshot,
  operations: readonly SupplyOperation[]
): CapabilityRegistryEntry {
  const runs = snapshot.runs.filter((run) =>
    operations.includes(run.operation)
  );
  const succeeded = runs.filter((run) => run.status === 'succeeded').length;
  const scope = operations.join(',');
  return {
    ...current,
    availability: modelSupplyAvailability(snapshot, operations),
    config: {
      revisionId: snapshot.catalogRevisionId,
      effectiveScope: scope,
    },
    runtimeFacts: {
      calls: {
        status: 'known',
        value: runs.length,
        scope: 'admin_supply_control.runs',
      },
      successRate:
        runs.length > 0
          ? {
              status: 'known',
              value: succeeded / runs.length,
              scope: 'admin_supply_control.runs',
            }
          : unknownMetric('no_supply_runs_in_snapshot'),
      p95LatencyMs: p95Latency(runs),
      costMicros: supplyRunCost(runs),
      note: `Core supply snapshot: models=${snapshot.models.length} · deployments=${snapshot.deployments.length} · runs=${runs.length}.`,
    },
    recentEvidenceRefs: [
      {
        kind: 'audit',
        ref: `model-supply.catalog:${snapshot.catalogRevisionId}`,
        at: snapshot.capturedAt,
      },
      ...snapshot.recentChanges.slice(0, 4).map((change) => ({
        kind: 'change' as const,
        ref: `${change.action}:${change.targetId}`,
        at: change.at,
      })),
    ],
    evidenceFreshness: {
      capturedAt: snapshot.capturedAt,
      source: 'live_model_supply_snapshot',
      staleAfterMs: 5 * 60 * 1000,
    },
  };
}

function projectEntitlementPoolEntry(
  current: CapabilityRegistryEntry,
  snapshot: SupplyControlSnapshot
): CapabilityRegistryEntry {
  const publishedPolicies = snapshot.entitlementPolicies.filter(
    (policy) => policy.stage === 'published'
  );
  const activeAllocations = snapshot.accountAllocations.filter(
    (allocation) => allocation.status === 'active'
  );
  const headrooms = snapshot.pools.map(
    (pool) => pool.capacity?.supplyAccount?.concurrency
  );
  const supplyConcurrency =
    headrooms.length > 0 &&
    headrooms.every((value): value is number => typeof value === 'number')
      ? String(headrooms.reduce((sum, value) => sum + value, 0))
      : 'unknown (supply_pool_capacity_incomplete)';

  return {
    ...current,
    availability:
      publishedPolicies.length > 0 && activeAllocations.length > 0
        ? 'available'
        : 'not_verified',
    config: {
      revisionId:
        [
          ...snapshot.entitlementPolicies.map((policy) => policy.revisionId),
          ...snapshot.pools.map((pool) => pool.revisionId),
        ].join(',') || 'unknown (entitlement_and_supply_revision_absent)',
      effectiveScope: 'entitlement-policies,account-allocations,supply-pools',
    },
    runtimeFacts: {
      entitlementHeadroom: unknownMetric('usage_ledger_not_in_supply_snapshot'),
      calls: unknownMetric('usage_ledger_not_in_supply_snapshot'),
      costMicros: unknownMetric('product_usage_cost_not_in_supply_snapshot'),
      note: `Supply pools=${snapshot.pools.length}; supply concurrency=${supplyConcurrency}; entitlement policies=${snapshot.entitlementPolicies.length} (published=${publishedPolicies.length}); account allocations=${snapshot.accountAllocations.length} (active=${activeAllocations.length}).`,
    },
    recentEvidenceRefs:
      snapshot.entitlementPolicies.length ||
      snapshot.accountAllocations.length ||
      snapshot.pools.length
        ? [
            ...snapshot.entitlementPolicies.map((policy) => ({
              kind: 'change' as const,
              ref: policy.revisionId,
              at: policy.publishedAt ?? snapshot.capturedAt,
            })),
            ...snapshot.accountAllocations.map((allocation) => ({
              kind: 'change' as const,
              ref: allocation.id,
              at: allocation.startsAt,
            })),
            ...snapshot.pools.map((pool) => ({
              kind: 'audit' as const,
              ref: `supply-pool:${pool.revisionId}`,
              at: snapshot.capturedAt,
            })),
          ]
        : [
            {
              kind: 'audit',
              ref: `model-supply.catalog:${snapshot.catalogRevisionId}`,
              at: snapshot.capturedAt,
            },
          ],
    evidenceFreshness: {
      capturedAt: snapshot.capturedAt,
      source: 'live_entitlement_supply_snapshot',
      staleAfterMs: 5 * 60 * 1000,
    },
  };
}

function markSupplySnapshotRefreshStale(
  entry: CapabilityRegistryEntry
): CapabilityRegistryEntry {
  return {
    ...entry,
    availability: 'stale',
    runtimeFacts: {
      ...entry.runtimeFacts,
      note: `Core supply snapshot refresh failed; showing stale evidence. ${entry.runtimeFacts?.note ?? ''}`.trim(),
    },
    evidenceFreshness: {
      ...entry.evidenceFreshness,
      source: 'supply_snapshot_refresh_failed_using_stale_data',
    },
  };
}

/** Project Core's existing admin_supply_control snapshot onto J1 domains. */
export function projectSupplySnapshotCapabilityRegistry(
  snapshot: SupplyControlSnapshot | undefined,
  state: { failed?: boolean } = {},
  baseView: CapabilityRegistryView = buildCapabilityRegistry()
): CapabilityRegistryView {
  const reason = state.failed
    ? 'supply_snapshot_query_failed'
    : 'supply_snapshot_loading';
  let view = baseView;

  for (const [capabilityId, operations] of Object.entries(
    MODEL_SUPPLY_OPERATIONS
  )) {
    const current = view.entries.find((entry) => entry.id === capabilityId);
    if (!current) continue;
    const entry = snapshot
      ? state.failed
        ? markSupplySnapshotRefreshStale(
            projectModelSupplyEntry(current, snapshot, operations)
          )
        : projectModelSupplyEntry(current, snapshot, operations)
      : {
          ...current,
          availability: state.failed
            ? ('stale' as const)
            : ('not_verified' as const),
          runtimeFacts: {
            calls: unknownMetric(reason),
            successRate: unknownMetric(reason),
            p95LatencyMs: unknownMetric(reason),
            costMicros: unknownMetric(reason),
            note: `Core supply snapshot ${reason}; no synthetic zero or green status.`,
          },
          evidenceFreshness: {
            capturedAt: current.evidenceFreshness?.capturedAt,
            staleAfterMs: current.evidenceFreshness?.staleAfterMs,
            source: reason,
          },
        };
    view = replaceRegistryEntry(view, entry);
  }

  const entitlement = view.entries.find(
    (entry) => entry.id === 'entitlements_billing_redemption'
  );
  if (!entitlement) return view;
  return replaceRegistryEntry(
    view,
    snapshot
      ? state.failed
        ? markSupplySnapshotRefreshStale(
            projectEntitlementPoolEntry(entitlement, snapshot)
          )
        : projectEntitlementPoolEntry(entitlement, snapshot)
      : {
          ...entitlement,
          availability: state.failed ? 'stale' : 'not_verified',
          runtimeFacts: {
            entitlementHeadroom: unknownMetric(reason),
            calls: unknownMetric(reason),
            costMicros: unknownMetric(reason),
            note: `Core supply snapshot ${reason}; entitlement state remains unknown.`,
          },
          evidenceFreshness: {
            capturedAt: entitlement.evidenceFreshness?.capturedAt,
            staleAfterMs: entitlement.evidenceFreshness?.staleAfterMs,
            source: reason,
          },
        }
  );
}

function LiveAdminCapabilityRegistry({
  initialSelectedId,
}: {
  initialSelectedId?: string;
}) {
  const query = useQuery({
    queryKey: adminOperationalMetricsQueryKey,
    queryFn: ({ signal }) => readAdminOperationalMetrics(signal),
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
  const supplyQuery = useAdminSupplyControlSnapshot();
  const view = useMemo(() => {
    const operationalView = projectOperationalMetricsCapabilityRegistry(
      query.data,
      { failed: query.isError }
    );
    return projectSupplySnapshotCapabilityRegistry(
      supplyQuery.data,
      { failed: supplyQuery.isError },
      operationalView
    );
  }, [query.data, query.isError, supplyQuery.data, supplyQuery.isError]);

  return (
    <CapabilityRegistryPanel
      view={view}
      initialSelectedId={initialSelectedId}
    />
  );
}

/**
 * Admin capability registry control (J1).
 * Explicit view remains the pure SSR seam; the product path reads Core.
 */
export function AdminCapabilityRegistry({
  view: viewProp,
  initialSelectedId,
}: {
  view?: CapabilityRegistryView;
  initialSelectedId?: string;
} = {}) {
  if (!viewProp) {
    return (
      <LiveAdminCapabilityRegistry initialSelectedId={initialSelectedId} />
    );
  }

  return (
    <CapabilityRegistryPanel
      view={viewProp}
      initialSelectedId={initialSelectedId}
    />
  );
}
