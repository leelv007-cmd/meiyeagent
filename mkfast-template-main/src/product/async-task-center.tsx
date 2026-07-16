import { ProductStatus } from '@/components/uiux/product-status';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  async_task_active_count,
  async_task_button,
  async_task_center_aria,
  async_task_center_description,
  async_task_center_title,
  async_task_empty,
  async_task_kind_image,
  async_task_kind_video,
  async_task_load_error,
  async_task_loading,
  async_task_open,
  async_task_retry,
  async_task_row_hint,
  async_task_unread_count,
  async_task_view_all,
  common_close,
} from '@/locale/paraglide/messages';
import { cn } from '@/lib/utils';
import { getPathWithLocale } from '@/lib/urls';
import { operationsQuery } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';
import {
  IconBell,
  IconCheck,
  IconChevronRight,
  IconExternalLink,
  IconX,
} from '@tabler/icons-react';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useMemo, useState } from 'react';
import type { RawCanonicalHistory } from './canonical-history-model';
import {
  asyncTaskCenterPlan,
  asyncTaskElapsedLabel,
  asyncTaskStorageKey,
  canonicalAsyncTaskSummaries,
  composedVideoAsyncTaskSummaries,
  markAsyncTasksRead,
  reconcileAsyncTaskReadState,
  type AsyncTaskReadState,
  type AsyncTaskSummary,
} from './async-task-center-model';
import {
  useCanvasImageJobObserver,
  useCreativeJobObserver,
  useVideoWorkflowListObserver,
} from './creative-job-observer';

function readState(userId: string): AsyncTaskReadState | undefined {
  try {
    const raw = window.localStorage.getItem(asyncTaskStorageKey(userId));
    if (!raw) return undefined;
    const value = JSON.parse(raw) as Partial<AsyncTaskReadState>;
    if (
      !Array.isArray(value.recentKeys) ||
      !Array.isArray(value.seenTerminalKeys) ||
      !Array.isArray(value.unreadKeys)
    ) {
      return undefined;
    }
    return {
      recentKeys: value.recentKeys,
      seenTerminalKeys: value.seenTerminalKeys,
      unreadKeys: value.unreadKeys,
    };
  } catch {
    return undefined;
  }
}

function writeState(userId: string, state: AsyncTaskReadState) {
  window.localStorage.setItem(
    asyncTaskStorageKey(userId),
    JSON.stringify(state)
  );
}

function AsyncTaskRow({ task }: { task: AsyncTaskSummary }) {
  const elapsed = asyncTaskElapsedLabel(task);
  return (
    <li className="px-3 py-3">
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="min-w-0 flex-1 truncate text-sm font-medium">
              {task.label}
            </p>
            <ProductStatus announce className="shrink-0" status={task.status} />
          </div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {task.kind === 'video'
              ? async_task_kind_video()
              : async_task_kind_image()}{' '}
            · {async_task_row_hint()}
            {elapsed ? ` · ${elapsed}` : null}
          </p>
        </div>
        <a
          className="inline-flex min-h-10 shrink-0 items-center gap-1 rounded-md text-sm font-medium text-primary outline-none hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
          href={getPathWithLocale(task.href)}
        >
          {async_task_open()}
          <IconChevronRight aria-hidden="true" className="size-4" />
        </a>
      </div>
    </li>
  );
}

function AsyncTaskNotification({
  onClose,
  task,
}: {
  onClose: () => void;
  task: AsyncTaskSummary;
}) {
  const elapsed = asyncTaskElapsedLabel(task);
  const completed = task.status === 'completed';
  const StatusIcon = completed ? IconCheck : IconX;

  return (
    <li className="px-3 py-3">
      <div className="flex items-start gap-3">
        <div
          className={cn(
            'grid size-9 shrink-0 place-items-center rounded-full',
            completed
              ? 'bg-emerald-100 text-emerald-700'
              : 'bg-destructive/10 text-destructive'
          )}
        >
          <StatusIcon aria-hidden="true" className="size-5" />
        </div>
        <div className="min-w-0 flex-1 pt-0.5">
          <div className="flex items-start justify-between gap-3">
            <p className="min-w-0 flex-1 truncate text-sm font-medium">
              {task.label}
            </p>
            <ProductStatus announce className="shrink-0" status={task.status} />
          </div>
          <p className="mt-1 text-sm leading-5 text-muted-foreground">
            {task.kind === 'video'
              ? async_task_kind_video()
              : async_task_kind_image()}{' '}
            · {async_task_row_hint()}
            {elapsed ? ` · ${elapsed}` : null}
          </p>
          <div className="mt-3 flex items-center gap-6">
            <a
              className="inline-flex min-h-10 items-center gap-1 rounded-md text-sm font-medium text-primary outline-none hover:text-primary/80 focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
              href={getPathWithLocale(task.href)}
            >
              {async_task_open()}
              <IconChevronRight aria-hidden="true" className="size-4" />
            </a>
            <Button
              className="min-h-10 px-0 text-muted-foreground hover:bg-transparent hover:text-foreground"
              type="button"
              size="sm"
              variant="ghost"
              onClick={onClose}
            >
              {common_close()}
            </Button>
          </div>
        </div>
      </div>
    </li>
  );
}

