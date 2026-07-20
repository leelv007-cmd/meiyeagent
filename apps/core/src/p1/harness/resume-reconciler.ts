import type { StructuredDecisionInput } from '@meiye/contracts';

import type { HarnessWorkflowResumer } from './decision-service.js';

export interface HarnessPendingResume {
  eventId: string;
  workspaceId: string;
  taskId: string;
  command: StructuredDecisionInput;
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
        await this.workflow.resume(item.workspaceId, item.taskId, item.command);
        await this.store.markResumed(item.eventId);
        resumed += 1;
      } catch {
        failed += 1;
      }
    }
    return { resumed, failed };
  }
}
