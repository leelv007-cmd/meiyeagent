import { DashboardLayout } from '@/components/layout/dashboard-layout';
import { ObjectEvidence } from '@/components/uiux/object-evidence';
import { ProductStatus } from '@/components/uiux/product-status';
import { StatePanel } from '@/components/uiux/state-panel';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ContentTaskInbox } from '@/p1/content-task-inbox';
import { m } from '@/locale/paraglide/messages';
import { friendlyProductError } from '@/lib/correlated-api-error';
import { formatLocaleDateTime } from '@/lib/locale';
import { getPathWithLocale } from '@/lib/urls';
import { operationsCommand, operationsQuery } from '@/p1/client';
import {
  currentWeekRange,
  taskQuery,
  weeklyReviewView,
  type RawWeeklyReview,
} from '@/p1/operations-route-model';
import {
  taskSystemText,
  taskView,
  weekPointView,
  type RawInbox,
  type RawTask,
} from '@/p1/operations-view-model';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  TASK_RELATED_KIND_FILTER_OPTIONS,
  TASK_SOURCE_FILTER_OPTIONS,
  TASK_STATUS_FILTER_OPTIONS,
} from '@/p1/retrieval-facets';
import type {
  ContentTaskAction,
  TaskInboxFiltersValue,
  WeeklyBatchAction,
} from '@/p1/types';
import { ThinWeeklyReview, WeeklyBatch } from '@/p1/weekly-operations';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from '@tanstack/react-router';
import { useMemo, useState } from 'react';
import { toast } from 'sonner';

interface RawWeeklyBatch {
  included: RawTask[];
  excluded: Array<RawTask & { reason: string }>;
}

interface TaskPageSearch extends TaskInboxFiltersValue {
  mode: 'inbox' | 'week';
}

