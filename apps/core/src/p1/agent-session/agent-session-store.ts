/**
 * AgentThread / AgentRun persistence seam (V31-02).
 *
 * Authority: V3.1 §9 (Thread), §10 (Run + durability), §27.6 (U6 single active
 * write turn with sessionRevision OCC), §33.1 (p1_agent_threads / p1_agent_runs),
 * §33.2 (lazy legacy thread, zero migration of historical Work).
 *
 * One implementation carries both canonical writers of the ownership matrix
 * (`AgentThreadStore` + `AgentRunStore`): starting a write turn must bump
 * sessionRevision and create the run in one transaction, so splitting them into
 * two stores would need a distributed invariant instead of a local one.
 *
 * Contracts are consumed from @meiye/contracts (V31-01) and never redefined.
 */

import {
  AGENT_RUN_SCHEMA_VERSION,
  AGENT_THREAD_SCHEMA_VERSION,
  agentRunSchema,
  agentThreadSchema,
  type AgentRunRecord,
  type AgentThread,
} from '@meiye/contracts';

export type AgentRunTrigger = AgentRunRecord['trigger'];
export type AgentRunStatus = AgentRunRecord['status'];

/**
 * A write turn is an `exit` run in these states (U6). A `sync` child keeps
 * running in the durable runtime after its turn ends and never locks the
 * thread — steering, not turn arbitration, is how a merchant intervenes there.
 */
export const AGENT_ACTIVE_RUN_STATUSES = ['running', 'waiting'] as const;
export const AGENT_TERMINAL_RUN_STATUSES = [
  'completed',
  'failed',
  'cancelled',
] as const;

export function isActiveRunStatus(status: AgentRunStatus): boolean {
  return (AGENT_ACTIVE_RUN_STATUSES as readonly string[]).includes(status);
}

export function isTerminalRunStatus(status: AgentRunStatus): boolean {
  return (AGENT_TERMINAL_RUN_STATUSES as readonly string[]).includes(status);
}

export type AgentSessionErrorCode =
  | 'AGENT_THREAD_NOT_FOUND'
  | 'AGENT_THREAD_ID_TAKEN'
  | 'AGENT_RUN_NOT_FOUND'
  | 'AGENT_SESSION_REVISION_CONFLICT'
  | 'AGENT_ACTIVE_TURN_CONFLICT'
  | 'AGENT_RUN_LINK_CONFLICT'
  | 'AGENT_RUN_STATE_CONFLICT'
  | 'AGENT_RUN_STATE_INVALID';

const AGENT_SESSION_ERROR_STATUSES: Record<AgentSessionErrorCode, number> = {
  AGENT_THREAD_NOT_FOUND: 404,
  AGENT_THREAD_ID_TAKEN: 409,
  AGENT_RUN_NOT_FOUND: 404,
  AGENT_SESSION_REVISION_CONFLICT: 409,
  AGENT_ACTIVE_TURN_CONFLICT: 409,
  AGENT_RUN_LINK_CONFLICT: 409,
  AGENT_RUN_STATE_CONFLICT: 409,
  AGENT_RUN_STATE_INVALID: 400,
};

/**
 * Shaped for `toHttpError`: code + status + details travel into the API error
 * envelope, so a 409 carries the current sessionRevision without a second read.
 */
export class AgentSessionError extends Error {
  readonly status: number;

  constructor(
    readonly code: AgentSessionErrorCode,
    message: string,
    readonly details: Record<string, unknown>,
  ) {
    super(message);
    this.name = 'AgentSessionError';
    this.status = AGENT_SESSION_ERROR_STATUSES[code];
  }
}

export type CreateAgentThreadInput = {
  resourceId: string;
  threadId: string;
  title: string;
  now: string;
  activeGoalIds?: readonly string[];
};

export type OpenLegacyWorkThreadInput = {
  resourceId: string;
  /** Historical Work opened for the first time; never written back to (§33.2). */
  legacyWorkId: string;
  threadId: string;
  title: string;
  now: string;
};

export type LegacyWorkThreadOpen = {
  thread: AgentThread;
  created: boolean;
};

export type StartWriteTurnInput = {
  resourceId: string;
  threadId: string;
  expectedSessionRevision: number;
  runId: string;
  trigger: AgentRunTrigger;
  harnessReleaseId: string;
  now: string;
};

