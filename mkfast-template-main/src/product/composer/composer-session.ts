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

import type { HarnessStage, WorkflowProgressEnvelope } from '@meiye/contracts';

export const COMPOSER_SESSION_STORAGE_VERSION = 'composer-session/v1';
export const COMPOSER_SESSION_TTL_MS = 24 * 60 * 60 * 1000;

export type ComposerSessionPhase =
  | 'idle'
  | 'submitting'
  | 'running'
  | 'awaiting_answer'
  | 'delivered'
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

/** Streaming candidate area. Exactly one, appended when the task binds. */
export type ComposerCandidateTurn = {
  kind: 'candidate';
  id: string;
  taskId: string;
};

/** 成品预览卡 — clicking it is what opens the Result Center. */
export type ComposerDeliveryTurn = {
  kind: 'delivery';
  id: string;
  workId: string;
  taskId: string;
  packageId: string;
};

export type ComposerTurn =
  | ComposerMerchantTurn
  | ComposerRouteNoticeTurn
  | ComposerStageTurn
  | ComposerQuestionTurn
  | ComposerCandidateTurn
  | ComposerDeliveryTurn;

export type ComposerSessionTask = {
  taskId: string;
  workId: string;
  packageId: string;
};

export type ComposerSession = {
  sessionId: string;
  phase: ComposerSessionPhase;
  task: ComposerSessionTask | null;
  turns: ComposerTurn[];
  /** Highest accepted progress sequence — replayed frames are idempotent. */
  progressSequence: number;
};

export function createComposerSession(sessionId: string): ComposerSession {
  return {
    sessionId,
    phase: 'idle',
    task: null,
    turns: [],
    progressSequence: -1,
  };
}

/** The merchant's sentence opens the run; the send button is the only click. */
export function openComposerTurn(
  session: ComposerSession,
  text: string
): ComposerSession {
  const trimmed = text.trim();
  if (!trimmed) return session;
  return {
    ...session,
    phase: 'submitting',
    turns: [
      ...session.turns,
      { kind: 'merchant', id: `${session.sessionId}:merchant`, text: trimmed },
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
    turns: [
      ...session.turns,
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
  if (!frame.message) return next;
  const turn = progressTurn(frame, frame.message);
  const candidateIndex = next.turns.findIndex(
    (item) => item.kind === 'candidate'
  );
  const turns = [...next.turns];
  // Stage announcements read above the candidate area they describe.
  if (candidateIndex === -1) turns.push(turn);
  else turns.splice(candidateIndex, 0, turn);
  return { ...next, turns };
}

/**
 * A blocking question is present or cleared. D-116 keeps it non-blocking for
 * the merchant: the card always offers a skip, so the flow moves forward.
 */
export function applyComposerQuestion(
  session: ComposerSession,
  questionId: string | null
): ComposerSession {
  const existing = session.turns.find(
    (turn): turn is ComposerQuestionTurn => turn.kind === 'question'
  );
  if (!questionId) {
    if (!existing) return session;
    return {
      ...session,
      phase: session.phase === 'awaiting_answer' ? 'running' : session.phase,
      turns: session.turns.filter((turn) => turn.kind !== 'question'),
    };
  }
  if (existing?.questionId === questionId) return session;
  const turns: ComposerTurn[] = session.turns.filter(
    (turn) => turn.kind !== 'question'
  );
  const candidateIndex = turns.findIndex((turn) => turn.kind === 'candidate');
  const turn: ComposerQuestionTurn = {
    kind: 'question',
    id: `question:${questionId}`,
    questionId,
  };
  if (candidateIndex === -1) turns.push(turn);
  else turns.splice(candidateIndex, 0, turn);
  return { ...session, phase: 'awaiting_answer', turns };
}

/**
 * Terminal workflow state. Success promotes the candidate area into the
 * 成品预览卡 that opens the Result Center on click (ADR-0014: 提交后不跳转).
 */
export function applyComposerWorkflowState(
  session: ComposerSession,
  status: 'waiting' | 'running' | 'suspended' | 'success' | 'failed'
): ComposerSession {
  if (status === 'failed') return { ...session, phase: 'failed' };
  if (status !== 'success') return session;
  const task = session.task;
  if (!task) return session;
  if (session.turns.some((turn) => turn.kind === 'delivery')) {
    return { ...session, phase: 'delivered' };
  }
  return {
    ...session,
    phase: 'delivered',
    turns: [
      ...session.turns.filter((turn) => turn.kind !== 'question'),
      {
        kind: 'delivery',
        id: `delivery:${task.workId}`,
        workId: task.workId,
        taskId: task.taskId,
        packageId: task.packageId,
      },
    ],
  };
}

/** Submission rejected before a task existed — the merchant turn survives. */
export function failComposerSession(session: ComposerSession): ComposerSession {
  return { ...session, phase: 'failed' };
}

export function composerSessionMerchantText(session: ComposerSession): string {
  const turn = session.turns.find(
    (item): item is ComposerMerchantTurn => item.kind === 'merchant'
  );
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
  const { taskId, workId, packageId } = value;
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
  return { taskId, workId, packageId };
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
