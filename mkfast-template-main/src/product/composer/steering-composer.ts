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
import type { NotePlanTimeline } from './note-plan-timeline';

/** Unit progress Core classifies against (steering_submit `units`). */
export type SteeringUnitProgress = {
  unitId: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  label?: string;
  pageIndex?: number;
};

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

const IMAGE_STATUS_TO_UNIT_STATUS: Record<
  NotePlanTimeline['pages'][number]['imageStatus'],
  SteeringUnitProgress['status']
> = {
  pending: 'pending',
  generating: 'running',
  ready: 'completed',
  failed: 'failed',
};

/**
 * Note pages as Make units. The outline is Core's own projection
 * (`notePlanPreview` → note-plan timeline), so naming 封面 / 第N页 here is
 * relabelling what the merchant already sees, not inventing a plan.
 *
 * Without an outline the list is empty and Core answers 「无法确定影响范围」 —
 * which is the honest reply, and the one that asks the merchant to name a page.
 */
export function steeringUnitsFromNotePlan(
  timeline: NotePlanTimeline | null | undefined,
  options: {
    /**
     * False while the run still holds on the paid-media execution_confirm.
     *
     * The outline turns every page 「配图中」 as soon as `execution_selection`
     * reports `suspended`, and that suspension *is* the confirmation gate — the
     * quote and the usage reservation are what it is waiting on, so not one
     * provider call has gone out. Reading that label as work-in-flight would
     * tell the merchant her free edit costs credits (live-caught 2026-08-09).
     *
     * Defaults to true: assuming a call already happened is the safe error,
     * since the opposite direction promises a change is free and then bills it.
     */
    generationStarted?: boolean;
  } = {}
): SteeringUnitProgress[] {
  if (!timeline) return [];
  const started = options.generationStarted ?? true;
  return timeline.pages.map((page) => {
    const cover = page.pageRole === 'cover' || page.order === 1;
    return {
      unitId: page.pageId,
      status: started
        ? IMAGE_STATUS_TO_UNIT_STATUS[page.imageStatus]
        : 'pending',
      label: cover ? '封面' : `第${page.order}页`,
      pageIndex: Math.max(0, page.order - 1),
    };
  });
}

export type SteeringImpactView = {
  kind: SteeringClassification['kind'];
  /** Core's merchant-facing impact line, rendered verbatim. */
  summary: string;
  /** 哪些页会改. */
  affectedLabels: string[];
  /** 哪些页保持不变. */
  preservedLabels: string[];
  /** 费用是否变化 — 积分口径, never upstream provider cost (D-061). */
  feeNote: string;
  /**
   * True when the change produces a fresh billable generation: a 修改对象 for
   * already-generated units. False only for a pure future_step_patch whose
   * units have not been sent upstream yet.
   */
  rebilled: boolean;
  /** 已发生的调用照常计费、不回滚 — only when something was already sent. */
  settledNote: string | null;
  /** plan_change → the merchant confirms a new quote before Make continues. */
  requiresRequote: boolean;
  /** unsafe_or_conflicting → explain, then let the merchant rewrite. */
  requiresCorrection: boolean;
  /** Queued behind the current unit / the whole run (dual queue). */
  queueNote: string | null;
};

function labelFor(
  unitId: string,
  units: readonly SteeringUnitProgress[]
): string {
  const unit = units.find((item) => item.unitId === unitId);
  if (unit?.label) return unit.label;
  if (typeof unit?.pageIndex === 'number') {
    return unit.pageIndex === 0 ? '封面' : `第${unit.pageIndex + 1}页`;
  }
  return '这一步';
}

const QUEUE_NOTES: Partial<Record<SteeringApplicationStatus, string>> = {
  queued_steer: '当前这一步做完就按你的话改。',
  queued_follow_up: '整套做完之后再按你的话处理。',
};

/**
 * A unit whose upstream call has already gone out. Steering never rolls one
 * back and never refunds it (Core's PROVIDER_SIDE_EFFECT_IMMUTABLE: accepted /
 * acceptance_unknown attempts may only be derived from or retried), so changing
 * it means paying for a second generation.
 *
 * `pending` is the only status that has not been sent — the note outline sets
 * every page pending at brief_compilation and only `execution_selection` moves
 * a page to generating / ready / failed.
 */
function alreadyInvoked(unit: SteeringUnitProgress | undefined): boolean {
  return unit !== undefined && unit.status !== 'pending';
}

export function projectSteeringImpact(input: {
  result: SteeringSubmitResult;
  units: readonly SteeringUnitProgress[];
  /**
   * Server-priced credits for the re-generation, when Core supplies one.
   * Absent means the sentence names the rule and omits the number: printing a
   * figure the server never sent is a claim about the merchant's balance made
   * from missing data (same rule as `execution-cost-feedback`).
   */
  rebillCredits?: number | null;
}): SteeringImpactView {
  const { result, units } = input;
  const kind = result.classification.kind;
  const affectedLabels = result.affectedUnitIds.map((id) =>
    labelFor(id, units)
  );
  const preservedLabels = result.preservedUnitIds.map((id) =>
    labelFor(id, units)
  );
  const requiresRequote = kind === 'plan_change';
  const requiresCorrection = kind === 'unsafe_or_conflicting';

  const invokedAffected = result.affectedUnitIds.filter((id) =>
    alreadyInvoked(units.find((unit) => unit.unitId === id))
  );
  // derived_revision is by definition a change to finished units; a
  // future_step_patch is only free while none of its units have been sent.
  const rebilled =
    !requiresRequote &&
    !requiresCorrection &&
    (kind === 'derived_revision' || invokedAffected.length > 0);

  const target =
    affectedLabels.length > 0 ? affectedLabels.join('、') : '改动的页';
  const keepNote = preservedLabels.length > 0 ? '；其余页不动，不另算积分' : '';
  const amount =
    typeof input.rebillCredits === 'number' && input.rebillCredits > 0
      ? `并计 ${input.rebillCredits} 积分`
      : '，按正常生成一样算积分';

  const feeNote = requiresCorrection
    ? ''
    : requiresRequote
      ? '这次改动会动到方案范围，积分要重新算一次，确认后才继续。'
      : rebilled
        ? `${target}会按你的改法重新生成${amount}${keepNote}。`
        : `${target}还没开始做，直接按你的话调整，不额外算积分${keepNote ? '；其余页也不受影响' : ''}。`;

  return {
    kind,
    summary: result.impactSummary,
    affectedLabels,
    preservedLabels,
    feeNote,
    rebilled,
    settledNote: rebilled
      ? '之前已经生成的那次照常计费、不退回，原来那版也会留着。'
      : null,
    requiresRequote,
    requiresCorrection,
    queueNote: QUEUE_NOTES[result.applicationStatus] ?? null,
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
