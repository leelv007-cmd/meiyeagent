/**
 * Task drilldown projection (J4 / D-070).
 * Information completeness: summary cards / latency segments / durable
 * timestamp timeline / foldable error badge / artifact preview.
 */
import { buildDefaultSupplyControlSnapshot } from './admin-supply-fixture';
import type {
  SupplyControlSnapshot,
  SupplyRunRecord,
} from './admin-supply-types';

export interface LatencySegmentView {
  key: 'queue' | 'provider' | 'postprocess' | 'total';
  label: string;
  ms: number | null;
}

export interface TimelineEventView {
  id: string;
  at: string;
  phase: string;
  summary: string;
  durable: true;
}

export interface ErrorBadgeView {
  code: string;
  message: string;
  foldedDefault: true;
}

export interface ArtifactPreviewView {
  url: string;
  kind: 'image' | 'video' | 'other';
}

export interface TaskDrilldownView {
  taskId: string;
  run: SupplyRunRecord;
  summary: {
    status: SupplyRunRecord['status'];
    operation: SupplyRunRecord['operation'];
    modality: SupplyRunRecord['modality'];
    catalogModelId: string;
    deploymentId: string;
    channelKind: SupplyRunRecord['channelKind'];
    dataClass: SupplyRunRecord['dataClass'];
    attemptCount: number;
    lifecycle: SupplyRunRecord['lifecycle'];
    costLabel: string;
  };
  latencySegments: LatencySegmentView[];
  timeline: TimelineEventView[];
  error: ErrorBadgeView | null;
  artifact: ArtifactPreviewView | null;
  routePolicyRevisionId: string | null;
  poolId: string | null;
}

function costLabel(run: SupplyRunRecord): string {
  if (typeof run.costMicros !== 'number') {
    return 'unknown (cost_not_instrumented)';
  }
  const currency = run.currency ?? 'CNY';
  return `${(run.costMicros / 1_000_000).toFixed(4)} ${currency}`;
}

function buildTimeline(run: SupplyRunRecord): TimelineEventView[] {
  const events: TimelineEventView[] = [
    {
      id: `${run.id}-start`,
      at: run.startedAt,
      phase: 'accepted_by_control_plane',
      summary: `任务 ${run.taskId} 进入供应执行（${run.lifecycle}）`,
      durable: true,
    },
  ];
  if (run.queueMs != null) {
    events.push({
      id: `${run.id}-queue`,
      at: run.startedAt,
      phase: 'queue',
      summary: `排队 ${run.queueMs}ms`,
      durable: true,
    });
  }
  if (run.providerMs != null) {
    events.push({
      id: `${run.id}-provider`,
      at: run.startedAt,
      phase: 'provider',
      summary: `上游执行 ${run.providerMs}ms · ${run.deploymentId}`,
      durable: true,
    });
  }
  if (run.errorCode) {
    events.push({
      id: `${run.id}-error`,
      at: run.endedAt ?? run.startedAt,
      phase: 'error',
      summary: `${run.errorCode}: ${run.errorMessage ?? ''}`.trim(),
      durable: true,
    });
  }
  if (run.endedAt) {
    events.push({
      id: `${run.id}-end`,
      at: run.endedAt,
      phase: 'terminal',
      summary: `终态 ${run.status}`,
      durable: true,
    });
  } else if (run.status === 'acceptance_unknown') {
    events.push({
      id: `${run.id}-unknown`,
      at: run.startedAt,
      phase: 'acceptance_unknown',
      summary: '接受态未知 — 禁止盲目重试媒体任务',
      durable: true,
    });
  }
  return events;
}

export function buildTaskDrilldownView(
  taskId: string,
  snapshot: SupplyControlSnapshot = buildDefaultSupplyControlSnapshot()
): TaskDrilldownView | null {
  const run = snapshot.runs.find((r) => r.taskId === taskId);
  if (!run) return null;

  const latencySegments: LatencySegmentView[] = [
    { key: 'queue', label: '排队', ms: run.queueMs ?? null },
    { key: 'provider', label: '上游', ms: run.providerMs ?? null },
    { key: 'postprocess', label: '后处理', ms: run.postprocessMs ?? null },
    { key: 'total', label: '合计', ms: run.latencyMs ?? null },
  ];

  let artifact: ArtifactPreviewView | null = null;
  if (run.artifactPreviewUrl) {
    const kind =
      run.modality === 'video'
        ? 'video'
        : run.modality === 'image'
          ? 'image'
          : 'other';
    artifact = { url: run.artifactPreviewUrl, kind };
  }

  return {
    taskId,
    run,
    summary: {
      status: run.status,
      operation: run.operation,
      modality: run.modality,
      catalogModelId: run.catalogModelId,
      deploymentId: run.deploymentId,
      channelKind: run.channelKind,
      dataClass: run.dataClass,
      attemptCount: run.attemptCount,
      lifecycle: run.lifecycle,
      costLabel: costLabel(run),
    },
    latencySegments,
    timeline: buildTimeline(run),
    error: run.errorCode
      ? {
          code: run.errorCode,
          message: run.errorMessage ?? '',
          foldedDefault: true,
        }
      : null,
    artifact,
    routePolicyRevisionId: run.routePolicyRevisionId ?? null,
    poolId: run.poolId ?? null,
  };
}

export function listTaskIds(
  snapshot: SupplyControlSnapshot = buildDefaultSupplyControlSnapshot()
): string[] {
  return [...new Set(snapshot.runs.map((r) => r.taskId))];
}
