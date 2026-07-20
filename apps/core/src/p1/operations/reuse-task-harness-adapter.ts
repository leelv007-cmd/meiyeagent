import type { ReuseTaskSeed } from '@meiye/contracts';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type { HarnessTaskRequest } from '../harness/task-admission.js';
import type { ReuseTaskSubmissionPort } from './asset-memory-foundation-module.js';

export interface ReuseHarnessSubmissionPort {
  submit(input: HarnessTaskRequest): Promise<unknown>;
}

export class ReuseTaskHarnessAdapter implements ReuseTaskSubmissionPort {
  constructor(
    private readonly harness: () => ReuseHarnessSubmissionPort | undefined,
  ) {}

  submit(input: {
    context: P1Context;
    taskId: string;
    packageId: string;
    rawInput: string;
    workflowRevision: number;
    assetIds: string[];
    factScope: HarnessTaskRequest['factScope'];
    seed: ReuseTaskSeed;
    suggestion?: {
      suggestionId: string;
      explanation: string;
      variableSlotKeys: string[];
    };
  }) {
    const harness = this.harness();
    if (!harness) {
      throw new P1DomainError(
        'INVALID_STATE',
        'The production Harness is unavailable for reuse Tasks.',
      );
    }
    const sourceSummaries = [
      `Reusable AssetRevision: ${input.seed.assetRevisionId}`,
      `Reusable structure keys: ${input.seed.fixedItemKeys.join(', ')}`,
      `Current variable slots: ${input.seed.variableSlotKeys.join(', ')}`,
      ...(input.suggestion
        ? [
            `Selected continuation ${input.suggestion.suggestionId}; variable slots: ${input.suggestion.variableSlotKeys.join(', ')}`,
          ]
        : []),
    ];
    return harness.submit({
      taskId: input.taskId,
      actorId: input.context.userId,
      workspaceId: input.context.workspaceId,
      packageId: input.packageId,
      expectedRevision: 0,
      workflowRevision: input.workflowRevision,
      rawInput: input.rawInput,
      factScope: input.factScope,
      reuseSeed: input.seed,
      intent: {
        context: {
          workId: input.taskId,
          intent: input.rawInput,
          sourceSummaries,
        },
        assetReferences: [...input.assetIds],
      },
    });
  }
}
