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
