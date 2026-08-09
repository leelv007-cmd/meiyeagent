/**
 * Mid-run steering (V31-27 / V3.1 §5.6 / §23.3 / §24 / §37.4-G).
 *
 * Pure model behind the merchant's 中途指令 entry: when the entry may exist,
 * what unit progress Core is told about, and how Core's classification reads
 * back as 影响范围.
 *
 * The classification, the impact sentence and the affected/preserved split all
 * come from Core (`agent-session.steering_submit`). Nothing here decides which
 * pages change or whether a run costs more — a browser that guessed either
 * would be a second truth next to the Make queue.
 */

import type {
  MakeSteeringCommand,
  SteeringClassification,
} from '@meiye/contracts';

import type { ComposerSessionPhase } from './composer-session';

export type SteeringApplicationStatus =
  | 'accepted'
  | 'queued_steer'
  | 'queued_follow_up'
  | 'requires_replan_confirm'
  | 'rejected_unsafe'
  | 'disabled';

export type SteeringNextAction =
  | 'apply_patch'
  | 'queue_wait'
  | 'create_derived_revision'
  | 'replan_requote_confirm'
  | 'ask_merchant_correct'
  | 'disabled';

/** `agent-session.steering_submit` result (Core owns every field). */
export type SteeringSubmitResult = {
  command: MakeSteeringCommand;
  classification: SteeringClassification;
  queueMode: 'steer' | 'follow_up';
  applicationStatus: SteeringApplicationStatus;
  impactSummary: string;
  preservedUnitIds: string[];
  affectedUnitIds: string[];
  /** Core-owned scope + credit projection. */
  impact: SteeringImpactProjection;
  nextAction: SteeringNextAction;
  replayed: boolean;
};

/** `agent-session.list_steering_commands` row. */
export type StoredSteeringCommandView = {
  command: MakeSteeringCommand;
  applicationStatus: SteeringApplicationStatus;
  impactSummary: string;
};

/** `agent-session.steering_gate` — make_steering_v1 + disable_make_steering. */
export type SteeringGate = {
  enabled: boolean;
  reason: 'enabled' | 'feature_flag_off' | 'kill_switch';
};

/**
 * Phases in which a run can still be steered. Idle has no run, and delivered /
 * cancelled / failed have nothing left to redirect — offering the entry there
 * would promise an interruption that cannot land anywhere.
 */
const STEERABLE_PHASES: ReadonlySet<ComposerSessionPhase> = new Set([
  'running',
  'awaiting_answer',
]);

export function isSteeringEntryVisible(input: {
  phase: ComposerSessionPhase;
  taskId: string | null | undefined;
  /** `steering_gate.enabled`; false while the kill switch is on. */
  gateEnabled: boolean;
}): boolean {
  if (!input.gateEnabled) return false;
  if (!input.taskId) return false;
  return STEERABLE_PHASES.has(input.phase);
}

/**
 * Core's scope + credit projection (`steering_submit.impact`).
 *
 * Every field is server-owned. The browser used to derive `rebilled` and the
 * fee sentence from the page labels it happened to be rendering, which made the
 * money answer a second opinion next to the Make queue — and it read the
 * confirmation-gate suspension as work already in flight, telling the merchant
 * a free edit would cost credits (live-caught 2026-08-09).
 */
export type SteeringImpactProjection = {
  /** 哪些页会改. */
  affectedLabels: string[];
  /** 哪些页保持不变. */
  preservedLabels: string[];
  /** True when the change produces a fresh billable generation. */
  rebilled: boolean;
  /** Affected units whose upstream call already went out. */
  alreadyInvokedUnitIds: string[];
  /** plan_change → the merchant confirms a new quote before Make continues. */
  requiresRequote: boolean;
  /** unsafe_or_conflicting → explain, then let the merchant rewrite. */
  requiresCorrection: boolean;
  /** 费用是否变化 — 积分口径, never upstream provider cost (D-061). */
  feeNote: string;
  /** 已发生的调用照常计费、不退免. */
  settledNote: string | null;
  /** Queued behind the current unit / the whole run (dual queue). */
  queueNote: string | null;
};

export type SteeringImpactView = SteeringImpactProjection & {
  kind: SteeringClassification['kind'];
  /** Core's merchant-facing impact line, rendered verbatim. */
  summary: string;
};

/**
 * Read Core's answer. Nothing is recomputed here: a browser that recalculated
 * scope or credits would be inventing a second truth about the merchant's run.
 */
export function projectSteeringImpact(input: {
  result: SteeringSubmitResult;
}): SteeringImpactView {
  return {
    ...input.result.impact,
    kind: input.result.classification.kind,
    summary: input.result.impactSummary,
  };
}

const STATUS_LABELS: Record<SteeringApplicationStatus, string> = {
  accepted: '已应用',
  queued_steer: '当前这步做完就改',
  queued_follow_up: '整套做完再处理',
  requires_replan_confirm: '等你确认新方案',
  rejected_unsafe: '没执行，需要你改一下说法',
  disabled: '中途调整当前不可用',
};

export type SteeringCommandHistoryItem = {
  commandId: string;
  instruction: string;
  statusLabel: string;
  impactSummary: string;
  createdAt: string;
};

/**
 * Restored-session history. The commands are durable on Core, so reopening the
 * conversation shows what was asked mid-run and where each request landed.
 */
export function projectSteeringHistory(
  rows: readonly StoredSteeringCommandView[]
): SteeringCommandHistoryItem[] {
  return rows.map((row) => ({
    commandId: row.command.commandId,
    instruction: row.command.instruction,
    statusLabel: STATUS_LABELS[row.applicationStatus],
    impactSummary: row.impactSummary,
    createdAt: row.command.createdAt,
  }));
}