function CreativeTaskObserver({ task }: { task: AsyncTaskSummary }) {
  useCreativeJobObserver({
    creativeJobId: task.creativeJobId,
    operation: task.operation,
    providerJobId: task.providerJobId,
    status: task.status,
  });
  return null;
}

function CanvasTaskObserver({ task }: { task: AsyncTaskSummary }) {
  useCanvasImageJobObserver({ jobId: task.id, status: task.status });
  return null;
}

function AsyncTaskObserver({ task }: { task: AsyncTaskSummary }) {
  if (task.source === 'video_workflow') return null;
  return task.source === 'canvas' ? (
    <CanvasTaskObserver task={task} />
  ) : (
    <CreativeTaskObserver task={task} />
  );
}

export function AsyncTaskCenter({
  isMobile,
  userId,
}: {
  isMobile: boolean;
  userId: string;
}) {
  const [open, setOpen] = useState(false);
  const [dismissedTaskIds, setDismissedTaskIds] = useState<Set<string>>(
    () => new Set()
  );
  const [readStateValue, setReadStateValue] = useState<AsyncTaskReadState>();
  const historyQuery = useQuery({
    queryKey: p1QueryKeys.request('operations', 'canonical_history'),
    queryFn: ({ signal }) =>
      operationsQuery<RawCanonicalHistory>('canonical_history', {}, signal),
    refetchOnWindowFocus: true,
  });
  const videoWorkflowQuery = useVideoWorkflowListObserver();
  const tasks = useMemo(
    () =>
      [
        ...(historyQuery.data
          ? canonicalAsyncTaskSummaries(historyQuery.data)
          : []),
        ...(videoWorkflowQuery.data
          ? composedVideoAsyncTaskSummaries(videoWorkflowQuery.data)
          : []),
      ].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt)),
    [historyQuery.data, videoWorkflowQuery.data]
  );

  useEffect(() => {
    if (!historyQuery.isSuccess || !videoWorkflowQuery.isSuccess) return;
    const next = reconcileAsyncTaskReadState(readState(userId), tasks);
    writeState(userId, next);
    setReadStateValue(next);
  }, [historyQuery.isSuccess, tasks, userId, videoWorkflowQuery.isSuccess]);

  const unreadKeys = new Set(readStateValue?.unreadKeys ?? []);
  const plan = asyncTaskCenterPlan({
    panelOpen: open,
    recentKeys: readStateValue?.recentKeys ?? [],
    tasks,
  });
  const visiblePanelTasks = plan.panelTasks.filter(
    (task) => !dismissedTaskIds.has(task.id)
  );
  const showTrigger =
    open ||
    plan.activeTasks.length > 0 ||
    unreadKeys.size > 0 ||
    historyQuery.isError ||
    videoWorkflowQuery.isError;

  const toggle = () => {
    const nextOpen = !open;
    setOpen(nextOpen);
    if (!nextOpen || !readStateValue) return;
    const next = markAsyncTasksRead(readStateValue);
    writeState(userId, next);
    setReadStateValue(next);
  };

  const dismissTask = (taskId: string) => {
    setDismissedTaskIds((current) => {
      const next = new Set(current);
      next.add(taskId);
      return next;
    });
  };

  useEffect(() => {
    if (!open || !readStateValue || readStateValue.unreadKeys.length === 0)
      return;
    const next = markAsyncTasksRead(readStateValue);
    writeState(userId, next);
    setReadStateValue(next);
  }, [open, readStateValue, userId]);

  return (
    <aside
      aria-label={async_task_center_aria()}
      className={cn(
        isMobile
          ? 'fixed right-3 z-[60] flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-2 sm:right-5'
          : 'relative z-[60] w-full',
        isMobile
          ? 'bottom-[calc(5.25rem+env(safe-area-inset-bottom))]'
          : undefined
      )}
    >
      {plan.observerTasks.map((task) => (
        <AsyncTaskObserver key={`${task.source}:${task.id}`} task={task} />
      ))}
      {open ? (
        <Card
          id="async-task-center-panel"
          className={cn(
            'z-[70] w-[min(24rem,calc(100vw-1.5rem))] gap-3 bg-surface-2 p-4 text-foreground shadow-xl',
            !isMobile &&
              'absolute bottom-0 left-[calc(100%+0.75rem)] max-w-[calc(100vw-var(--sidebar-width-icon)-2rem)]'
          )}
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">{async_task_center_title()}</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                {async_task_center_description()}
              </p>
            </div>
            <a
              className="inline-flex min-h-10 items-center gap-1 text-sm font-medium text-primary"
              href={getPathWithLocale('/dashboard/jobs')}
            >
              {async_task_view_all()}
              <IconExternalLink aria-hidden="true" className="size-4" />
            </a>
          </div>
          {historyQuery.isError || videoWorkflowQuery.isError ? (
            <div className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
              <p>{async_task_load_error()}</p>
              <Button
                className="mt-2"
                type="button"
                size="sm"
                variant="outline"
                onClick={() =>
                  void Promise.all([
                    historyQuery.refetch(),
                    videoWorkflowQuery.refetch(),
                  ])
                }
              >
                {async_task_retry()}
              </Button>
            </div>
          ) : null}
          {historyQuery.isLoading || videoWorkflowQuery.isLoading ? (
            <p className="text-sm text-muted-foreground">
              {async_task_loading()}
            </p>
          ) : null}
          {!historyQuery.isLoading &&
          !videoWorkflowQuery.isLoading &&
          visiblePanelTasks.length === 0 ? (
            <p className="py-3 text-sm text-muted-foreground">
              {async_task_empty()}
            </p>
          ) : null}
          {visiblePanelTasks.length > 0 ? (
            <ol className="max-h-[min(60vh,28rem)] divide-y divide-divider overflow-y-auto">
              {visiblePanelTasks.map((task) =>
                ['cancelled', 'completed', 'failed'].includes(task.status) ? (
                  <AsyncTaskNotification
                    key={`${task.kind}:${task.id}`}
                    task={task}
                    onClose={() => dismissTask(task.id)}
                  />
                ) : (
                  <AsyncTaskRow key={`${task.kind}:${task.id}`} task={task} />
                )
              )}
            </ol>
          ) : null}
        </Card>
      ) : null}
      <div aria-live="polite" className="sr-only">
        {unreadKeys.size > 0
          ? async_task_unread_count({ count: unreadKeys.size })
          : ''}
      </div>
      {showTrigger ? (
        <Button
          type="button"
          aria-controls="async-task-center-panel"
          aria-expanded={open}
          aria-label={
            plan.activeTasks.length > 0
              ? async_task_active_count({ count: plan.activeTasks.length })
              : async_task_button()
          }
          className={cn(
            isMobile
              ? 'relative rounded-full bg-surface-2 text-foreground shadow-lg hover:bg-surface-1'
              : 'w-full justify-start bg-sidebar-accent text-sidebar-accent-foreground shadow-none hover:bg-sidebar-accent/80 group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2!'
          )}
          onClick={toggle}
          size={isMobile ? 'icon' : 'default'}
          variant="secondary"
        >
          <IconBell aria-hidden="true" className="size-5" />
          {!isMobile ? (
            <span className="truncate group-data-[collapsible=icon]:hidden">
              {plan.activeTasks.length > 0
                ? async_task_active_count({
                    count: plan.activeTasks.length,
                  })
                : async_task_button()}
            </span>
          ) : null}
          {unreadKeys.size > 0 ? (
            <span
              className={cn(
                'grid min-h-5 min-w-5 place-items-center rounded-full bg-surface-1 px-1 text-xs text-foreground',
                isMobile && 'absolute -top-1 -right-1'
              )}
            >
              {unreadKeys.size}
            </span>
          ) : null}
        </Button>
      ) : null}
    </aside>
  );
}
