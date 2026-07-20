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
  pending_actions_count,
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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
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
import { PendingActionsInbox } from './pending-actions-inbox';
import {
  pendingActionsQueryKey,
  readPendingActions,
} from './pending-actions-client';

interface AsyncTaskPanelRect {
  bottom: number;
  left: number;
  right: number;
  top: number;
}

interface AsyncTaskPanelViewport {
  height: number;
  width: number;
}

interface AsyncTaskPanelPosition {
  bottom: number;
  left: number;
  maxHeight: number;
  maxWidth: number;
}

const PANEL_GAP = 12;
const PANEL_MARGIN = 12;
const PANEL_MAX_WIDTH = 576;

export function asyncTaskPanelPosition(
  trigger: AsyncTaskPanelRect,
  viewport: AsyncTaskPanelViewport,
  isMobile: boolean
): AsyncTaskPanelPosition {
  const maxWidth = Math.max(
    0,
    Math.min(PANEL_MAX_WIDTH, viewport.width - PANEL_MARGIN * 2)
  );
  const preferredLeft = isMobile
    ? trigger.right - maxWidth
    : trigger.right + PANEL_GAP;
  const left = Math.max(
    PANEL_MARGIN,
    Math.min(preferredLeft, viewport.width - PANEL_MARGIN - maxWidth)
  );
  const preferredBottom = isMobile
    ? viewport.height - trigger.top + PANEL_GAP
    : viewport.height - trigger.bottom;
  const bottom = Math.max(PANEL_MARGIN, preferredBottom);

  return {
    bottom,
    left,
    maxHeight: Math.max(0, viewport.height - bottom - PANEL_MARGIN),
    maxWidth,
  };
}

export function createAnimationFrameScheduler(
  callback: () => void,
  requestFrame: (callback: FrameRequestCallback) => number = (frame) =>
    window.requestAnimationFrame(frame),
  cancelFrame: (frame: number) => void = (frame) =>
    window.cancelAnimationFrame(frame)
) {
  let frameId: number | undefined;
  return {
    cancel() {
      if (frameId === undefined) return;
      cancelFrame(frameId);
      frameId = undefined;
    },
    schedule() {
      if (frameId !== undefined) return;
      frameId = requestFrame(() => {
        frameId = undefined;
        callback();
      });
    },
  };
}

interface AsyncTaskPanelDismissEvent {
  key?: string;
  target: EventTarget | null;
  type: string;
}

