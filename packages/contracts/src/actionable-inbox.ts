/**
 * Actionable inbox / notification projection contract (D-097 / #94 / B4).
 *
 * Reference projection only — no independent Notification table.
 * Event sources = Task terminal states + deliveryEvents + existing PendingAction.
 * Keep PendingAction question|approval contract compatible.
 */

import type { PendingAction } from './pending-action.js';
import type { ResultPanel, ResultTarget } from './result-center.js';

/**
 * Six in-product notification status kinds (D-097).
 * Ordinary queue/progress/autosave must NOT appear here.
 */
export const actionableInboxStatusKinds = [
  /** 结果可用 */
  'result_available',
  /** 需要选择 / 补确认 — projects existing PendingAction question|approval */
  'needs_choice_or_confirm',
  /** acceptance_unknown 需恢复核验 */
  'acceptance_unknown_recovery',
  /** 任务最终失败 */
  'task_failed',
  /** 交付部分成功 / 失败 / 未知 */
  'delivery_partial_or_unknown',
  /** 交付完成 */
  'delivery_completed',
] as const;

export type ActionableInboxStatusKind =
  (typeof actionableInboxStatusKinds)[number];

/** Chinese product labels for the six status kinds. */
export const ACTIONABLE_INBOX_STATUS_LABEL: Record<
  ActionableInboxStatusKind,
  string
> = {
  acceptance_unknown_recovery: '需恢复核验',
  delivery_completed: '交付完成',
  delivery_partial_or_unknown: '交付部分成功/失败/未知',
  needs_choice_or_confirm: '需要选择/补确认',
  result_available: '结果可用',
  task_failed: '任务最终失败',
};

/**
 * Next-action copy for inbox / Recent entry points (D-090 / D-097).
 * Must not use vague "查看详情".
 */
export const recentNextActionLabels = [
  '查看进度',
  '处理当前问题',
  '继续调整',
  '继续交付',
  '查看结果',
] as const;

export type RecentNextActionLabel = (typeof recentNextActionLabels)[number];

/**
 * Authoritative event-source reference for one inbox item.
 * Projection only — never a parallel state store.
 */
export type ActionableInboxEventSource =
  | {
      kind: 'task_terminal';
      taskId: string;
      /** Terminal or recovery-relevant task status. */
      taskStatus: 'completed' | 'failed' | 'acceptance_unknown';
    }
  | {
      kind: 'delivery_event';
      packageId: string;
      eventId: string;
      eventType:
        | 'assisted_handoff_prepared'
        | 'automatic_publish_result'
        | 'manual_publish_result'
        | 'legacy_handoff_event';
      /** Publish / delivery outcome when present on the event. */
      deliveryStatus?: 'published' | 'failed' | 'unknown';
    }
  | {
      kind: 'pending_action';
      pendingActionKind: 'question' | 'approval';
      taskId: string;
      questionOrApprovalRef: string;
    };

/**
 * One actionable inbox / notification item (reference projection).
 *
 * - `needs_choice_or_confirm` carries the original PendingAction for wire compatibility.
 * - Other kinds carry a precise Result Center target (workId + optional lineage keys).
 */
export type ActionableInboxItem = {
  statusKind: ActionableInboxStatusKind;
  /** Effective event time used for sort (ISO datetime). */
  createdAt: string;
  /** Short product title / summary. */
  title: string;
  /** Status-driven single next action label. */
  nextActionLabel: RecentNextActionLabel;
  /**
   * Precise Result Center deep link. Required for all kinds that open results.
   * For needs_choice_or_confirm may be omitted when only PendingAction refs exist.
   */
  target?: ResultTarget;
  eventSource: ActionableInboxEventSource;
  /**
   * Present when statusKind is needs_choice_or_confirm.
   * Preserves PendingAction question|approval wire contract.
   */
  pendingAction?: PendingAction;
  workspaceId?: string;
  /** Optional content package revision for verifiable deep links. */
  contentRevision?: number;
};

export type ActionableInboxItems = ActionableInboxItem[];

/**
 * Recent creation card projection input / output (D-097).
 * Desktop max 6 / mobile max 4 — enforced by pure projector, not UI alone.
 */
export const RECENT_DESKTOP_LIMIT = 6;
export const RECENT_MOBILE_LIMIT = 4;

export type RecentViewport = 'desktop' | 'mobile';

export type RecentMedium = 'copy' | 'image_text' | 'video';

/**
 * Activity source row for Recent projection.
 * Callers assemble from Task / Work / deliveryEvents; projector stays pure.
 */
export type RecentActivitySource = {
  workId: string;
  workspaceId: string;
  title: string;
  medium: RecentMedium;
  /**
   * Result Shell phase (same union as ResultShellPhase).
   * Drives next-action copy.
   */
  phase: 'running' | 'needs_input' | 'ready' | 'failed' | 'delivered';
  /** Most recent effective user-relevant activity (not pure poll ticks). */
  effectiveActivityAt: string;
  contentId?: string;
  versionId?: string;
  panel?: ResultPanel;
  focusKey?: string;
};

export type RecentProjectionItem = {
  workId: string;
  workspaceId: string;
  title: string;
  medium: RecentMedium;
  phase: RecentActivitySource['phase'];
  nextActionLabel: RecentNextActionLabel;
  effectiveActivityAt: string;
  /** Precise Result Center target — never "latest work" guess. */
  target: ResultTarget;
};
