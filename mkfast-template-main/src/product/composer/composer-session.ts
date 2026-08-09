/**
 * Composer conversation session — D-114 AGUI 三层 / ADR-0014 定制创作主容器.
 *
 * Pure model: no React, no fetch, no storage side effects. The container turns
 * the three outbound seam messages (白话进度 / 需要用户的一个问题 / 成品 revision)
 * into an ordered turn list, and keeps `session` as the first-class container.
 *
 * Durable truth stays server-side. The workflow event log replays from the
 * beginning whenever a subscriber connects without `last-event-id`
 * (apps/core/src/server.ts streamWorkflowEvents), so the browser persists only
 * the task handle — never a second copy of the transcript. That is what makes
 * refresh-restore an async re-subscribe rather than a second submit truth
 * (ADR-0014 红线「禁止第二套提交真相」).
 */

import type {
  ContentPackageRevisionDelivery,
  HarnessActiveTask,
  HarnessStage,
  MerchantReport,
  WorkflowProgressEnvelope,
} from '@meiye/contracts';

import type { NotePlanTimeline } from './note-plan-timeline';
import {
  applyBatchImageStatusFromHarnessStage,
  projectNotePlanTimelineFromPreview,
} from './note-plan-timeline';

export const COMPOSER_SESSION_STORAGE_VERSION = 'composer-session/v1';
export const COMPOSER_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export type ComposerSessionPhase =
  | 'idle'
  | 'submitting'
  | 'running'
  | 'awaiting_answer'
  | 'delivered'
  | 'cancelled'
  | 'failed';

/** What the merchant said to start this run. */
export type ComposerMerchantTurn = {
  kind: 'merchant';
  id: string;
  text: string;
};

/**
 * D-111 分流告知. Structurally identified as the `intent_naming` success frame
 * — T11 owns the wording, this container only owns its presentation. Matching
 * on stage instead of on the sentence keeps the seam off T11's copy.
 */
export type ComposerRouteNoticeTurn = {
  kind: 'route_notice';
  id: string;
  sequence: number;
  message: string;
};

/** 白话阶段宣告 (the other four stages). */
export type ComposerStageTurn = {
  kind: 'stage';
  id: string;
  sequence: number;
  stage: HarnessStage;
  message: string;
};

/** 需要用户的一个问题 — rendered as a card with a skip action (D-116). */
export type ComposerQuestionTurn = {
  kind: 'question';
  id: string;
  questionId: string;
};

/**
 * P1-05 / xhs-spec §3.3: paid-media execution_confirm AG-UI interrupt.
 * Distinct from generic `question` so the timeline can hang it as its own
 * DecisionFrame consumer (server interaction card or client cost card).
 */
export type ComposerExecutionConfirmTurn = {
  kind: 'execution_confirm';
  id: string;
  confirmId: string;
};

/**
 * P1-07 / #319: multi-page note outline on the document timeline.
 * Carries the editable outline + per-page image status snapshot.
 */
export type ComposerNotePlanTurn = {
  kind: 'note_plan';
  id: string;
  taskId: string;
  timeline: NotePlanTimeline;
};

/** Streaming candidate area. Exactly one, appended when the task binds. */
export type ComposerCandidateTurn = {
  kind: 'candidate';
  id: string;
  taskId: string;
};

/**
 * 成品交付卡 — the third outbound seam message rendered as a card.
 *
 * `revision` is the ContentPackage revision the workflow actually delivered,
 * taken from the terminal state snapshot. Until that frame lands it is null and
 * the card offers no revision-bound action: an action pointed at a revision the
 * server never confirmed is exactly the second truth ADR-0014 forbids.
 */
export type ComposerDeliveryTurn = {
  kind: 'delivery';
  id: string;
  workId: string;
  taskId: string;
  packageId: string;
  revision: ContentPackageRevisionDelivery | null;
};

export type ComposerTerminalTurn = {
  kind: 'terminal';
  id: string;
  outcome: 'cancelled';
  message: string;
};

