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
  type ExceptionSeverity,
} from '@/p1/admin-exception-home-model';
import { AdminSensitiveWordsGateAlert } from '@/p1/admin-sensitive-words-gate-alert';
import type { SupplyControlSnapshot } from '@/p1/admin-supply-types';
import {
  admin_capability_current_state_is_unknown_cannot_claim_no_cea2a871,
  admin_capability_exception_first_home_failed_to_load_9bf0cc92,
  admin_capability_handle_current_issue_544826d7,
  admin_capability_loading_exception_first_home_1aa54d82,
  admin_capability_operationalmetric_load_failed_da0f68b4,
  admin_capability_pending_actions_load_failed_109c406d,
  admin_capability_supply_snapshot_load_failed_6612670f,
  admin_capability_task_needs_additional_choice_171c5251,
  admin_capability_task_waiting_for_operator_confirm_604c9f00,
} from '@/locale/paraglide/messages';

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
      // Contract wire labels stay the zh enum surface; messages own the copy keys.
      title: (item.kind === 'question'
        ? admin_capability_task_needs_additional_choice_171c5251()
        : admin_capability_task_waiting_for_operator_confirm_604c9f00()) as ActionableInboxItem['title'],
      nextActionLabel:
        admin_capability_handle_current_issue_544826d7() as ActionableInboxItem['nextActionLabel'],
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
  severityFilter,
  onSeverityFilterChange,
}: {
  input?: BuildExceptionHomeInput;
  severityFilter?: readonly ExceptionSeverity[];
  onSeverityFilterChange?: (next: readonly ExceptionSeverity[]) => void;
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
  // Spec F / D9: gate alert is independent of metrics/pending settle and must
  // not wait on them (loading/error of the gate stay visible, never empty-green).
  const gateAlert = <AdminSensitiveWordsGateAlert />;

  if (!projection.isSettled || !pendingSettled) {
    return (
      <div className="space-y-4">
        {gateAlert}
        <output
          data-testid="exception-home-loading"
          className="text-sm text-muted-foreground"
        >
          {admin_capability_loading_exception_first_home_1aa54d82()}
        </output>
      </div>
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
        : admin_capability_operationalmetric_load_failed_da0f68b4();
    const supplyMessage =
      projection.supplyQuery.error instanceof Error
        ? projection.supplyQuery.error.message
        : admin_capability_supply_snapshot_load_failed_6612670f();
    const pendingMessage =
      pendingActions.error instanceof Error
        ? pendingActions.error.message
        : admin_capability_pending_actions_load_failed_109c406d();
    return (
      <div className="space-y-4">
        {gateAlert}
        <section
          data-testid="exception-home-error"
          role="alert"
          className="rounded-lg border border-destructive/40 p-4 text-sm text-destructive"
        >
          {admin_capability_exception_first_home_failed_to_load_9bf0cc92()}
          {metricsMessage}；{supplyMessage}；{pendingMessage}
          {admin_capability_current_state_is_unknown_cannot_claim_no_cea2a871()}
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {gateAlert}
      <LiveAdminExceptionHomeReady
        input={input}
        registry={projection.view}
        pendingActions={pendingActions.data}
        pendingActionsFailed={pendingActions.isError}
        severityFilter={severityFilter}
        onSeverityFilterChange={onSeverityFilterChange}
      />
    </div>
  );
}

function LiveAdminExceptionHomeReady({
  input,
  registry,
  pendingActions,
  pendingActionsFailed,
  severityFilter,
  onSeverityFilterChange,
}: {
  input?: BuildExceptionHomeInput;
  registry: CapabilityRegistryView;
  pendingActions: readonly (PendingAction | ActionableInboxItem)[] | undefined;
  pendingActionsFailed: boolean;
  severityFilter?: readonly ExceptionSeverity[];
  onSeverityFilterChange?: (next: readonly ExceptionSeverity[]) => void;
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

  return (
    <ExceptionHomePanel
      view={view}
      severityFilter={severityFilter}
      onSeverityFilterChange={onSeverityFilterChange}
    />
  );
}

/**
 * Admin exception-first home control (J2 / D-055).
 * Explicit view remains the pure SSR seam; product rendering consumes the
 * existing pending-actions BFF and Core OperationalMetric query.
 * Severity filter props are client projection only (#385) — never query inputs.
 */
export function AdminExceptionHome({
  view: viewProp,
  input,
  severityFilter,
  onSeverityFilterChange,
}: {
  view?: ExceptionHomeView;
  input?: BuildExceptionHomeInput;
  severityFilter?: readonly ExceptionSeverity[];
  onSeverityFilterChange?: (next: readonly ExceptionSeverity[]) => void;
} = {}) {
  if (!viewProp) {
    return (
      <LiveAdminExceptionHome
        input={input}
        severityFilter={severityFilter}
        onSeverityFilterChange={onSeverityFilterChange}
      />
    );
  }

  return (
    <ExceptionHomePanel
      view={viewProp}
      severityFilter={severityFilter}
      onSeverityFilterChange={onSeverityFilterChange}
    />
  );
}
