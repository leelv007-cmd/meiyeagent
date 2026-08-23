/**
 * V31-105 §2 (option B) — which Work a Thread is working on, as one SQL
 * statement.
 *
 * `WorkbenchSessionProjection.current` / `.recent` used to be read from a
 * `durability = 'sync'` agent run created by `linkExecutionRun`. Nothing in
 * production ever called it, so the filter matched no row, both fields were
 * permanently absent, and a Workbench that could not fall back to an explicit
 * `?taskId=` had no Work to bind at all.
 *
 * V31-90 had already moved the *same* question — "which thread owns this
 * Work" — off that dead run and onto the submission's own `agentBinding`
 * (assembly/core-assembly.ts `STEERING_AUTHORITY_BINDING_SQL`). This reader is
 * the other direction of that binding: thread → its Works, newest first.
 *
 * Two facts, two tables, no third truth:
 *  - `execution_spine.creation_submissions` binds Thread → task/Work through
 *    `submission -> 'agentBinding' ->> 'threadId'`, written by
 *    `persistAgentPlanning` / `persistParkedAgentBinding`.
 *  - `p1_creative_works.payload ->> 'status'` says whether that Work is over.
 *    `creation_submissions.harness_state` cannot answer this: it only covers
 *    the start handshake ('failed' | 'reserved' | 'starting' | 'started'), not
 *    whether the Make finished. The terminal set below is the one
 *    `listActiveTasks` already treats as "no longer in flight"
 *    (p1/harness/postgres-store.ts).
 *
 * Ordering is by recency, not by `snapshot_revision`: a Thread accumulates one
 * submission per merchant turn, so `created_at` is what "most recent Work"
 * means. `snapshot_revision` only breaks ties between rows of the same instant
 * (a repriced successor), and `id` makes the order total so the projection is
 * stable across reads.
 *
 * Exported so `thread-work-authority.postgres.test.ts` can execute the
 * statement production runs, rather than a paraphrase of it.
 */

import type { Pool } from 'pg';

/** Merchant-visible Work states that end a Make. */
export const TERMINAL_WORK_STATUSES = ['completed', 'failed'] as const;

export const THREAD_WORK_AUTHORITY_SQL = `SELECT submission.task_id,
          submission.work_id,
          work.payload ->> 'status' AS work_status
     FROM execution_spine.creation_submissions submission
     JOIN p1_agent_threads thread
       ON thread.thread_id =
          submission.submission -> 'agentBinding' ->> 'threadId'
      AND thread.resource_id = submission.workspace_id
     LEFT JOIN p1_creative_works work
       ON work.workspace_id = submission.workspace_id
      AND work.id = submission.work_id
    WHERE submission.workspace_id = $1
      AND thread.thread_id = $2
      AND submission.task_id IS NOT NULL
    ORDER BY submission.created_at DESC,
             submission.snapshot_revision DESC NULLS LAST,
             submission.id DESC
    LIMIT 20`;

export type ThreadWorkAuthorityRow = {
  task_id: string;
  work_id: string | null;
  work_status: string | null;
};

/** One Work on a Thread. `active` ⇒ the Make has not reported back. */
export type ThreadWorkRef = {
  taskId: string;
  workId?: string;
  active: boolean;
};

/**
 * Thread → its Works, most recent first. An empty list is an honest "this
 * Thread has produced nothing", not a lookup that quietly failed.
 */
export interface ThreadWorkAuthorityReader {
  readThreadWork(input: {
    resourceId: string;
    threadId: string;
  }): Promise<readonly ThreadWorkRef[]>;
}

export function threadWorkRefFromRow(
  row: ThreadWorkAuthorityRow,
): ThreadWorkRef {
  const workId = row.work_id?.trim();
  const status = row.work_status?.trim();
  return {
    taskId: row.task_id,
    ...(workId ? { workId } : {}),
    active: !(
      status && (TERMINAL_WORK_STATUSES as readonly string[]).includes(status)
    ),
  };
}

export class PostgresThreadWorkAuthorityReader
  implements ThreadWorkAuthorityReader
{
  constructor(private readonly pool: Pool) {}

  async readThreadWork(input: {
    resourceId: string;
    threadId: string;
  }): Promise<readonly ThreadWorkRef[]> {
    const result = await this.pool.query<ThreadWorkAuthorityRow>(
      THREAD_WORK_AUTHORITY_SQL,
      [input.resourceId, input.threadId],
    );
    return result.rows.map(threadWorkRefFromRow);
  }
}

/** Threads with no execution spine behind them (tests, thin read surfaces). */
export const EMPTY_THREAD_WORK_AUTHORITY: ThreadWorkAuthorityReader = {
  async readThreadWork() {
    return [];
  },
};