/**
 * 申报卡 (P0-2 / D-096 / D-116). A run that failed, or that delivered only part
 * of what it promised, says so in the conversation — 白话原因, 下一步动作, and a
 * way back in. Before this turn existed a failure rendered as nothing at all and
 * the merchant was left with a generic toast.
 *
 * `report` comes from Core on the terminal frame; the browser owns only how it
 * is presented, never what it says.
 */
export type ComposerReportTurn = {
  kind: 'report';
  id: string;
  /** The run this 申报 is about; '' only for a report with no task bound. */
  taskId: string;
  report: MerchantReport;
};

export type ComposerTurn =
  | ComposerMerchantTurn
  | ComposerRouteNoticeTurn
  | ComposerStageTurn
  | ComposerQuestionTurn
  | ComposerExecutionConfirmTurn
  | ComposerNotePlanTurn
  | ComposerCandidateTurn
  | ComposerDeliveryTurn
  | ComposerReportTurn
  | ComposerTerminalTurn;

export type ComposerHarnessTerminal = {
  merchantMessage: string;
  outcome: 'cancelled';
  resolutionSource: 'core_hold_expired';
};

export type ComposerSessionTask = {
  taskId: string;
  workId: string;
  packageId: string;
  /**
   * The paid plan's confirmation authority, handed back by the submit that
   * withheld Make. The commit strip decides it before asking Core to start.
   */
  executionConfirmationRequestId?: string;
};

export type ComposerSession = {
  sessionId: string;
  phase: ComposerSessionPhase;
  task: ComposerSessionTask | null;
  turns: ComposerTurn[];
  /** Highest accepted progress sequence — replayed frames are idempotent. */
  progressSequence: number;
  /**
   * 任务总结 — the 拟人化交付陈述 (策略依据/版本定位/使用建议) core writes as the
   * `assembly_delivery` success message. Held on the session rather than as a
   * stage row so the delivery card can state it next to the deliverable it
   * describes, which is where D-116 puts it.
   */
  deliveryStatement: string | null;
};

export function createComposerSession(sessionId: string): ComposerSession {
  return {
    sessionId,
    phase: 'idle',
    task: null,
    turns: [],
    progressSequence: -1,
    deliveryStatement: null,
  };
}

/**
 * Move the container onto a new attempt while keeping what was said.
 *
 * 报价 and Brief context are idempotent on the session id, so a second attempt
 * needs a new one. Everything the previous run owned goes with it: its task
 * handle, its progress cursor, its 任务总结 and its 申报. The handle in
 * particular is what the event stream keys on — leaving it behind would let the
 * finished run keep writing into a session that is no longer its own.
 *
 * What survives is the conversation: the merchant's sentences stay on screen,
 * because this is the same conversation continuing, not a new one.
 */
export function rebindComposerSession(
  session: ComposerSession,
  sessionId: string
): ComposerSession {
  if (session.sessionId === sessionId) return session;
  return {
    ...session,
    sessionId,
    phase: 'idle',
    task: null,
    progressSequence: -1,
    deliveryStatement: null,
    turns: session.turns.filter(
      // Turns that cannot function once the handle is gone: the candidate area
      // has no stream to fill it, the question card has nowhere to post an
      // answer, execution_confirm has no interaction request to answer, and the
      // 申报 describes a run this container no longer holds.
      // 交付卡 stays — a partial delivery also offers 再生成一次, and throwing
      // away the part that did land would undo the honesty it was built for.
      (turn) =>
        turn.kind !== 'report' &&
        turn.kind !== 'candidate' &&
        turn.kind !== 'question' &&
        turn.kind !== 'execution_confirm'
    ),
  };
}

/** The merchant's sentence opens the run; the send button is the only click. */
export function openComposerTurn(
  session: ComposerSession,
  text: string
): ComposerSession {
  const trimmed = text.trim();
  if (!trimmed) return session;
  // Index keeps React keys unique across multiple merchant sentences in one
  // session (retry / revise-in-place). A bare `:merchant` suffix collides.
  const merchantIndex = session.turns.filter(
    (turn) => turn.kind === 'merchant'
  ).length;
  return {
    ...session,
    phase: 'submitting',
    turns: [
      ...session.turns,
      {
        kind: 'merchant',
        id: `${session.sessionId}:merchant:${merchantIndex}`,
        text: trimmed,
      },
    ],
  };
}

