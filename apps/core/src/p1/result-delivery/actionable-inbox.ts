/**
 * Actionable inbox reference projection (D-097 / #94 / B4).
 *
 * Event sources = Task terminal states + deliveryEvents + PendingAction.
 * No independent Notification table / parallel state store.
 */

import type {
  ActionableInboxEventSource,
  ActionableInboxItem,
  ActionableInboxStatusKind,
  PendingAction,
  RecentNextActionLabel,
  ResultTarget,
} from '@meiye/contracts';

/** Task terminal facts used as inbox event sources. */
export type InboxTaskTerminalSource = {
  taskId: string;
  workspaceId: string;
  workId: string;
  /**
   * Terminal / recovery-relevant status.
   * completed → result_available
   * failed → task_failed
   * acceptance_unknown → acceptance_unknown_recovery
   */
  taskStatus: 'completed' | 'failed' | 'acceptance_unknown';
  /** When the terminal / recovery status became effective. */
  occurredAt: string;
  title?: string;
  contentId?: string;
  versionId?: string;
  contentRevision?: number;
};

/**
 * Delivery event facts (ContentPackage.deliveryEvents projection).
 * Partial / unknown / completed map to delivery notification kinds.
 */
export type InboxDeliveryEventSource = {
  eventId: string;
  packageId: string;
  workspaceId: string;
  workId: string;
  occurredAt: string;
  eventType:
    | 'assisted_handoff_prepared'
    | 'automatic_publish_result'
    | 'manual_publish_result'
    | 'legacy_handoff_event';
  /**
   * Publish outcome when present.
   * published → delivery_completed
   * failed | unknown → delivery_partial_or_unknown
   * absent (e.g. assisted_handoff_prepared alone) → not a terminal delivery notify
   */
  deliveryStatus?: 'published' | 'failed' | 'unknown';
  /**
   * When true, multi-object delivery left some targets unfinished
   * (partial_delivery semantics without a separate Notification row).
   */
  partial?: boolean;
  title?: string;
  contentId?: string;
  versionId?: string;
  contentRevision?: number;
};

export type ProjectActionableInboxInput = {
  tasks?: readonly InboxTaskTerminalSource[];
  deliveryEvents?: readonly InboxDeliveryEventSource[];
  pendingActions?: readonly PendingAction[];
  /**
   * Optional workId lookup for pending actions that only carry taskId.
   * When missing, needs_choice_or_confirm items omit target.
   */
  workIdByTaskId?: Readonly<Record<string, string>>;
};

const STATUS_TITLE: Record<ActionableInboxStatusKind, string> = {
  acceptance_unknown_recovery: '生成受理状态未知，需恢复核验',
  delivery_completed: '交付已完成',
  delivery_partial_or_unknown: '交付部分成功、失败或未知',
  needs_choice_or_confirm: '需要选择或补确认',
  result_available: '结果已可用',
  task_failed: '任务最终失败',
};

const STATUS_NEXT_ACTION: Record<
  ActionableInboxStatusKind,
  RecentNextActionLabel
> = {
  acceptance_unknown_recovery: '处理当前问题',
  delivery_completed: '查看结果',
  delivery_partial_or_unknown: '继续交付',
  needs_choice_or_confirm: '处理当前问题',
  result_available: '查看结果',
  task_failed: '处理当前问题',
};

function targetFor(
  workId: string,
  extra?: {
    contentId?: string;
    versionId?: string;
    panel?: ResultTarget['panel'];
    focusKey?: string;
  },
): ResultTarget {
  return {
    workId,
    ...(extra?.contentId ? { contentId: extra.contentId } : {}),
    ...(extra?.versionId ? { versionId: extra.versionId } : {}),
    ...(extra?.panel ? { panel: extra.panel } : {}),
    ...(extra?.focusKey ? { focusKey: extra.focusKey } : {}),
  };
}

function fromTask(task: InboxTaskTerminalSource): ActionableInboxItem {
  const statusKind: ActionableInboxStatusKind =
    task.taskStatus === 'completed'
      ? 'result_available'
      : task.taskStatus === 'failed'
        ? 'task_failed'
        : 'acceptance_unknown_recovery';

  const eventSource: ActionableInboxEventSource = {
    kind: 'task_terminal',
    taskId: task.taskId,
    taskStatus: task.taskStatus,
  };

  const panel: ResultTarget['panel'] =
    statusKind === 'result_available' ? 'result' : 'run';

  return {
    statusKind,
    createdAt: task.occurredAt,
    title: task.title ?? STATUS_TITLE[statusKind],
    nextActionLabel: STATUS_NEXT_ACTION[statusKind],
    target: targetFor(task.workId, {
      contentId: task.contentId,
      versionId: task.versionId,
      panel,
    }),
    eventSource,
    workspaceId: task.workspaceId,
    ...(task.contentRevision !== undefined
      ? { contentRevision: task.contentRevision }
      : {}),
  };
}