export function handleAsyncTaskPanelDismiss(
  event: AsyncTaskPanelDismissEvent,
  panel: Pick<HTMLElement, 'contains'> | null,
  trigger: Pick<HTMLElement, 'contains' | 'focus'> | null,
  onClose: () => void
) {
  const isEscape = event.type === 'keydown' && event.key === 'Escape';
  const isOutsideClick =
    event.type === 'pointerdown' &&
    event.target !== null &&
    !panel?.contains(event.target as Node) &&
    !trigger?.contains(event.target as Node);
  if (!isEscape && !isOutsideClick) return false;

  onClose();
  if (isEscape) queueMicrotask(() => trigger?.focus());
  return true;
}

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
    workId: task.workId!,
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
  const [panelPosition, setPanelPosition] = useState<AsyncTaskPanelPosition>();
  const panelRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
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
  const pendingActionsQuery = useQuery({
    queryFn: ({ signal }) => readPendingActions(signal),
    queryKey: pendingActionsQueryKey,
    refetchInterval: 5_000,
    refetchOnWindowFocus: true,
  });
  const pendingActions = pendingActionsQuery.data ?? [];
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
    pendingActions.length > 0 ||
    plan.activeTasks.length > 0 ||
    unreadKeys.size > 0 ||
    historyQuery.isError ||
    videoWorkflowQuery.isError ||
    pendingActionsQuery.isError;
  const notificationCount = pendingActions.length + unreadKeys.size;
  const triggerLabel =
    pendingActions.length > 0
      ? pending_actions_count({ count: pendingActions.length })
      : plan.activeTasks.length > 0
        ? async_task_active_count({ count: plan.activeTasks.length })
        : async_task_button();

  const updatePanelPosition = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    setPanelPosition(
      asyncTaskPanelPosition(
        trigger.getBoundingClientRect(),
        { height: window.innerHeight, width: window.innerWidth },
        isMobile
      )
    );
  }, [isMobile]);

  const toggle = () => {
    const nextOpen = !open;
    if (nextOpen) updatePanelPosition();
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

  useEffect(() => {
    if (!open) return;
    const dismissPanel = (event: KeyboardEvent | PointerEvent) => {
      handleAsyncTaskPanelDismiss(
        event,
        panelRef.current,
        triggerRef.current,
        () => setOpen(false)
      );
    };
    document.addEventListener('keydown', dismissPanel);
    document.addEventListener('pointerdown', dismissPanel);
    const scrollPositionScheduler =
      createAnimationFrameScheduler(updatePanelPosition);
    updatePanelPosition();
    window.addEventListener('resize', updatePanelPosition);
    window.addEventListener('scroll', scrollPositionScheduler.schedule, true);
    const observer =
      typeof ResizeObserver === 'undefined'
        ? undefined
        : new ResizeObserver(updatePanelPosition);
    if (triggerRef.current) observer?.observe(triggerRef.current);
    return () => {
      observer?.disconnect();
      document.removeEventListener('keydown', dismissPanel);
      document.removeEventListener('pointerdown', dismissPanel);
      window.removeEventListener('resize', updatePanelPosition);
      window.removeEventListener(
        'scroll',
        scrollPositionScheduler.schedule,
        true
      );
      scrollPositionScheduler.cancel();
    };
  }, [open, updatePanelPosition]);

  const panel =
    open && panelPosition && typeof document !== 'undefined'
      ? createPortal(
          <Card
            ref={panelRef}
            className="meiye-product-shell fixed w-full gap-3 overflow-x-hidden overflow-y-auto bg-surface-2 p-4 text-foreground shadow-xl"
            data-layer="popover"
            data-shell-mode="product"
            id="async-task-center-panel"
            style={panelPosition}
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
                href={getPathWithLocale('/dashboard/content')}
              >
                {async_task_view_all()}
                <IconExternalLink aria-hidden="true" className="size-4" />
              </a>
            </div>
            <PendingActionsInbox
              actions={pendingActions}
              onSettled={() => void pendingActionsQuery.refetch()}
            />
            {historyQuery.isError ||
            videoWorkflowQuery.isError ||
            pendingActionsQuery.isError ? (
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
                      pendingActionsQuery.refetch(),
                    ])
                  }
                >
                  {async_task_retry()}
                </Button>
              </div>
            ) : null}
            {historyQuery.isLoading ||
            videoWorkflowQuery.isLoading ||
            pendingActionsQuery.isLoading ? (
              <p className="text-sm text-muted-foreground">
                {async_task_loading()}
              </p>
            ) : null}
            {!historyQuery.isLoading &&
            !videoWorkflowQuery.isLoading &&
            !pendingActionsQuery.isLoading &&
            pendingActions.length === 0 &&
            visiblePanelTasks.length === 0 ? (
              <p className="py-3 text-sm text-muted-foreground">
                {async_task_empty()}
              </p>
            ) : null}
            {visiblePanelTasks.length > 0 ? (
              <ol className="divide-y divide-divider">
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
          </Card>,
          document.body
        )
      : null;

  return (
    <aside
      aria-label={async_task_center_aria()}
      data-layer="sidebar"
      className={cn(
        isMobile
          ? 'fixed right-3 flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-2 sm:right-5'
          : 'relative w-full',
        isMobile
          ? 'bottom-[calc(5.25rem+env(safe-area-inset-bottom))]'
          : undefined
      )}
    >
      {plan.observerTasks.map((task) => (
        <AsyncTaskObserver key={`${task.source}:${task.id}`} task={task} />
      ))}
      {panel}
      <div aria-live="polite" className="sr-only">
        {pendingActions.length > 0
          ? pending_actions_count({ count: pendingActions.length })
          : unreadKeys.size > 0
            ? async_task_unread_count({ count: unreadKeys.size })
            : ''}
      </div>
      {showTrigger ? (
        <Button
          ref={triggerRef}
          type="button"
          aria-controls="async-task-center-panel"
          aria-expanded={open}
          aria-label={triggerLabel}
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
              {triggerLabel}
            </span>
          ) : null}
          {notificationCount > 0 ? (
            <span
              className={cn(
                'grid min-h-5 min-w-5 place-items-center rounded-full bg-surface-1 px-1 text-xs text-foreground',
                isMobile && 'absolute -top-1 -right-1'
              )}
            >
              {notificationCount}
            </span>
          ) : null}
        </Button>
      ) : null}
    </aside>
  );
}
