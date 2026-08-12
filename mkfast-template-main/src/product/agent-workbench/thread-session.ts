/**
 * Thread-root session restore helpers (V31-05 / V3.1 §4–§5.1).
 *
 * Pure policy + typed P1 response shapes. Network I/O stays in the host.
 */

import type { WorkbenchSessionProjection } from './agent-event-reducer';

export type WorkbenchResolveSource =
  | 'explicit_thread'
  | 'active_turn'
  | 'recent_thread'
  | 'idle';

export type WorkbenchSessionResolveResponse = {
  session: WorkbenchSessionProjection | null;
  resolveSource: WorkbenchResolveSource;
};

export type ThreadListItem = {
  threadId: string;
  title: string;
  status: 'active' | 'archived';
  sessionRevision: number;
  summaryRevision: number;
  summary?: string;
  lastRunAt?: string;
  updatedAt: string;
  createdAt: string;
  activeRunId?: string;
};

export type ThreadListResponse = {
  threads: ThreadListItem[];
};

/**
 * Dashboard URL search policy: explicit threadId wins; taskId remains the
 * Work-level deep link (§27.6) and is independent of Thread resume.
 */
export function resolveDashboardThreadTarget(search: {
  threadId?: string | null;
  taskId?: string | null;
}): {
  explicitThreadId: string | null;
  explicitTaskId: string | null;
} {
  const threadId =
    typeof search.threadId === 'string' && search.threadId.trim().length > 0
      ? search.threadId.trim()
      : null;
  const taskId =
    typeof search.taskId === 'string' && search.taskId.trim().length > 0
      ? search.taskId.trim()
      : null;
  return { explicitThreadId: threadId, explicitTaskId: taskId };
}

/** Workbench mode label for host data attributes / tests. */
export function workbenchRootMode(input: {
  session: WorkbenchSessionProjection | null;
  resolveSource: WorkbenchResolveSource | null;
}): 'idle' | 'thread' {
  // Both non-session branches returned 'idle'; the session is the only input.
  return input.session ? 'thread' : 'idle';
}

export function threadDashboardHref(threadId: string): string {
  const params = new URLSearchParams({ threadId });
  return `/dashboard?${params.toString()}`;
}