/** Submission accepted: the candidate area appears and streaming may start. */
export function bindComposerTask(
  session: ComposerSession,
  task: ComposerSessionTask
): ComposerSession {
  if (session.task?.taskId === task.taskId) return session;
  return {
    ...session,
    phase: 'running',
    task,
    // Everything below is scoped to the run that produced it, and this is a
    // different run. The new workflow numbers its frames from zero, so keeping
    // the previous cursor would silently drop its entire progress stream; the
    // previous 任务总结 and 申报 likewise describe work this run has not done.
    progressSequence: -1,
    deliveryStatement: null,
    turns: [
      ...session.turns.filter((turn) => turn.kind !== 'report'),
      {
        kind: 'candidate',
        id: `candidate:${task.taskId}`,
        taskId: task.taskId,
      },
    ],
  };
}

function progressTurn(
  frame: WorkflowProgressEnvelope,
  message: string
): ComposerRouteNoticeTurn | ComposerStageTurn {
  if (frame.stage === 'intent_naming' && frame.state === 'success') {
    return {
      kind: 'route_notice',
      id: `progress:${frame.sequence}`,
      sequence: frame.sequence,
      message,
    };
  }
  return {
    kind: 'stage',
    id: `progress:${frame.sequence}`,
    sequence: frame.sequence,
    stage: frame.stage,
    message,
  };
}

/**
 * Fold one 白话进度 frame in. Replay (refresh, reconnect) hands the same
 * sequences back, so older or equal sequences are dropped rather than appended
 * a second time.
 */
export function applyComposerProgress(
  session: ComposerSession,
  frame: WorkflowProgressEnvelope
): ComposerSession {
  if (frame.sequence <= session.progressSequence) return session;
  const next: ComposerSession = {
    ...session,
    progressSequence: frame.sequence,
  };
  // L1-3: mount readonly outline as soon as Core projects notePlanPreview
  // (style_selected / running phase), before delivery hydration.
  const withPlan = mountNotePlanPreviewFromProgress(next, frame);
  // P1-07 / L1-2: batch or per-page image status follows harness stage.
  const withImageStatus = syncNotePlanImageStatusFromProgress(withPlan, frame);
  if (!frame.message) return withImageStatus;
  if (frame.stage === 'assembly_delivery' && frame.state === 'success') {
    // The 任务总结 belongs to the deliverable, not to the progress rail.
    return { ...withImageStatus, deliveryStatement: frame.message };
  }
  const turn = progressTurn(frame, frame.message);
  const candidateIndex = withImageStatus.turns.findIndex(
    (item) => item.kind === 'candidate'
  );
  const turns = [...withImageStatus.turns];
  // Stage announcements read above the candidate area they describe.
  if (candidateIndex === -1) turns.push(turn);
  else turns.splice(candidateIndex, 0, turn);
  return { ...withImageStatus, turns };
}

function mountNotePlanPreviewFromProgress(
  session: ComposerSession,
  frame: WorkflowProgressEnvelope
): ComposerSession {
  const preview = frame.notePlanPreview;
  if (!preview || !session.task?.taskId) return session;
  // Do not clobber a delivered/hydrated plan that already has image assets.
  const existing = session.turns.find(
    (turn): turn is ComposerNotePlanTurn => turn.kind === 'note_plan'
  );
  if (
    existing?.timeline.pages.some(
      (page) => page.imageStatus === 'ready' && page.imageAssetId
    )
  ) {
    return session;
  }
  const timeline = projectNotePlanTimelineFromPreview(preview);
  return applyComposerNotePlan(session, timeline);
}

function syncNotePlanImageStatusFromProgress(
  session: ComposerSession,
  frame: WorkflowProgressEnvelope
): ComposerSession {
  const notePlanIndex = session.turns.findIndex(
    (turn): turn is ComposerNotePlanTurn => turn.kind === 'note_plan'
  );
  if (notePlanIndex === -1) return session;
  const notePlan = session.turns[notePlanIndex] as ComposerNotePlanTurn;
  const nextTimeline = applyBatchImageStatusFromHarnessStage(
    notePlan.timeline,
    {
      stage: frame.stage,
      state: frame.state,
      ...(frame.pageId ? { pageId: frame.pageId } : {}),
    }
  );
  if (nextTimeline === notePlan.timeline) return session;
  const turns = session.turns.slice();
  turns[notePlanIndex] = { ...notePlan, timeline: nextTimeline };
  return { ...session, turns };
}