export function OperationsTaskPage({ search }: { search: TaskPageSearch }) {
  const navigate = useNavigate({ from: '/dashboard/tasks' });
  const queryClient = useQueryClient();
  const [selectedTaskIds, setSelectedTaskIds] = useState<string[]>([]);
  const range = useMemo(() => currentWeekRange(), []);
  const filters: TaskInboxFiltersValue = {
    date: search.date,
    relatedKind: search.relatedKind,
    risk: search.risk,
    source: search.source,
    status: search.status,
  };
  const inboxPayload = taskQuery(filters);
  const inboxQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'inbox', inboxPayload),
    queryFn: ({ signal }) =>
      operationsQuery<RawInbox>('inbox', inboxPayload, signal),
  });
  const weeklyBatchQuery = useQuery({
    enabled: search.mode === 'week',
    queryKey: p1QueryKeys.request('operations', 'weekly_batch', range),
    queryFn: ({ signal }) =>
      operationsQuery<RawWeeklyBatch>('weekly_batch', range, signal),
  });
  const weeklyReviewQuery = useQuery({
    enabled: search.mode === 'week',
    queryKey: p1QueryKeys.request('operations', 'weekly_review', range),
    queryFn: ({ signal }) =>
      operationsQuery<RawWeeklyReview | null>('weekly_review', range, signal),
  });
  const command = useMutation({
    mutationFn: (input: {
      action: string;
      payload: Record<string, unknown>;
      key?: string;
    }) => operationsCommand(input.action, input.payload, input.key),
    onError: () => toast.error(m.operations_task_command_failed_toast()),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: p1QueryKeys.module('operations'),
      });
    },
  });
  const review = weeklyReviewView(weeklyReviewQuery.data ?? null);
  const inbox = inboxQuery.data;
  const inboxFailure = inboxQuery.isError
    ? friendlyProductError(
        inboxQuery.error,
        m.operations_task_inbox_failed_description()
      )
    : undefined;
  const commandFailure = command.isError
    ? friendlyProductError(
        command.error,
        m.operations_task_command_failed_description()
      )
    : undefined;

  const setMode = (mode: TaskPageSearch['mode']) =>
    navigate({ search: (current) => ({ ...current, mode }) });
  const setFilters = (next: TaskInboxFiltersValue) =>
    navigate({ search: (current) => ({ ...current, ...next }) });
  const taskAction = (taskId: string, action: ContentTaskAction) => {
    if (action === 'add_asset') {
      window.location.assign(getPathWithLocale('/dashboard/assets'));
      return;
    }
    if (action === 'retry_notification') {
      command.mutate({
        action: 'retry_task_notification',
        key: `retry-notification-${taskId}`,
        payload: { taskId },
      });
      return;
    }
    const status = {
      archive: 'archived',
      complete: 'done',
      start: 'in_progress',
    }[action];
    if (status) {
      command.mutate({
        action: 'transition_task',
        payload: { status, taskId },
      });
    }
  };
  const runBatch = (action: WeeklyBatchAction, taskIds: string[]) => {
    command.mutate({
      action: 'execute_weekly_batch',
      payload: { batchAction: action, taskIds },
    });
    setSelectedTaskIds([]);
  };

  return (
    <DashboardLayout
      breadcrumbs={[
        { label: m.product_navigation_workbench(), isCurrentPage: false },
        { label: m.product_navigation_tasks(), isCurrentPage: true },
      ]}
      description={m.operations_task_page_description()}
      title={m.product_navigation_tasks()}
    >
      <nav
        className="flex flex-wrap gap-2"
        aria-label={m.operations_task_view_aria()}
      >
        <Button
          aria-pressed={search.mode === 'inbox'}
          type="button"
          variant="ghost"
          className={
            search.mode === 'inbox'
              ? 'bg-surface-1 text-foreground hover:bg-surface-1'
              : 'text-muted-foreground'
          }
          onClick={() => setMode('inbox')}
        >
          {m.operations_task_inbox_tab()}
        </Button>
        <Button
          aria-pressed={search.mode === 'week'}
          type="button"
          variant="ghost"
          className={
            search.mode === 'week'
              ? 'bg-surface-1 text-foreground hover:bg-surface-1'
              : 'text-muted-foreground'
          }
          onClick={() => setMode('week')}
        >
          {m.operations_task_week_tab()}
        </Button>
      </nav>
      {inboxQuery.isLoading ? (
        <StatePanel
          kind="loading"
          title={m.operations_task_loading_title()}
          description={m.operations_task_loading_description()}
        />
      ) : null}
      {inboxFailure ? (
        <StatePanel
          kind="error"
          title={m.operations_task_error_title()}
          description={inboxFailure.description}
          actionLabel={m.operations_task_retry()}
          onAction={() => void inboxQuery.refetch()}
        />
      ) : null}
      {commandFailure ? (
        <Alert variant="destructive">
          <AlertTitle>{m.operations_task_command_error_title()}</AlertTitle>
          <AlertDescription>
            {commandFailure.description}
            {commandFailure.correlationId
              ? ` ${m.common_correlation_id({ id: commandFailure.correlationId })}`
              : ''}
          </AlertDescription>
        </Alert>
      ) : null}
      {inbox && search.mode === 'inbox' ? (
        <ContentTaskInbox
          description={m.operations_task_inbox_description()}
          filterOptions={{
            dates: [
              { label: m.operations_task_date_all(), value: 'all' },
              { label: m.operations_task_date_week(), value: 'week' },
            ],
            relatedKinds: [...TASK_RELATED_KIND_FILTER_OPTIONS],
            risks: [
              { label: m.operations_task_risk_all(), value: 'all' },
              { label: m.operations_task_risk_normal(), value: 'normal' },
              {
                label: m.operations_task_risk_attention(),
                value: 'attention',
              },
              {
                label: m.operations_task_risk_external_permission(),
                value: 'external_permission',
              },
            ],
            sources: [...TASK_SOURCE_FILTER_OPTIONS],
            statuses: [...TASK_STATUS_FILTER_OPTIONS],
          }}
          filters={filters}
          onClearFilters={() =>
            setFilters({
              date: 'all',
              relatedKind: 'all',
              risk: 'all',
              source: 'all',
              status: 'all',
            })
          }
          onFiltersChange={setFilters}
          onSelectTask={(taskId, selected) =>
            setSelectedTaskIds((current) =>
              selected
                ? [...new Set([...current, taskId])]
                : current.filter((id) => id !== taskId)
            )
          }
          onTaskAction={taskAction}
          pendingTaskIds={command.isPending ? selectedTaskIds : []}
          selectedTaskIds={selectedTaskIds}
          tasks={inbox.tasks.map(taskView)}
          totalCount={Object.values(inbox.counts).reduce(
            (sum, count) => sum + (count ?? 0),
            0
          )}
          weekLabel={m.operations_rail_week_label()}
          weekPoints={inbox.weekStrip.map(weekPointView)}
        />
      ) : null}
      {search.mode === 'week' ? (
        <div className="space-y-6">
          {weeklyBatchQuery.isLoading || weeklyReviewQuery.isLoading ? (
            <StatePanel
              kind="loading"
              title={m.operations_task_week_loading_title()}
              description={m.operations_task_week_loading_description()}
            />
          ) : null}
          {weeklyBatchQuery.isError ? (
            <StatePanel
              kind="error"
              title={m.operations_task_week_batch_error_title()}
              description={m.operations_task_week_batch_error_description()}
              actionLabel={m.operations_task_week_batch_retry()}
              onAction={() => void weeklyBatchQuery.refetch()}
            />
          ) : null}
          {weeklyReviewQuery.isError ? (
            <StatePanel
              kind="error"
              title={m.operations_task_week_review_error_title()}
              description={m.operations_task_week_review_error_description()}
              actionLabel={m.operations_task_week_review_retry()}
              onAction={() => void weeklyReviewQuery.refetch()}
            />
          ) : null}
          {weeklyBatchQuery.data ? (
            <WeeklyBatch
              availableActions={[
                'create',
                'revise',
                'apply_template',
                'prepare_draft',
              ]}
              items={[
                ...weeklyBatchQuery.data.included.map((task) => ({
                  executable: true,
                  selected: selectedTaskIds.includes(task.id),
                  task: taskView(task),
                })),
                ...weeklyBatchQuery.data.excluded.map((task) => ({
                  executable: false,
                  exclusionReason: taskSystemText(task.reason),
                  publishConfirmationRequired: task.source === 'publish_ready',
                  selected: false,
                  task: taskView(task),
                })),
              ]}
              label={m.operations_task_week_batch_label()}
              onBulkAction={runBatch}
              onOpenTask={(taskId) =>
                void navigate({
                  to: '/dashboard/tasks/$taskId',
                  params: { taskId },
                  search: true,
                })
              }
              onSelectionChange={(taskId, selected) =>
                setSelectedTaskIds((current) =>
                  selected
                    ? [...new Set([...current, taskId])]
                    : current.filter((id) => id !== taskId)
                )
              }
              pending={command.isPending}
            />
          ) : null}
          {weeklyReviewQuery.data ? (
            <ThinWeeklyReview
              candidates={review.candidates}
              facts={review.facts}
              label={m.operations_task_week_review_label()}
              onConfirmCandidate={(candidateId) =>
                command.mutate({
                  action: 'confirm_weekly_candidates',
                  payload: {
                    candidateIds: [candidateId],
                    reviewId: weeklyReviewQuery.data!.id,
                  },
                })
              }
              onDismissCandidate={(candidateId) =>
                command.mutate({
                  action: 'dismiss_weekly_candidate',
                  payload: {
                    candidateId,
                    reviewId: weeklyReviewQuery.data!.id,
                  },
                })
              }
            />
          ) : (
            <Button
              type="button"
              disabled={weeklyReviewQuery.isLoading || command.isPending}
              variant="outline"
              onClick={() =>
                command.mutate({
                  action: 'create_weekly_review',
                  payload: range,
                })
              }
            >
              {m.operations_task_create_weekly_review()}
            </Button>
          )}
        </div>
      ) : null}
    </DashboardLayout>
  );
}

