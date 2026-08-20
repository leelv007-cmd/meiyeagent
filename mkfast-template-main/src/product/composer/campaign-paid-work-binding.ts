import type { CampaignPaidWorkProjection } from './campaign-paid-work-client';
import type { ComposerSession } from './composer-session';

export type CreatedCampaignWork = Extract<
  CampaignPaidWorkProjection['works'][number],
  { task: unknown }
>;

export function nextCampaignWorkToBind(input: {
  boundOrdinal: number;
  campaign: CampaignPaidWorkProjection | null | undefined;
  currentTask: ComposerSession['task'];
  phase: ComposerSession['phase'];
  turns: ComposerSession['turns'];
  /**
   * Concurrent projection (Work 2 already created while Work 1 is bound)
   * still waits for Work 1's delivery turn. Sequential Campaigns pass false:
   * Core only creates Work 2 after Work 1 package_delivered, and the visible
   * composer-delivery-card is often a workbench overlay, not session.turns.
   */
  holdSuccessorUntilDelivery?: boolean;
}): CreatedCampaignWork | null {
  const nextOrdinal = input.boundOrdinal + 1;
  const next = input.campaign?.works.find(
    (work): work is CreatedCampaignWork =>
      'task' in work && work.workOrdinal === nextOrdinal
  );
  if (!next) return null;
  if (input.boundOrdinal === 0) return next;

  const current = input.campaign?.works.find(
    (work): work is CreatedCampaignWork =>
      'task' in work && work.workOrdinal === input.boundOrdinal
  );
  const currentTask = input.currentTask;
  if (
    !current ||
    !currentTask ||
    input.phase === 'failed' ||
    current.task.id !== currentTask.taskId ||
    current.work.id !== currentTask.workId
  ) {
    return null;
  }
  if (input.holdSuccessorUntilDelivery === false) return next;
  const currentDelivered = input.turns.some(
    (turn) =>
      turn.kind === 'delivery' &&
      turn.taskId === currentTask.taskId &&
      turn.workId === currentTask.workId
  );
  return currentDelivered ? next : null;
}

export function selectCampaignLivingPlanBinding(input: {
  boundWork: CreatedCampaignWork | null | undefined;
  overlayTask: ComposerSession['task'];
}): {
  taskId: string | null;
  executionConfirmationRequestId: string | null;
} {
  if (input.boundWork) {
    return {
      taskId: input.boundWork.task.id,
      executionConfirmationRequestId:
        input.boundWork.executionConfirmationRequestId ?? null,
    };
  }
  return {
    taskId: input.overlayTask?.taskId ?? null,
    executionConfirmationRequestId:
      input.overlayTask?.executionConfirmationRequestId ?? null,
  };
}