export type AgentWriteTurn = {
  thread: AgentThread;
  run: AgentRunRecord;
};

export type LinkExecutionRunInput = {
  resourceId: string;
  parentRunId: string;
  runId: string;
  workflowId: string;
  snapshotHash: string;
  now: string;
};

export type ExecutionRunLink = {
  run: AgentRunRecord;
  /** True when the crash window replayed a link that already exists. */
  replayed: boolean;
};

export type UpdateAgentRunStatusInput = {
  resourceId: string;
  runId: string;
  status: AgentRunStatus;
  finishedAt?: string;
};

export type RecordThreadSummaryInput = {
  resourceId: string;
  threadId: string;
  summary: string;
  now: string;
};

export interface AgentSessionStore {
  createThread(input: CreateAgentThreadInput): Promise<AgentThread>;
  /** Lazy legacy thread: idempotent per (resourceId, legacyWorkId). */
  openLegacyWorkThread(
    input: OpenLegacyWorkThreadInput,
  ): Promise<LegacyWorkThreadOpen>;
  getThread(input: {
    resourceId: string;
    threadId: string;
  }): Promise<AgentThread | null>;
  /** `/dashboard/recent` projection: most recently active thread first. */
  listRecentThreads(input: {
    resourceId: string;
    limit?: number;
  }): Promise<AgentThread[]>;
  /** CAS on sessionRevision + single active turn; creates the `exit` run. */
  startWriteTurn(input: StartWriteTurnInput): Promise<AgentWriteTurn>;
  /** Handoff to durable execution: `sync` child run, one per parent turn. */
  linkExecutionRun(input: LinkExecutionRunInput): Promise<ExecutionRunLink>;
  updateRunStatus(input: UpdateAgentRunStatusInput): Promise<AgentRunRecord>;
  getRun(input: {
    resourceId: string;
    runId: string;
  }): Promise<AgentRunRecord | null>;
  listRuns(input: {
    resourceId: string;
    threadId: string;
  }): Promise<AgentRunRecord[]>;
  /** Summary compaction bumps summaryRevision only — never arbitrates writes. */
  recordThreadSummary(input: RecordThreadSummaryInput): Promise<AgentThread>;
}

export function newAgentThread(input: CreateAgentThreadInput): AgentThread {
  return agentThreadSchema.parse({
    schemaVersion: AGENT_THREAD_SCHEMA_VERSION,
    threadId: input.threadId,
    resourceId: input.resourceId,
    title: input.title,
    status: 'active',
    activeGoalIds: input.activeGoalIds ?? [],
    summaryRevision: 0,
    sessionRevision: 0,
    createdAt: input.now,
    updatedAt: input.now,
  });
}

/** Session turns are always `exit`; paid effects arrive as a `sync` child run. */
export function newWriteTurnRun(input: StartWriteTurnInput): AgentRunRecord {
  return agentRunSchema.parse({
    schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    runId: input.runId,
    threadId: input.threadId,
    trigger: input.trigger,
    status: 'running',
    durability: 'exit',
    harnessReleaseId: input.harnessReleaseId,
    startedAt: input.now,
  });
}

export function newExecutionChildRun(
  parent: AgentRunRecord,
  input: LinkExecutionRunInput,
): AgentRunRecord {
  if (parent.durability !== 'exit') {
    throw new AgentSessionError(
      'AGENT_RUN_LINK_CONFLICT',
      `Run ${parent.runId} is already a sync execution run and cannot own a child.`,
      { parentRunId: parent.runId, parentDurability: parent.durability },
    );
  }
  return agentRunSchema.parse({
    schemaVersion: AGENT_RUN_SCHEMA_VERSION,
    runId: input.runId,
    threadId: parent.threadId,
    parentRunId: parent.runId,
    trigger: parent.trigger,
    status: 'running',
    durability: 'sync',
    harnessReleaseId: parent.harnessReleaseId,
    executionLink: {
      workflowId: input.workflowId,
      snapshotHash: input.snapshotHash,
    },
    startedAt: input.now,
  });
}

/** A thread id already used by another resource must never be reachable. */
export function threadIdTaken(threadId: string): AgentSessionError {
  return new AgentSessionError(
    'AGENT_THREAD_ID_TAKEN',
    `Agent thread ${threadId} already exists for another resource.`,
    { threadId },
  );
}

