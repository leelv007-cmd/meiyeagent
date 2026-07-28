import type { StructuredDecisionInput } from '@meiye/contracts';

import {
  type HarnessWorkflowResumer,
  lateAnswerSuccessorWorkflowId,
} from './decision-service.js';
import type { HarnessWorkflowInput } from './task-admission.js';

export interface HarnessPendingResume {
  eventId: string;
  workspaceId: string;
  taskId: string;
  command: StructuredDecisionInput;
  request?: HarnessWorkflowInput;
  resolutionSource: 'decision' | 'late_answer';
}

export interface HarnessResumeReconcilerStore {
  listPending(limit: number): Promise<HarnessPendingResume[]>;
  markResumed(eventId: string): Promise<void>;
}

export class HarnessResumeReconciler {
  constructor(
    private readonly store: HarnessResumeReconcilerStore,
    private readonly workflow: HarnessWorkflowResumer,
    private readonly batchSize = 20
  ) {}

  async runOnce() {
    const pending = await this.store.listPending(this.batchSize);
    let resumed = 0;
    let failed = 0;
    for (const item of pending) {
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
        await this.store.markResumed(item.eventId);
        resumed += 1;
      } catch {
        failed += 1;
      }
    }
    return { resumed, failed };
  }
}