interface RawTaskEvent {
  id: string;
  event: string;
  createdAt: string;
  fromStatus?: string;
  toStatus?: string;
  reason?: string;
}

function taskSourceLabel(source: string) {
  if (source === 'asset_gap') return m.p1_task_source_asset_gap();
  if (source === 'manual') return m.p1_task_source_manual();
  if (source === 'publish_ready') return m.p1_task_source_publish_ready();
  if (source === 'stale_draft') return m.p1_task_source_stale_draft();
  if (source === 'weekly_batch') return m.p1_task_source_weekly_batch();
  if (source === 'weekly_review') return m.p1_task_source_weekly_review();
  return source;
}

function taskRiskLabel(risk: string) {
  if (risk === 'normal') return m.operations_task_risk_normal();
  if (risk === 'attention') return m.operations_task_risk_attention();
  if (risk === 'external_permission') {
    return m.operations_task_risk_external_permission();
  }
  return risk;
}

function taskStatusLabel(status?: string) {
  if (status === 'archived') return m.p1_task_status_archived();
  if (status === 'blocked') return m.p1_task_status_blocked();
  if (status === 'done') return m.p1_task_status_done();
  if (status === 'in_progress') return m.p1_task_status_in_progress();
  if (status === 'needs_asset') return m.p1_task_status_needs_asset();
  if (status === 'needs_review') return m.p1_task_status_needs_review();
  if (status === 'ready') return m.p1_task_status_ready();
  if (status === 'todo') return m.p1_task_status_todo();
  return status ?? '';
}

