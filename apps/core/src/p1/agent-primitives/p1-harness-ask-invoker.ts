import type { HarnessStage, QuestionCard } from '@meiye/contracts';

import type { P1Context } from '../foundation/domain.js';
import {
  harnessExecutionChildLifecycleInput,
} from '../harness/production-stage-ports.js';
import type { HarnessWorkflowInput } from '../harness/task-admission.js';

export interface P1HarnessAskApplicationPort {
  executeModule<TInput extends Record<string, unknown>, TOutput>(
    context: P1Context,
    name: string,
    input: TInput,
    idempotencyKey: string,
  ): Promise<TOutput>;
}

export interface P1HarnessAskInvocation {
  idempotencyKey: string;
  question: QuestionCard;
  request: HarnessWorkflowInput;
  stage: HarnessStage;
  workspaceId: string;
}

export class P1HarnessAskInvoker {
  constructor(
    private readonly application: P1HarnessAskApplicationPort,
    private readonly workerId: string,
  ) {}

  async invoke(input: P1HarnessAskInvocation): Promise<void> {
    if (input.request.workspaceId !== input.workspaceId) {
      throw new Error(
        'Harness merchant question workspace does not match the frozen request.',
      );
    }
    const lifecycle = harnessExecutionChildLifecycleInput({
      request: input.request,
      stage: input.stage,
      primitiveId: 'ask_merchant',
      baseIdempotencyKey: input.idempotencyKey,
    });
    await this.application.executeModule(
      {
        actor: 'worker',
        correlationId: input.idempotencyKey,
        userId: this.workerId,
        workspaceId: input.workspaceId,
      },
      'agent-primitives',
      {
        action: 'execute',
        payload: {
          harness: {
            question: input.question,
            stage: input.stage,
          },
          modelInput: {
            question: input.question.question,
            ...(input.question.options.length > 0
              ? {
                  options: input.question.options.map(
                    ({ description, label }) => ({
                      ...(description ? { description } : {}),
                      label,
                    }),
                  ),
                }
              : {}),
          },
          observability: lifecycle.axes,
          primitiveId: 'ask_merchant',
          taskId: lifecycle.taskId,
        },
      },
      input.idempotencyKey,
    );
  }
}
