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