function taskEventLabel(event: string) {
  if (event === 'created') return m.operations_task_event_created();
  if (event === 'status_changed') {
    return m.operations_task_event_status_changed();
  }
  if (event === 'notification_sent') {
    return m.operations_task_event_notification_sent();
  }
  if (event === 'notification_failed') {
    return m.operations_task_event_notification_failed();
  }
  if (event === 'execution_claimed') {
    return m.operations_task_event_execution_claimed();
  }
  if (event === 'execution_completed') {
    return m.operations_task_event_execution_completed();
  }
  if (event === 'execution_failed') {
    return m.operations_task_event_execution_failed();
  }
  return event;
}

function taskEventStatusText(event: RawTaskEvent) {
  const fromStatus = taskStatusLabel(event.fromStatus);
  const toStatus = taskStatusLabel(event.toStatus);
  if (fromStatus && toStatus) {
    return m.operations_task_status_transition({
      from: fromStatus,
      to: toStatus,
    });
  }
  return toStatus || taskEventLabel(event.event);
}

export function OperationsTaskDetailPage({ taskId }: { taskId: string }) {
  const taskQueryResult = useQuery({
    queryKey: p1QueryKeys.request('operations', 'task', { taskId }),
    queryFn: ({ signal }) =>
      operationsQuery<RawTask>('task', { taskId }, signal),
  });
  const eventsQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'task_events', { taskId }),
    queryFn: ({ signal }) =>
      operationsQuery<RawTaskEvent[]>('task_events', { taskId }, signal),
  });
  const task = taskQueryResult.data;
  const taskDisplay = task ? taskView(task) : undefined;

  return (
    <DashboardLayout
      breadcrumbs={[
        { label: m.product_navigation_tasks(), isCurrentPage: false },
        { label: m.operations_task_detail_title(), isCurrentPage: true },
      ]}
      description={m.operations_task_detail_description()}
      title={m.operations_task_detail_title()}
    >
      {taskQueryResult.isLoading ? (
        <StatePanel
          kind="loading"
          title={m.operations_task_loading_title()}
          description={m.operations_task_detail_loading_description()}
        />
      ) : null}
      {taskQueryResult.isError ? (
        <StatePanel
          kind="empty"
          title={m.operations_task_not_found_title()}
          description={m.operations_task_not_found_description()}
        />
      ) : null}
      {task ? (
        <div className="space-y-5">
          <ObjectEvidence id={task.id} kind="Task" />
          <Card>
            <CardHeader>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <CardTitle>{taskDisplay?.title}</CardTitle>
                <ProductStatus status={task.status} showExplanation />
              </div>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge variant="outline">{taskSourceLabel(task.source)}</Badge>
                <Badge variant="outline">{taskRiskLabel(task.risk)}</Badge>
                <Badge variant="outline">
                  {task.executable
                    ? m.operations_task_executable()
                    : m.operations_task_needs_conditions()}
                </Badge>
              </div>
              <p>
                {m.operations_task_due({
                  date: formatLocaleDateTime(task.dueAt),
                })}
              </p>
              {taskDisplay?.blockedReason ? (
                <p>{taskDisplay.blockedReason}</p>
              ) : null}
              {taskDisplay?.nextStep ? (
                <p>{m.p1_task_next_step({ nextStep: taskDisplay.nextStep })}</p>
              ) : null}
            </CardContent>
          </Card>
          <section className="space-y-3" aria-labelledby="task-events-title">
            <h2 id="task-events-title" className="text-base font-semibold">
              {m.operations_task_events_title()}
            </h2>
            <ol className="divide-y divide-divider overflow-hidden rounded-xl bg-surface-1">
              {(eventsQuery.data ?? []).map((event) => (
                <li key={event.id} className="p-3 text-sm">
                  <p className="font-medium">{taskEventStatusText(event)}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {taskEventLabel(event.event)} ·{' '}
                    {formatLocaleDateTime(event.createdAt)}
                  </p>
                </li>
              ))}
            </ol>
          </section>
          <Link
            className="font-medium text-primary underline-offset-4 hover:underline"
            search={{
              date: 'all',
              mode: 'inbox',
              relatedKind: 'all',
              risk: 'all',
              source: 'all',
              status: 'all',
            }}
            to="/dashboard/tasks"
          >
            {m.operations_task_back_to_inbox()}
          </Link>
        </div>
      ) : null}
    </DashboardLayout>
  );
}
