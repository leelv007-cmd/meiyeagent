/**
 * Workbench session projection + Thread list (V31-05).
 *
 * Consumes AgentSessionStore (V31-02) only — no rewrite of thread/run truth.
 * Authority: V3.1 §4–§5.1, §27.6 restore order (explicit threadId first).
 */

import type { AgentRunRecord, AgentThread } from '@meiye/contracts';

import {
  isActiveRunStatus,
  type AgentSessionStore,
} from './agent-session-store.js';

// The projection shape is the cross-tier contract (@meiye/contracts).
export type { WorkbenchSessionProjection } from '@meiye/contracts';
import type { WorkbenchSessionProjection } from '@meiye/contracts';

export type WorkbenchSessionResolveResult = {
  /**
   * Null ⇒ Idle (no explicit target and no active/recent thread to resume).
   * Explicit threadId that does not exist is an error, not Idle.
   */
  session: WorkbenchSessionProjection | null;
  /** How the session was chosen (for tests + host telemetry). */
  resolveSource:
    | 'explicit_thread'
    | 'active_turn'
    | 'recent_thread'
    | 'idle';
};

export type ThreadListItem = {
  threadId: string;
  title: string;
  status: AgentThread['status'];
  sessionRevision: number;
  summaryRevision: number;
  summary?: string;
  lastRunAt?: string;
  updatedAt: string;
  createdAt: string;
  activeRunId?: string;
};

export function projectThreadToSession(
  thread: AgentThread,
  activeRun: AgentRunRecord | null,
): WorkbenchSessionProjection {
  return {
    resourceId: thread.resourceId,
    threadId: thread.threadId,
    sessionRevision: thread.sessionRevision,
    title: thread.title,
    ...(activeRun ? { activeRunId: activeRun.runId } : {}),
  };
}

export function toThreadListItem(
  thread: AgentThread,
  activeRun: AgentRunRecord | null,
): ThreadListItem {
  return {
    threadId: thread.threadId,
    title: thread.title,
    status: thread.status,
    sessionRevision: thread.sessionRevision,
    summaryRevision: thread.summaryRevision,
    ...(thread.summary ? { summary: thread.summary } : {}),
    ...(thread.lastRunAt ? { lastRunAt: thread.lastRunAt } : {}),
    updatedAt: thread.updatedAt,
    createdAt: thread.createdAt,
    ...(activeRun ? { activeRunId: activeRun.runId } : {}),
  };
}

export async function findActiveExitRun(
  store: AgentSessionStore,
  input: { resourceId: string; threadId: string },
): Promise<AgentRunRecord | null> {
  const runs = await store.listRuns(input);
  return (
    runs.find(
      (run) =>
        run.durability === 'exit' && isActiveRunStatus(run.status),
    ) ?? null
  );
}

/**
 * Explicit threadId wins. Without it, prefer a thread with an active write
 * turn; else the most recent Thread; else Idle.
 */
export async function resolveWorkbenchSession(
  store: AgentSessionStore,
  input: {
    resourceId: string;
    explicitThreadId?: string | null;
  },
): Promise<WorkbenchSessionResolveResult> {
  const explicit = input.explicitThreadId?.trim() || null;
  if (explicit) {
    const thread = await store.getThread({
      resourceId: input.resourceId,
      threadId: explicit,
    });
    if (!thread) {
      return { session: null, resolveSource: 'explicit_thread' };
    }
    const activeRun = await findActiveExitRun(store, {
      resourceId: input.resourceId,
      threadId: thread.threadId,
    });
    return {
      session: projectThreadToSession(thread, activeRun),
      resolveSource: 'explicit_thread',
    };
  }

  const recent = await store.listRecentThreads({
    resourceId: input.resourceId,
    limit: 50,
  });
  const activeOnly = recent.filter((thread) => thread.status === 'active');

  for (const thread of activeOnly) {
    const activeRun = await findActiveExitRun(store, {
      resourceId: input.resourceId,
      threadId: thread.threadId,
    });
    if (activeRun) {
      return {
        session: projectThreadToSession(thread, activeRun),
        resolveSource: 'active_turn',
      };
    }
  }

  const head = activeOnly[0] ?? null;
  if (head) {
    const activeRun = await findActiveExitRun(store, {
      resourceId: input.resourceId,
      threadId: head.threadId,
    });
    return {
      session: projectThreadToSession(head, activeRun),
      resolveSource: 'recent_thread',
    };
  }

  return { session: null, resolveSource: 'idle' };
}

export async function listWorkbenchThreads(
  store: AgentSessionStore,
  input: { resourceId: string; limit?: number },
): Promise<ThreadListItem[]> {
  const threads = await store.listRecentThreads({
    resourceId: input.resourceId,
    limit: input.limit ?? 50,
  });
  const items: ThreadListItem[] = [];
  for (const thread of threads) {
    const activeRun = await findActiveExitRun(store, {
      resourceId: input.resourceId,
      threadId: thread.threadId,
    });
    items.push(toThreadListItem(thread, activeRun));
  }
  return items;
}
