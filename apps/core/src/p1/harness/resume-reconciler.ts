import type { StructuredDecisionInput } from '@meiye/contracts';

import {
  type HarnessWorkflowResumer,
  lateAnswerSuccessorWorkflowId,
} from './decision-service.js';
import type { HarnessWorkflowInput } from './task-admission.js';
import type { HarnessInteractionResumeSignal } from './interaction-resume.js';

interface HarnessPendingResumeBase {
  claimId: string;
  eventId: string;
  workspaceId: string;
  taskId: string;
}

export type HarnessPendingResume =
  | (HarnessPendingResumeBase & {
      kind: 'malformed';
    })
  | (HarnessPendingResumeBase & {
      kind: 'structured_decision';
      command: StructuredDecisionInput;
      request?: HarnessWorkflowInput;
      resolutionSource: 'decision' | 'late_answer';
    })
  | (HarnessPendingResumeBase & {
      kind: 'interaction';
      resolutionSource: 'decision' | 'system_default';
      resume: HarnessInteractionResumeSignal;
    });

export interface HarnessResumeWorkflow extends HarnessWorkflowResumer {
  resumeInteraction(
    workspaceId: string,
    taskId: string,
    signal: HarnessInteractionResumeSignal,
  ): Promise<void>;
}

export interface HarnessResumeReconcilerStore {
  claimPending(limit: number): Promise<HarnessPendingResume[]>;
  claimEvent(eventId: string): Promise<HarnessPendingResume | null>;
  markResumed(eventId: string, claimId: string): Promise<boolean>;
  markInvalid(eventId: string, claimId: string): Promise<boolean>;
  release(eventId: string, claimId: string): Promise<void>;
}

export class HarnessResumeReconciler {
  constructor(
    private readonly store: HarnessResumeReconcilerStore,
    private readonly workflow: HarnessResumeWorkflow,
    private readonly batchSize = 20
  ) {}

  async resumeEvent(eventId: string) {
    const item = await this.store.claimEvent(eventId);
    if (!item) return false;
    if (item.kind === 'malformed') {
      await this.store.markInvalid(item.eventId, item.claimId);
      throw new Error('The persisted Harness resume event is malformed.');
    }
    try {
      await this.resumeClaim(item);
      if (!(await this.store.markResumed(item.eventId, item.claimId))) {
        throw new Error('The decision resume lease was lost.');
      }
      return true;
    } catch (error) {
      await this.store.release(item.eventId, item.claimId);
      throw error;
    }
  }

  async runOnce() {
    let resumed = 0;
    let failed = 0;
    const failedClaims: Array<{ eventId: string; claimId: string }> = [];
    for (let index = 0; index < this.batchSize; index += 1) {
      const [item] = await this.store.claimPending(1);
      if (!item) break;
      if (item.kind === 'malformed') {
        if (!(await this.store.markInvalid(item.eventId, item.claimId))) {
          failedClaims.push({
            eventId: item.eventId,
            claimId: item.claimId,
          });
        }
        failed += 1;
        continue;
      }
      try {
        await this.resumeClaim(item);
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

  private async resumeClaim(
    item: Exclude<HarnessPendingResume, { kind: 'malformed' }>,
  ) {
    if (item.kind === 'interaction') {
      await this.workflow.resumeInteraction(
        item.workspaceId,
        item.taskId,
        item.resume,
      );
    } else if (item.resolutionSource === 'late_answer') {
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
  }
}