export function assertThreadFound(
  thread: AgentThread | null,
  threadId: string,
): AgentThread {
  if (!thread) {
    throw new AgentSessionError(
      'AGENT_THREAD_NOT_FOUND',
      `Agent thread ${threadId} does not exist for this resource.`,
      { threadId },
    );
  }
  return thread;
}

/** U6 arbitration: stale revision or an in-flight turn both answer 409. */
export function assertWriteTurnAdmissible(
  thread: AgentThread,
  expectedSessionRevision: number,
  activeRun: AgentRunRecord | null,
): void {
  if (thread.sessionRevision !== expectedSessionRevision) {
    throw new AgentSessionError(
      'AGENT_SESSION_REVISION_CONFLICT',
      `Agent thread ${thread.threadId} moved to session revision ${thread.sessionRevision}.`,
      {
        threadId: thread.threadId,
        expectedSessionRevision,
        currentSessionRevision: thread.sessionRevision,
      },
    );
  }
  if (activeRun) {
    throw new AgentSessionError(
      'AGENT_ACTIVE_TURN_CONFLICT',
      `Agent thread ${thread.threadId} already has an active write turn.`,
      {
        threadId: thread.threadId,
        currentSessionRevision: thread.sessionRevision,
        activeRunId: activeRun.runId,
      },
    );
  }
}

export function threadWithStartedTurn(
  thread: AgentThread,
  now: string,
): AgentThread {
  return agentThreadSchema.parse({
    ...thread,
    sessionRevision: thread.sessionRevision + 1,
    lastRunAt: now,
    updatedAt: now,
  });
}

export function threadWithSummary(
  thread: AgentThread,
  summary: string,
  now: string,
): AgentThread {
  return agentThreadSchema.parse({
    ...thread,
    summary,
    summaryRevision: thread.summaryRevision + 1,
    updatedAt: now,
  });
}

/**
 * Crash-window replay: an identical link returns the stored child run, a
 * different execution for the same parent turn is refused.
 */
export function resolveExecutionRunReplay(
  existingChild: AgentRunRecord,
  input: LinkExecutionRunInput,
): ExecutionRunLink {
  const link = existingChild.executionLink;
  if (
    link?.workflowId === input.workflowId &&
    link.snapshotHash === input.snapshotHash
  ) {
    return { run: existingChild, replayed: true };
  }
  throw new AgentSessionError(
    'AGENT_RUN_LINK_CONFLICT',
    `Run ${input.parentRunId} already links execution ${link?.workflowId ?? 'unknown'}.`,
    {
      parentRunId: input.parentRunId,
      runId: existingChild.runId,
      currentWorkflowId: link?.workflowId,
      currentSnapshotHash: link?.snapshotHash,
    },
  );
}

/**
 * Only status and finishedAt move. durability and executionLink are absent from
 * the result by construction, which is how "immutable after create" holds.
 */
export function runWithStatus(
  run: AgentRunRecord,
  input: UpdateAgentRunStatusInput,
): AgentRunRecord {
  const terminal = isTerminalRunStatus(input.status);
  if (terminal && !input.finishedAt) {
    throw new AgentSessionError(
      'AGENT_RUN_STATE_INVALID',
      `Terminal status ${input.status} requires finishedAt.`,
      { runId: input.runId, status: input.status },
    );
  }
  if (!terminal && input.finishedAt) {
    throw new AgentSessionError(
      'AGENT_RUN_STATE_INVALID',
      `Non-terminal status ${input.status} must not carry finishedAt.`,
      { runId: input.runId, status: input.status },
    );
  }
  if (isTerminalRunStatus(run.status)) {
    if (run.status === input.status && run.finishedAt === input.finishedAt) {
      return run;
    }
    throw new AgentSessionError(
      'AGENT_RUN_STATE_CONFLICT',
      `Run ${run.runId} already finished as ${run.status}.`,
      {
        runId: run.runId,
        currentStatus: run.status,
        requestedStatus: input.status,
      },
    );
  }
  return agentRunSchema.parse({
    ...run,
    status: input.status,
    ...(input.finishedAt ? { finishedAt: input.finishedAt } : {}),
  });
}

export function assertRunFound(
  run: AgentRunRecord | null,
  runId: string,
): AgentRunRecord {
  if (!run) {
    throw new AgentSessionError(
      'AGENT_RUN_NOT_FOUND',
      `Agent run ${runId} does not exist for this resource.`,
      { runId },
    );
  }
  return run;
}
