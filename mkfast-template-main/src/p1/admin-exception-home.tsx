import type { ActionableInboxItem, PendingAction } from '@meiye/contracts';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import { ExceptionHomePanel } from '@/components/admin/capability/exception-home-panel';
import {
  pendingActionsQueryKey,
  readPendingActions,
} from '@/product/pending-actions-client';
import {
  adminOperationalMetricsQueryKey,
  projectOperationalMetricsCapabilityRegistry,
  readAdminOperationalMetrics,
} from '@/p1/admin-capability-registry';
import { projectSixQuestionCompleteness } from '@/p1/admin-capability-registry-model';
import {
  buildExceptionHomeView,
  type BuildExceptionHomeInput,
  type ExceptionHomeView,
} from '@/p1/admin-exception-home-model';

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
}): ExceptionHomeView {
  let registry = projectOperationalMetricsCapabilityRegistry(
    input.operationalMetrics,
    { failed: input.metricsFailed }
  );

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
  const operationalMetrics = useQuery({
    queryKey: adminOperationalMetricsQueryKey,
    queryFn: ({ signal }) => readAdminOperationalMetrics(signal),
    refetchOnWindowFocus: true,
    staleTime: 15_000,
  });
  const pendingActions = useQuery({
    queryKey: pendingActionsQueryKey,
    queryFn: ({ signal }) => readPendingActions(signal),
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });

  // F-J-04: wait until both sources settle so loading never looks like "no exceptions".
  const metricsSettled =
    operationalMetrics.isSuccess || operationalMetrics.isError;
  const pendingSettled = pendingActions.isSuccess || pendingActions.isError;
  if (!metricsSettled || !pendingSettled) {
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
    operationalMetrics.isError &&
    pendingActions.isError &&
    !operationalMetrics.data &&
    !pendingActions.data
  ) {
    const metricsMessage =
      operationalMetrics.error instanceof Error
        ? operationalMetrics.error.message
        : 'OperationalMetric 加载失败';
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
        异常优先首页加载失败：{metricsMessage}；{pendingMessage}
        。当前状态未知，不能宣称无待处理异常。
      </section>
    );
  }

  return (
    <LiveAdminExceptionHomeReady
      input={input}
      metricsFailed={operationalMetrics.isError}
      operationalMetrics={operationalMetrics.data}
      pendingActions={pendingActions.data}
      pendingActionsFailed={pendingActions.isError}
    />
  );
}

function LiveAdminExceptionHomeReady({
  input,
  metricsFailed,
  operationalMetrics,
  pendingActions,
  pendingActionsFailed,
}: {
  input?: BuildExceptionHomeInput;
  metricsFailed: boolean;
  operationalMetrics: unknown;
  pendingActions: readonly (PendingAction | ActionableInboxItem)[] | undefined;
  pendingActionsFailed: boolean;
}) {
  const view = useMemo(
    () =>
      projectLiveExceptionHome({
        inboxItems: pendingActions
          ? projectPendingActionsForExceptionHome(pendingActions)
          : undefined,
        metricsFailed,
        now: input?.now,
        operationalMetrics,
        pendingActionsFailed,
      }),
    [
      input?.now,
      metricsFailed,
      operationalMetrics,
      pendingActions,
      pendingActionsFailed,
    ]
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
