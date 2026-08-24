import { taskIdFromPreparedAttemptRunId } from '../harness/prepared-attempt-run-id.js';

/**
 * V31-105 §13 ①A — what the merchant sees when a media job's orchestration
 * workflow is registered nowhere.
 *
 * The media job produced a real result, but there is no run left to hand it
 * to, so the creation can never finish. Before this, the creation sat at
 * `harness_state='started'` with its work stuck on `running` forever: the
 * merchant watched 创作进行中 until the tab was closed and the reserved 积分
 * never came back.
 *
 * This is deliberately not a new terminal state. It routes into the one
 * existing merchant-visible terminal path (`terminateRunningWork`, V31-82):
 * the work fails, the reserved usage and credits are refunded once, the
 * generation job and content task go terminal, and a `workflow_failed` audit
 * row lands under both the task id and its prepared-attempt run id — which is
 * what the Composer SSE reads to raise the report card, unlock the intent box
 * and offer 改一下要求. Only the reason and the merchant sentence differ,
 * because this was not a timeout and the merchant must not be told it was.
 *
 * Idempotent by construction: `terminateRunningWork` answers
 * `already_terminal` once the work is no longer `running`, the credit refund
 * carries a stable operation id, and the audit insert is
 * `ON CONFLICT DO NOTHING`. A pg-boss dead letter that is delivered twice
 * therefore refunds once.
 */
export async function failCreationForUnroutableMediaTerminal(
  store: {
    terminateRunningWork(input: {
      workspaceId: string;
      taskId?: string;
      workId?: string;
      reason: 'timeout' | 'cancelled' | 'orchestration_lost' | 'prepare_rejected';
      now?: string;
    }): Promise<'terminated' | 'already_terminal' | 'missing'>;
  },
  input: {
    workspaceId: string;
    /** The frozen submission's correlationId: a prepared-attempt run id. */
    correlationId: string;
    now?: string;
  },
): Promise<'terminated' | 'already_terminal' | 'missing'> {
  return store.terminateRunningWork({
    workspaceId: input.workspaceId,
    taskId: taskIdFromPreparedAttemptRunId(input.correlationId),
    reason: 'orchestration_lost',
    ...(input.now ? { now: input.now } : {}),
  });
}

/**
 * The frozen media submission's correlationId, or null when the envelope is
 * not a media job (or predates the field). Mirrors the same read
 * `sendHarnessMediaJobTerminal` does, so the two cannot disagree about which
 * run a terminal belongs to.
 */
export function mediaSubmissionCorrelationId(
  payload: Record<string, unknown>,
): string | null {
  const submission = payload.submission;
  if (!submission || typeof submission !== 'object' || Array.isArray(submission)) {
    return null;
  }
  const correlationId = (submission as { correlationId?: unknown })
    .correlationId;
  return typeof correlationId === 'string' && correlationId
    ? correlationId
    : null;
}
