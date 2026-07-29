import {
  boundedExecutionSnapshotSchema,
  harnessStageSchema,
  observabilityAxisBindingSchema,
  questionCardSchema,
} from '@meiye/contracts';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type {
  FoundationStore,
  P1OperationModule,
} from '../foundation/ports.js';
import { ExecutionAttemptBudgetExceeded } from '../model-supply/execution-attempt-budget.js';
import {
  AgentPrimitiveRequestError,
  type AgentPrimitiveExecutionRequest,
} from './runtime.js';

export interface AgentPrimitiveExecutionPort {
  execute(input: AgentPrimitiveExecutionRequest): Promise<unknown>;
}

export class AgentPrimitiveExecutionError extends Error {
  readonly code = 'AGENT_PRIMITIVE_EXECUTION_UNCERTAIN';

  constructor(cause: unknown) {
    super('Agent primitive execution outcome is uncertain.', { cause });
    this.name = 'AgentPrimitiveExecutionError';
  }
}

function fail(message: string): never {
  throw new AgentPrimitiveRequestError(message);
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${field} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function text(value: Record<string, unknown>, field: string): string {
  const candidate = value[field];
  if (typeof candidate !== 'string' || !candidate.trim()) {
    fail(`${field} is required.`);
  }
  return candidate.trim();
}

export class AgentPrimitiveFoundationModule implements P1OperationModule {
  readonly name = 'agent-primitives';

  constructor(private readonly runtime: AgentPrimitiveExecutionPort) {}

  async execute(args: {
    context: P1Context;
    input: Record<string, unknown>;
    store: FoundationStore;
    idempotencyKey: string;
  }): Promise<unknown> {
    if (args.context.actor !== 'worker') {
      throw new P1DomainError(
        'FORBIDDEN',
        'Agent primitive execution requires a worker actor.',
      );
    }
    if (text(args.input, 'action') !== 'execute') {
      fail('Agent primitive module only supports execute.');
    }
    const payload = object(args.input.payload, 'payload');
    const billing =
      payload.billing === undefined
        ? undefined
        : {
            productUsageTaskId: text(
              object(payload.billing, 'billing'),
              'productUsageTaskId',
            ),
            quoteId: text(
              object(payload.billing, 'billing'),
              'quoteId',
            ),
          };
    const observability = observabilityAxisBindingSchema.safeParse(
      payload.observability,
    );
    if (!observability.success) {
      fail('Agent primitive observability context is invalid.');
    }
    const primitiveId = text(payload, 'primitiveId');
    const taskId = text(payload, 'taskId');
    const boundedExecution =
      payload.boundedExecution === undefined
        ? undefined
        : boundedExecutionSnapshotSchema.safeParse(
            payload.boundedExecution,
          );
    if (
      boundedExecution &&
      !boundedExecution.success
    ) {
      fail('Agent primitive bounded execution context is invalid.');
    }
    const requiresExecutionBudget =
      primitiveId === 'generate' || primitiveId === 'revise';
    if (
      requiresExecutionBudget &&
      (
        !boundedExecution ||
        !boundedExecution.success ||
        boundedExecution.data.maxIterations === 'unset' ||
        !boundedExecution.data.requiredLimits.includes('maxIterations')
      )
    ) {
      fail('Agent primitive bounded execution context is invalid.');
    }
    if (requiresExecutionBudget && boundedExecution?.success) {
      const snapshot = boundedExecution.data;
      if (snapshot.stopReason !== null) {
        fail('Agent primitive bounded execution context is invalid.');
      }
    }
    const harness =
      payload.harness === undefined
        ? undefined
        : (() => {
            const value = object(payload.harness, 'harness');
            const stage = harnessStageSchema.safeParse(value.stage);
            const question = questionCardSchema.safeParse(value.question);
            if (!stage.success || !question.success) {
              fail('Agent primitive Harness context is invalid.');
            }
            return {
              question: question.data,
              stage: stage.data,
            };
          })();

    try {
      return await this.runtime.execute({
        modelInput: payload.modelInput,
        primitiveId,
        serverContext: {
          actorId: args.context.userId,
          billing,
          ...(boundedExecution?.success
            ? { boundedExecution: boundedExecution.data }
            : {}),
          correlationId: args.context.correlationId,
          ...(harness ? { harness } : {}),
          idempotencyKey: args.idempotencyKey,
          observability: observability.data,
          taskId,
          workspaceId: args.context.workspaceId,
        },
      });
    } catch (error) {
      if (
        error instanceof AgentPrimitiveRequestError ||
        error instanceof ExecutionAttemptBudgetExceeded
      ) {
        throw error;
      }
      throw new AgentPrimitiveExecutionError(error);
    }
  }
}