function fromDelivery(
  event: InboxDeliveryEventSource,
): ActionableInboxItem | null {
  // assisted_handoff_prepared without publish status is not a delivery notify.
  if (
    event.eventType === 'assisted_handoff_prepared' &&
    !event.deliveryStatus &&
    !event.partial
  ) {
    return null;
  }

  // legacy package_created / opened / downloaded / shared / copied are not
  // terminal delivery notifications (D-097 actionable matrix only).
  if (event.eventType === 'legacy_handoff_event' && !event.deliveryStatus) {
    return null;
  }

  let statusKind: ActionableInboxStatusKind;
  if (event.partial === true) {
    statusKind = 'delivery_partial_or_unknown';
  } else if (event.deliveryStatus === 'published') {
    statusKind = 'delivery_completed';
  } else if (
    event.deliveryStatus === 'failed' ||
    event.deliveryStatus === 'unknown'
  ) {
    statusKind = 'delivery_partial_or_unknown';
  } else {
    return null;
  }

  const eventSource: ActionableInboxEventSource = {
    kind: 'delivery_event',
    packageId: event.packageId,
    eventId: event.eventId,
    eventType: event.eventType,
    ...(event.deliveryStatus
      ? { deliveryStatus: event.deliveryStatus }
      : {}),
  };

  return {
    statusKind,
    createdAt: event.occurredAt,
    title: event.title ?? STATUS_TITLE[statusKind],
    nextActionLabel: STATUS_NEXT_ACTION[statusKind],
    target: targetFor(event.workId, {
      contentId: event.contentId ?? event.packageId,
      versionId: event.versionId,
      panel: 'delivery',
    }),
    eventSource,
    workspaceId: event.workspaceId,
    ...(event.contentRevision !== undefined
      ? { contentRevision: event.contentRevision }
      : {}),
  };
}

function fromPendingAction(
  action: PendingAction,
  workIdByTaskId?: Readonly<Record<string, string>>,
): ActionableInboxItem {
  const workId = workIdByTaskId?.[action.taskId];
  return {
    statusKind: 'needs_choice_or_confirm',
    createdAt: action.createdAt,
    title: STATUS_TITLE.needs_choice_or_confirm,
    nextActionLabel: STATUS_NEXT_ACTION.needs_choice_or_confirm,
    ...(workId
      ? {
          target: targetFor(workId, { panel: 'result' }),
        }
      : {}),
    eventSource: {
      kind: 'pending_action',
      pendingActionKind: action.kind,
      taskId: action.taskId,
      questionOrApprovalRef: action.questionOrApprovalRef,
    },
    pendingAction: action,
  };
}

/**
 * Project the six notification status kinds from authoritative event sources.
 * Pure / deterministic — same inputs always yield the same ordered items.
 */
export function projectActionableInbox(
  input: ProjectActionableInboxInput,
): ActionableInboxItem[] {
  const items: ActionableInboxItem[] = [];

  for (const task of input.tasks ?? []) {
    items.push(fromTask(task));
  }

  for (const event of input.deliveryEvents ?? []) {
    const item = fromDelivery(event);
    if (item) items.push(item);
  }

  for (const action of input.pendingActions ?? []) {
    items.push(fromPendingAction(action, input.workIdByTaskId));
  }

  return items.sort(compareActionableInboxItems);
}

export function compareActionableInboxItems(
  left: ActionableInboxItem,
  right: ActionableInboxItem,
): number {
  return (
    left.createdAt.localeCompare(right.createdAt) ||
    left.statusKind.localeCompare(right.statusKind) ||
    eventSourceKey(left.eventSource).localeCompare(
      eventSourceKey(right.eventSource),
    )
  );
}

function eventSourceKey(source: ActionableInboxEventSource): string {
  switch (source.kind) {
    case 'task_terminal':
      return `task:${source.taskId}:${source.taskStatus}`;
    case 'delivery_event':
      return `delivery:${source.packageId}:${source.eventId}`;
    case 'pending_action':
      return `pending:${source.taskId}:${source.questionOrApprovalRef}`;
  }
}

/** All six status kinds that the contract requires event-source coverage for. */
export const ACTIONABLE_INBOX_REQUIRED_STATUS_KINDS: readonly ActionableInboxStatusKind[] =
  [
    'result_available',
    'needs_choice_or_confirm',
    'acceptance_unknown_recovery',
    'task_failed',
    'delivery_partial_or_unknown',
    'delivery_completed',
  ];
