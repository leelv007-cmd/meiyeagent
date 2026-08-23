/**
 * V31-28: a merchant-confirmed prepared attempt runs under
 * `${taskId}:plan-r${planRevision}` (composerPreparedAttemptId,
 * execution-spine/submission-coordinator.ts) while the browser addresses the
 * bare task id its 202 handed back. Server-side reads resolve that split
 * (postgres-store workflowRuntimeId, since 631ca906) and the web SSE gate
 * accepts the family client-side; this predicate is the submit-side
 * counterpart, so a merchant answer whose `resume.runId` names the task's own
 * prepared attempt is not treated as foreign. Exact shapes only: the revision
 * segment must be a bare integer >= 1, so `task-1` never adopts
 * `task-12:plan-r1` and carrier-suffixed or malformed ids stay foreign.
 */
export function isPreparedAttemptRunIdForTask(
  runId: string,
  taskId: string,
): boolean {
  const marker = `${taskId}:plan-r`;
  if (!runId.startsWith(marker)) return false;
  return /^[1-9]\d*$/.test(runId.slice(marker.length));
}

/**
 * Builder counterpart of the predicate above — the one place that knows how a
 * prepared attempt's run id is spelled from its task id and plan revision.
 * Returns null for revisions the predicate would reject (0, negatives,
 * non-integers), so callers cannot mint an id the family check disowns.
 */
export function preparedAttemptRunIdForTask(
  taskId: string,
  planRevision: number,
): string | null {
  if (!Number.isInteger(planRevision) || planRevision < 1) return null;
  return `${taskId}:plan-r${planRevision}`;
}

/**
 * Reader counterpart: recover the task id a prepared-attempt run id was built
 * from. A frozen media submission carries the run id as its `correlationId`,
 * while `creation_submissions.task_id` holds the bare task id, so anything
 * joining the two has to undo exactly the spelling above — and nothing else.
 * An id that is not a prepared attempt is returned unchanged.
 */
export function taskIdFromPreparedAttemptRunId(runId: string): string {
  const marker = runId.lastIndexOf(':plan-r');
  if (marker < 1) return runId;
  const taskId = runId.slice(0, marker);
  return isPreparedAttemptRunIdForTask(runId, taskId) ? taskId : runId;
}