/**
 * Mount or replace the multi-page note outline frame on the timeline (#319).
 * Inserted above the candidate stream so outline edits read before drafting.
 */
export function applyComposerNotePlan(
  session: ComposerSession,
  timeline: NotePlanTimeline
): ComposerSession {
  const taskId = session.task?.taskId;
  if (!taskId) return session;
  const turn: ComposerNotePlanTurn = {
    kind: 'note_plan',
    id: `note_plan:${taskId}`,
    taskId,
    timeline,
  };
  const existingIndex = session.turns.findIndex(
    (item) => item.kind === 'note_plan'
  );
  if (existingIndex !== -1) {
    const turns = session.turns.slice();
    turns[existingIndex] = turn;
    return { ...session, turns };
  }
  const turns = [...session.turns];
  const candidateIndex = turns.findIndex((item) => item.kind === 'candidate');
  if (candidateIndex === -1) turns.push(turn);
  else turns.splice(candidateIndex, 0, turn);
  return { ...session, turns };
}

/** Patch the mounted note plan timeline (outline edit / regenerate / fixture). */
export function updateComposerNotePlan(
  session: ComposerSession,
  timeline: NotePlanTimeline
): ComposerSession {
  const existingIndex = session.turns.findIndex(
    (item) => item.kind === 'note_plan'
  );
  if (existingIndex === -1) return applyComposerNotePlan(session, timeline);
  const existing = session.turns[existingIndex] as ComposerNotePlanTurn;
  const turns = session.turns.slice();
  turns[existingIndex] = { ...existing, timeline };
  return { ...session, turns };
}

/**
 * Terminal phases that must not be demoted back to awaiting_answer / running
 * by interrupt apply paths.
 */
function isTerminalComposerPhase(phase: ComposerSessionPhase): boolean {
  return phase === 'delivered' || phase === 'cancelled' || phase === 'failed';
}

function upsertInterruptTurn(
  turns: ComposerTurn[],
  turn: ComposerQuestionTurn | ComposerExecutionConfirmTurn
): ComposerTurn[] {
  const kind = turn.kind;
  const next = turns.filter((item) => item.kind !== kind);
  const candidateIndex = next.findIndex((item) => item.kind === 'candidate');
  if (candidateIndex === -1) next.push(turn);
  else next.splice(candidateIndex, 0, turn);
  return next;
}

/**
 * A blocking question is present or cleared. D-116 keeps it non-blocking for
 * the merchant: the card always offers a skip, so the flow moves forward.
 *
 * Prefer `applyComposerPendingInterrupts` from the host when both question and
 * execution_confirm can be live — separate clear paths race on phase.
 */
export function applyComposerQuestion(
  session: ComposerSession,
  questionId: string | null
): ComposerSession {
  if (session.phase === 'failed') {
    return session;
  }
  const existing = session.turns.find(
    (turn): turn is ComposerQuestionTurn => turn.kind === 'question'
  );
  if (!questionId) {
    if (!existing) return session;
    // The cleared question keeps its turn: it anchors the interaction slot,
    // which reads the durable snapshot and shows the settled notice when the
    // system answered by default — erasing the turn would erase that trace.
    // Do not demote phase while a paid-media execution_confirm turn is still
    // the live interrupt (execution_confirm is removed on settle, so presence
    // means still pending).
    const peerConfirmActive = session.turns.some(
      (turn) => turn.kind === 'execution_confirm'
    );
    if (peerConfirmActive) {
      return {
        ...session,
        phase: isTerminalComposerPhase(session.phase)
          ? session.phase
          : 'awaiting_answer',
      };
    }
    return {
      ...session,
      phase: session.phase === 'awaiting_answer' ? 'running' : session.phase,
    };
  }
  if (existing?.questionId === questionId) {
    // Peer may have demoted phase; keep the live interrupt visible as waiting.
    if (
      !isTerminalComposerPhase(session.phase) &&
      session.phase !== 'awaiting_answer'
    ) {
      return { ...session, phase: 'awaiting_answer' };
    }
    return session;
  }
  const turn: ComposerQuestionTurn = {
    kind: 'question',
    id: `question:${questionId}`,
    questionId,
  };
  return {
    ...session,
    phase: isTerminalComposerPhase(session.phase)
      ? session.phase
      : 'awaiting_answer',
    turns: upsertInterruptTurn(session.turns, turn),
  };
}

