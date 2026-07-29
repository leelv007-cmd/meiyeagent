import type { StructuredDecisionInput } from '@meiye/contracts';

import {
  type HarnessWorkflowResumer,
  lateAnswerSuccessorWorkflowId,
} from './decision-service.js';
import type { HarnessWorkflowInput } from './task-admission.js';

export interface HarnessPendingResume {
  claimId: string;
  eventId: string;
  workspaceId: string;
  taskId: string;
  command: StructuredDecisionInput;
  request?: HarnessWorkflowInput;
  resolutionSource: 'decision' | 'late_answer';
}

export interface HarnessResumeReconcilerStore {
  claimPending(limit: number): Promise<HarnessPendingResume[]>;
  markResumed(eventId: string, claimId: string): Promise<boolean>;
  release(eventId: string, claimId: string): Promise<void>;
}

export class HarnessResumeReconciler {
  constructor(
    private readonly store: HarnessResumeReconcilerStore,
    private readonly workflow: HarnessWorkflowResumer,
    private readonly batchSize = 20
  ) {}

  async runOnce() {
    let resumed = 0;
    let failed = 0;
    const failedClaims: Array<{ eventId: string; claimId: string }> = [];
    for (let index = 0; index < this.batchSize; index += 1) {
      const [item] = await this.store.claimPending(1);
      if (!item) break;
      try {
        if (item.resolutionSource === 'late_answer') {
          if (!item.request || !this.workflow.startSuccessor) {
            throw new Error('Late-answer successor workflow is unavailable.');
          }
          await this.workflow.startSuccessor({
            command: item.command,
            request: item.request,
            sourceTaskId: item.taskId,
            workflowId: lateAnswerSuccessorWorkflowId(
              item.taskId,
              item.command.questionId,
            ),
            workspaceId: item.workspaceId,
          });
        } else {
          await this.workflow.resume(
            item.workspaceId,
            item.taskId,
            item.command,
          );
        }
        if (!(await this.store.markResumed(item.eventId, item.claimId))) {
          throw new Error('The decision resume lease was lost.');
        }
        resumed += 1;
      } catch {
        failedClaims.push({
          eventId: item.eventId,
          claimId: item.claimId,
        });
        failed += 1;
      }
    }
    await Promise.all(
      failedClaims.map(({ eventId, claimId }) =>
        this.store.release(eventId, claimId),
      ),
    );
    return { resumed, failed };
  }
}
