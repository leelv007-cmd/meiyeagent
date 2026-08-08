/**
 * In-memory AgentSessionStore for tests and fixture runtimes (V31-02).
 *
 * Every invariant lives in the shared helpers of agent-session-store.ts, so this
 * implementation only owns storage and lookup.
 */

import type { AgentRunRecord, AgentThread } from '@meiye/contracts';

import {
  assertRunFound,
  assertThreadFound,
  assertWriteTurnAdmissible,
  isActiveRunStatus,
  newAgentThread,
  newExecutionChildRun,
  newWriteTurnRun,
  resolveExecutionRunReplay,
  runWithStatus,
  threadIdTaken,
  threadWithActiveGoalIds,
  threadWithStartedTurn,
  threadWithSummary,
  type AgentSessionStore,
  type AgentWriteTurn,
  type CreateAgentThreadInput,
  type ExecutionRunLink,
  type LegacyWorkThreadOpen,
  type LinkExecutionRunInput,
  type OpenLegacyWorkThreadInput,
  type RecordThreadSummaryInput,
  type SetActiveGoalIdsInput,
  type StartWriteTurnInput,
  type UpdateAgentRunStatusInput,
} from './agent-session-store.js';

export class MemoryAgentSessionStore implements AgentSessionStore {
  private readonly threads = new Map<string, AgentThread>();
  private readonly legacyWorkThreads = new Map<string, string>();
  private readonly runs = new Map<string, AgentRunRecord>();

  async createThread(input: CreateAgentThreadInput): Promise<AgentThread> {
    const existing = this.threads.get(input.threadId);
    if (existing) {
      if (existing.resourceId !== input.resourceId) {
        throw threadIdTaken(input.threadId);
      }
      return structuredClone(existing);
    }
    const thread = newAgentThread(input);
    this.threads.set(thread.threadId, thread);
    return structuredClone(thread);
  }

  async openLegacyWorkThread(
    input: OpenLegacyWorkThreadInput,
  ): Promise<LegacyWorkThreadOpen> {
    const key = legacyKey(input.resourceId, input.legacyWorkId);
    const openedThreadId = this.legacyWorkThreads.get(key);
    if (openedThreadId) {
      const opened = this.threads.get(openedThreadId);
      if (opened) return { thread: structuredClone(opened), created: false };
    }
    if (this.threads.has(input.threadId)) throw threadIdTaken(input.threadId);
    const thread = newAgentThread(input);
    this.threads.set(thread.threadId, thread);
    this.legacyWorkThreads.set(key, thread.threadId);
    return { thread: structuredClone(thread), created: true };
  }

  async getThread(input: {
    resourceId: string;
    threadId: string;
  }): Promise<AgentThread | null> {
    const thread = this.threads.get(input.threadId);
    if (!thread || thread.resourceId !== input.resourceId) return null;
    return structuredClone(thread);
  }

  async listRecentThreads(input: {
    resourceId: string;
    limit?: number;
  }): Promise<AgentThread[]> {
    const ordered = [...this.threads.values()]
      .filter((thread) => thread.resourceId === input.resourceId)
      .sort((left, right) => {
        const byActivity = recencyKey(right).localeCompare(recencyKey(left));
        return byActivity === 0
          ? left.threadId.localeCompare(right.threadId)
          : byActivity;
      })
      .map((thread) => structuredClone(thread));
    return input.limit === undefined ? ordered : ordered.slice(0, input.limit);
  }

  async startWriteTurn(input: StartWriteTurnInput): Promise<AgentWriteTurn> {
    const thread = assertThreadFound(
      await this.getThread(input),
      input.threadId,
    );
    const activeRun =
      [...this.runs.values()].find(
        (run) =>
          run.threadId === thread.threadId &&
          run.durability === 'exit' &&
          isActiveRunStatus(run.status),
      ) ?? null;
    assertWriteTurnAdmissible(thread, input.expectedSessionRevision, activeRun);

    const started = threadWithStartedTurn(thread, input.now);
    const run = newWriteTurnRun(input);
    this.threads.set(started.threadId, started);
    this.runs.set(run.runId, run);
    return { thread: structuredClone(started), run: structuredClone(run) };
  }

  async linkExecutionRun(
    input: LinkExecutionRunInput,
  ): Promise<ExecutionRunLink> {
    const parent = assertRunFound(
      await this.getRun({ resourceId: input.resourceId, runId: input.parentRunId }),
      input.parentRunId,
    );
    const existingChild = [...this.runs.values()].find(
      (run) => run.parentRunId === parent.runId && run.durability === 'sync',
    );
    if (existingChild) return resolveExecutionRunReplay(existingChild, input);

    const child = newExecutionChildRun(parent, input);
    this.runs.set(child.runId, child);
    return { run: structuredClone(child), replayed: false };
  }

  async updateRunStatus(
    input: UpdateAgentRunStatusInput,
  ): Promise<AgentRunRecord> {
    const run = assertRunFound(await this.getRun(input), input.runId);
    const updated = runWithStatus(run, input);
    this.runs.set(updated.runId, updated);
    return structuredClone(updated);
  }

  async getRun(input: {
    resourceId: string;
    runId: string;
  }): Promise<AgentRunRecord | null> {
    const run = this.runs.get(input.runId);
    if (!run) return null;
    const thread = this.threads.get(run.threadId);
    if (!thread || thread.resourceId !== input.resourceId) return null;
    return structuredClone(run);
  }

  async listRuns(input: {
    resourceId: string;
    threadId: string;
  }): Promise<AgentRunRecord[]> {
    const thread = this.threads.get(input.threadId);
    if (!thread || thread.resourceId !== input.resourceId) return [];
    return [...this.runs.values()]
      .filter((run) => run.threadId === input.threadId)
      .sort((left, right) => {
        const byStart = left.startedAt.localeCompare(right.startedAt);
        return byStart === 0 ? left.runId.localeCompare(right.runId) : byStart;
      })
      .map((run) => structuredClone(run));
  }

  async recordThreadSummary(
    input: RecordThreadSummaryInput,
  ): Promise<AgentThread> {
    const thread = assertThreadFound(
      await this.getThread(input),
      input.threadId,
    );
    const summarized = threadWithSummary(thread, input.summary, input.now);
    this.threads.set(summarized.threadId, summarized);
    return structuredClone(summarized);
  }

  async setActiveGoalIds(input: SetActiveGoalIdsInput): Promise<AgentThread> {
    const thread = assertThreadFound(
      await this.getThread(input),
      input.threadId,
    );
    const next = threadWithActiveGoalIds(
      thread,
      input.activeGoalIds,
      input.now,
    );
    this.threads.set(next.threadId, next);
    return structuredClone(next);
  }
}

function legacyKey(resourceId: string, legacyWorkId: string) {
  return JSON.stringify([resourceId, legacyWorkId]);
}

function recencyKey(thread: AgentThread) {
  return thread.lastRunAt ?? thread.createdAt;
}