/**
 * P1-05: paid-media execution_confirm interrupt present or cleared.
 * Cleared turns are removed (no durable settlement notice like question).
 * Prefer `applyComposerPendingInterrupts` when both interrupt kinds can race.
 */
export function applyComposerExecutionConfirm(
  session: ComposerSession,
  confirmId: string | null
): ComposerSession {
  if (session.phase === 'failed') {
    return session;
  }
  const existing = session.turns.find(
    (turn): turn is ComposerExecutionConfirmTurn =>
      turn.kind === 'execution_confirm'
  );
  if (!confirmId) {
    if (!existing) return session;
    // No settlement UI for execution_confirm — drop the turn so the timeline
    // does not keep an empty DecisionFrame after accept/reject resolve.
    // When a live question may also be pending, use applyComposerPendingInterrupts
    // so phase is reconciled against both IDs in one update.
    return {
      ...session,
      turns: session.turns.filter((turn) => turn.kind !== 'execution_confirm'),
      phase: session.phase === 'awaiting_answer' ? 'running' : session.phase,
    };
  }
  if (existing?.confirmId === confirmId) {
    if (
      !isTerminalComposerPhase(session.phase) &&
      session.phase !== 'awaiting_answer'
    ) {
      return { ...session, phase: 'awaiting_answer' };
    }
    return session;
  }
  const turn: ComposerExecutionConfirmTurn = {
    kind: 'execution_confirm',
    id: `execution_confirm:${confirmId}`,
    confirmId,
  };
  return {
    ...session,
    phase: isTerminalComposerPhase(session.phase)
      ? session.phase
      : 'awaiting_answer',
    turns: upsertInterruptTurn(session.turns, turn),
  };
}

/**
 * Atomic apply for question + execution_confirm pending IDs.
 *
 * One setSession avoids the race where clearing a settled question demotes
 * phase to `running` while execution_confirm is still the live hold, and a
 * same-confirmId early-return never restores `awaiting_answer`.
 */
export function applyComposerPendingInterrupts(
  session: ComposerSession,
  pending: {
    questionId: string | null;
    executionConfirmId: string | null;
  }
): ComposerSession {
  if (session.phase === 'failed') {
    return session;
  }
  let turns = session.turns;

  const existingQuestion = turns.find(
    (turn): turn is ComposerQuestionTurn => turn.kind === 'question'
  );
  if (pending.questionId) {
    if (existingQuestion?.questionId !== pending.questionId) {
      turns = upsertInterruptTurn(turns, {
        kind: 'question',
        id: `question:${pending.questionId}`,
        questionId: pending.questionId,
      });
    }
  }
  // Cleared question keeps its turn (settlement-notice anchor).

  const existingConfirm = turns.find(
    (turn): turn is ComposerExecutionConfirmTurn =>
      turn.kind === 'execution_confirm'
  );
  if (pending.executionConfirmId) {
    if (existingConfirm?.confirmId !== pending.executionConfirmId) {
      turns = upsertInterruptTurn(turns, {
        kind: 'execution_confirm',
        id: `execution_confirm:${pending.executionConfirmId}`,
        confirmId: pending.executionConfirmId,
      });
    }
  } else if (existingConfirm) {
    turns = turns.filter((turn) => turn.kind !== 'execution_confirm');
  }

  if (isTerminalComposerPhase(session.phase)) {
    return turns === session.turns ? session : { ...session, turns };
  }

  const hasLiveInterrupt = Boolean(
    pending.questionId || pending.executionConfirmId
  );
  const phase: ComposerSessionPhase = hasLiveInterrupt
    ? 'awaiting_answer'
    : session.phase === 'awaiting_answer'
      ? 'running'
      : session.phase;

  if (turns === session.turns && phase === session.phase) return session;
  return { ...session, phase, turns };
}

