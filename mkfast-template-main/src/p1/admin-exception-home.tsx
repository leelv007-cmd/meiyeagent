import type { ActionableInboxItem, PendingAction } from '@meiye/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { ExceptionHomePanel } from '@/components/admin/capability/exception-home-panel';
import {
  pendingActionsQueryKey,
  readPendingActions,
} from '@/product/pending-actions-client';
import {
  projectAdminCapabilityRegistry,
  useAdminCapabilityRegistryProjection,
} from '@/p1/admin-capability-registry';
import {
  projectSixQuestionCompleteness,
  type CapabilityRegistryView,
} from '@/p1/admin-capability-registry-model';
import {
  buildExceptionHomeView,
  type BuildExceptionHomeInput,
  type ExceptionHomeView,
} from '@/p1/admin-exception-home-model';
import type { SupplyControlSnapshot } from '@/p1/admin-supply-types';

function isActionableInboxItem(
  item: PendingAction | ActionableInboxItem
): item is ActionableInboxItem {
  return 'statusKind' in item && 'eventSource' in item;
}

/**
 * Current pending-actions wire response is PendingAction[]. Keep the J2 model
 * on its ActionableInboxItem contract without adding another store/service.
 * Identity support keeps this compatible with a future extended #94 response.
 */
export function projectPendingActionsForExceptionHome(
  items: readonly (PendingAction | ActionableInboxItem)[]
): ActionableInboxItem[] {
  return items.map((item) => {
    if (isActionableInboxItem(item)) return item;
    return {
      statusKind: 'needs_choice_or_confirm',
      createdAt: item.createdAt,
      title: item.kind === 'question' ? '任务需要补充选择' : '任务等待操作确认',
      nextActionLabel: '处理当前问题',
      eventSource: {
        kind: 'pending_action',
        pendingActionKind: item.kind,
        taskId: item.taskId,
        questionOrApprovalRef: item.questionOrApprovalRef,
      },
      pendingAction: item,
    };
  });
}

export function projectLiveExceptionHome(input: {
  inboxItems?: readonly ActionableInboxItem[];
  metricsFailed?: boolean;
  now?: string | number;
  operationalMetrics?: unknown;
  pendingActionsFailed?: boolean;
  /** Shared registry projection; when omitted, builds from metrics + supply. */
  registry?: CapabilityRegistryView;
  supplyFailed?: boolean;
  supplySnapshot?: SupplyControlSnapshot;
}): ExceptionHomeView {
  let registry =
    input.registry ??
    projectAdminCapabilityRegistry({
      operationalMetrics: input.operationalMetrics,
      metricsFailed: input.metricsFailed,
      supplySnapshot: input.supplySnapshot,
      supplyFailed: input.supplyFailed,
    });

  if (input.pendingActionsFailed) {
    const entry = registry.entries.find(
      (candidate) => candidate.id === 'job_queue_harness'
    );
    if (entry) {
      const staleEntry = {
        ...entry,
        availability: 'stale' as const,
        runtimeFacts: {
          calls: {
            status: 'unknown' as const,
            reason: 'pending_actions_query_failed',
          },
          successRate: entry.runtimeFacts?.successRate,
          p95LatencyMs: entry.runtimeFacts?.p95LatencyMs,
          note: 'pending_actions_query_failed; the home cannot claim that no action is pending.',
        },
        evidenceFreshness: {
          capturedAt: entry.evidenceFreshness?.capturedAt,
          staleAfterMs: entry.evidenceFreshness?.staleAfterMs,
          source: 'pending_actions_query_failed',
        },
      };
      registry = {
        ...registry,
        entries: registry.entries.map((candidate) =>
          candidate.id === staleEntry.id ? staleEntry : candidate
        ),
        projections: registry.projections.map((projection) =>
          projection.capabilityId === staleEntry.id
            ? projectSixQuestionCompleteness(staleEntry, projection.name)
            : projection
        ),
      };
    }
  }

  return buildExceptionHomeView({
    inboxItems: input.inboxItems,
    registry,
    now: input.now,
  });
}

function LiveAdminExceptionHome({
  input,
}: {
  input?: BuildExceptionHomeInput;
}) {
  const projection = useAdminCapabilityRegistryProjection();
  const pendingActions = useQuery({
    queryKey: pendingActionsQueryKey,
    queryFn: ({ signal }) => readPendingActions(signal),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });

  // F-J-04: wait until shared projection + pending-actions settle so loading
  // never looks like "no exceptions".
  const pendingSettled = pendingActions.isSuccess || pendingActions.isError;
  if (!projection.isSettled || !pendingSettled) {
    return (
      <output
        data-testid="exception-home-loading"
        className="text-sm text-muted-foreground"
      >
        正在加载异常优先首页…
      </output>
    );
  }

  if (
    projection.metricsFailed &&
    projection.supplyFailed &&
    pendingActions.isError &&
    !projection.hasMetricsData &&
    !projection.hasSupplyData &&
    !pendingActions.data
  ) {
    const metricsMessage =
      projection.metricsQuery.error instanceof Error
        ? projection.metricsQuery.error.message
        : 'OperationalMetric 加载失败';
    const supplyMessage =
      projection.supplyQuery.error instanceof Error
        ? projection.supplyQuery.error.message
        : '供给快照加载失败';
    const pendingMessage =
      pendingActions.error instanceof Error
        ? pendingActions.error.message
        : 'pending-actions 加载失败';
    return (
      <section
        data-testid="exception-home-error"
        role="alert"
        className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive"
      >
        异常优先首页加载失败：{metricsMessage}；{supplyMessage}；{pendingMessage}
        。当前状态未知，不能宣称无待处理异常。
      </section>
    );
  }

  return (
    <LiveAdminExceptionHomeReady
      input={input}
      registry={projection.view}
      pendingActions={pendingActions.data}
      pendingActionsFailed={pendingActions.isError}
    />
  );
}

function LiveAdminExceptionHomeReady({
  input,
  registry,
  pendingActions,
  pendingActionsFailed,
}: {
  input?: BuildExceptionHomeInput;
  registry: CapabilityRegistryView;
  pendingActions: readonly (PendingAction | ActionableInboxItem)[] | undefined;
  pendingActionsFailed: boolean;
}) {
  const view = useMemo(
    () =>
      projectLiveExceptionHome({
        inboxItems: pendingActions
          ? projectPendingActionsForExceptionHome(pendingActions)
          : undefined,
        now: input?.now,
        pendingActionsFailed,
        registry,
      }),
    [input?.now, pendingActions, pendingActionsFailed, registry]
  );

  return <ExceptionHomePanel view={view} />;
}

/**
 * Admin exception-first home control (J2 / D-055).
 * Explicit view remains the pure SSR seam; product rendering consumes the
 * existing pending-actions BFF and Core OperationalMetric query.
 */
export function AdminExceptionHome({
  view: viewProp,
  input,
}: {
  view?: ExceptionHomeView;
  input?: BuildExceptionHomeInput;
} = {}) {
  if (!viewProp) return <LiveAdminExceptionHome input={input} />;

  return <ExceptionHomePanel view={viewProp} />;
}