/**
 * Terminal workflow state. Success promotes the candidate area into the
 * 成品预览卡 that opens the Result Center on click (ADR-0014: 提交后不跳转).
 */
export function applyComposerWorkflowState(
  session: ComposerSession,
  status: 'waiting' | 'running' | 'suspended' | 'success' | 'failed',
  delivery?: ContentPackageRevisionDelivery,
  terminal?: ComposerHarnessTerminal,
  report?: MerchantReport
): ComposerSession {
  if (status === 'failed') {
    // A failed run leaves the transcript standing and adds the 申报 to it. The
    // candidate area goes: streaming a draft that will never be delivered is
    // the shell of a result the merchant cannot use.
    return withReportTurn(
      {
        ...session,
        phase: 'failed',
        turns: session.turns.filter(
          (turn) =>
            turn.kind !== 'candidate' &&
            turn.kind !== 'question' &&
            turn.kind !== 'execution_confirm'
        ),
      },
      report
    );
  }
  if (status !== 'success') return session;
  const task = session.task;
  if (!task) return session;
  if (terminal?.outcome === 'cancelled') {
    return {
      ...session,
      phase: 'cancelled',
      turns: [
        ...session.turns.filter(
          (turn) =>
            turn.kind !== 'question' &&
            turn.kind !== 'execution_confirm' &&
            turn.kind !== 'delivery' &&
            turn.kind !== 'terminal'
        ),
        {
          id: `terminal:${task.taskId}`,
          kind: 'terminal',
          message: terminal.merchantMessage,
          outcome: 'cancelled',
        },
      ],
    };
  }
  const revision = delivery ?? null;
  const existing = session.turns.find(
    (turn): turn is ComposerDeliveryTurn =>
      turn.kind === 'delivery' && turn.taskId === task.taskId
  );
  if (existing) {
    // A late state frame may be the one that carries the revision — bind it,
    // but never downgrade a revision already confirmed.
    if (!revision || existing.revision) {
      return withReportTurn({ ...session, phase: 'delivered' }, report);
    }
    return withReportTurn(
      {
        ...session,
        phase: 'delivered',
        turns: session.turns.map((turn) =>
          turn.kind === 'delivery' && turn.taskId === task.taskId
            ? { ...turn, revision }
            : turn
        ),
      },
      report
    );
  }
  return withReportTurn(
    {
      ...session,
      phase: 'delivered',
      // The question turn stays through delivery: it anchors the interaction
      // slot that reports how the question settled (see applyComposerQuestion).
      turns: [
        ...session.turns,
        {
          kind: 'delivery',
          id: `delivery:${task.workId}`,
          workId: task.workId,
          taskId: task.taskId,
          packageId: task.packageId,
          revision,
        },
      ],
    },
    report
  );
}

/**
 * Append the 申报 exactly once *per run*. Replay hands the same terminal frame
 * back on every reconnect, and a transcript that grows a second failure card
 * each time the browser reconnects would be its own kind of dishonesty — but
 * the run is part of that identity. Two attempts that fail the same way are two
 * failures, and showing the first one's report over the second's is the same
 * lie in the other direction.
 */
function withReportTurn(
  session: ComposerSession,
  report: MerchantReport | undefined
): ComposerSession {
  if (!report) return session;
  const taskId = session.task?.taskId ?? '';
  const existing = session.turns.find(
    (turn): turn is ComposerReportTurn => turn.kind === 'report'
  );
  if (existing?.taskId === taskId && existing.report.kind === report.kind) {
    return session;
  }
  return {
    ...session,
    turns: [
      ...session.turns.filter((turn) => turn.kind !== 'report'),
      { kind: 'report', id: `report:${taskId}:${report.kind}`, report, taskId },
    ],
  };
}

/** Submission rejected before a task existed — the merchant turn survives. */
export function failComposerSession(session: ComposerSession): ComposerSession {
  return { ...session, phase: 'failed' };
}

/**
 * The sentence the current run is about. A conversation that survived a failure
 * carries more than one merchant turn (their first ask, then the rewrite), and
 * the handle this pairs with — persisted or restored — belongs to the latest.
 */
export function composerSessionMerchantText(session: ComposerSession): string {
  const turn = session.turns
    .filter((item): item is ComposerMerchantTurn => item.kind === 'merchant')
    .at(-1);
  return turn?.text ?? '';
}

/**
 * Persisted handle. Deliberately *not* the transcript: replaying the server
 * event log is what restores turns, so a stale browser copy can never disagree
 * with the workflow.
 */
export type PersistedComposerSession = {
  schema: typeof COMPOSER_SESSION_STORAGE_VERSION;
  sessionId: string;
  updatedAt: string;
  merchantText: string;
  task: ComposerSessionTask;
};

export const COMPOSER_SESSION_STORAGE_KEY = `composer-session::${COMPOSER_SESSION_STORAGE_VERSION}`;

export function serializeComposerSession(
  session: ComposerSession,
  nowIso: string
): PersistedComposerSession | null {
  if (!session.task) return null;
  return {
    schema: COMPOSER_SESSION_STORAGE_VERSION,
    sessionId: session.sessionId,
    updatedAt: nowIso,
    merchantText: composerSessionMerchantText(session),
    task: session.task,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function parseTask(value: unknown): ComposerSessionTask | null {
  if (!isRecord(value)) return null;
  const { taskId, workId, packageId, executionConfirmationRequestId } = value;
  if (
    typeof taskId !== 'string' ||
    typeof workId !== 'string' ||
    typeof packageId !== 'string' ||
    !taskId ||
    !workId ||
    !packageId
  ) {
    return null;
  }
  return {
    taskId,
    workId,
    packageId,
    // Restored so a reloaded tab can still confirm the plan it is looking at.
    ...(typeof executionConfirmationRequestId === 'string' &&
    executionConfirmationRequestId
      ? { executionConfirmationRequestId }
      : {}),
  };
}

/**
 * 时间桥 (D-145). The same rebuild as the sessionStorage restore, but from the
 * server's own list of runs still in flight — which is why closing the tab is no
 * longer a way to lose the conversation. The browser handle was never the truth;
 * this makes that literal.
 */
export function restoreComposerSessionFromActiveTask(input: {
  sessionId: string;
  task: HarnessActiveTask;
}): ComposerSession {
  const opened = openComposerTurn(
    createComposerSession(input.sessionId),
    input.task.merchantText
  );
  return bindComposerTask(opened, {
    taskId: input.task.taskId,
    workId: input.task.workId,
    packageId: input.task.packageId,
  });
}

export type RestoreComposerSessionResult =
  | { kind: 'restored'; session: ComposerSession }
  | { kind: 'missing' | 'expired' | 'invalid_data' };

/**
 * Rebuild the container from the persisted handle. The returned session carries
 * the merchant turn and the candidate area only — progress, questions and the
 * delivery card come back from the replayed event stream.
 */
export function restoreComposerSession(input: {
  raw: string | null;
  nowIso: string;
}): RestoreComposerSessionResult {
  if (input.raw === null) return { kind: 'missing' };
  let value: unknown;
  try {
    value = JSON.parse(input.raw);
  } catch {
    return { kind: 'invalid_data' };
  }
  if (
    !isRecord(value) ||
    value.schema !== COMPOSER_SESSION_STORAGE_VERSION ||
    typeof value.sessionId !== 'string' ||
    !value.sessionId ||
    typeof value.updatedAt !== 'string' ||
    typeof value.merchantText !== 'string'
  ) {
    return { kind: 'invalid_data' };
  }
  const task = parseTask(value.task);
  if (!task) return { kind: 'invalid_data' };

  const updatedMs = Date.parse(value.updatedAt);
  const nowMs = Date.parse(input.nowIso);
  if (!Number.isFinite(updatedMs) || !Number.isFinite(nowMs)) {
    return { kind: 'invalid_data' };
  }
  if (nowMs - updatedMs > COMPOSER_SESSION_TTL_MS) return { kind: 'expired' };

  const opened = openComposerTurn(
    createComposerSession(value.sessionId),
    value.merchantText
  );
  return { kind: 'restored', session: bindComposerTask(opened, task) };
}
