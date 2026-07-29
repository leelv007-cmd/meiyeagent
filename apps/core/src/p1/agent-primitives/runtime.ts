import {
  AGENT_PRIMITIVE_IDS,
  type AgentPrimitiveId,
  type AgentPrimitiveInputById,
  type BoundedExecutionSnapshot,
  type HarnessStage,
  type ObservabilityAxes,
  type QuestionCard,
} from '@meiye/contracts';

import {
  ExecutionAttemptBudget,
  ExecutionAttemptBudgetExceeded,
} from '../model-supply/execution-attempt-budget.js';
import type { AgentPrimitiveRegistry } from './registry.js';

export interface AgentPrimitiveServerContext {
  workspaceId: string;
  actorId: string;
  correlationId: string;
  idempotencyKey: string;
  observability: ObservabilityAxes;
  billing?: {
    productUsageTaskId: string;
    quoteId: string;
  };
  boundedExecution?: BoundedExecutionSnapshot;
  harness?: {
    stage: HarnessStage;
    question: QuestionCard;
  };
}

export type AgentPrimitiveHandler<PrimitiveId extends AgentPrimitiveId> = (
  args: {
    input: AgentPrimitiveInputById[PrimitiveId];
    serverContext: AgentPrimitiveServerContext;
  },
) => Promise<unknown>;

export type AgentPrimitiveBindings = {
  [PrimitiveId in AgentPrimitiveId]: AgentPrimitiveHandler<PrimitiveId>;
};

export type AgentPrimitiveTraceServerContext = Omit<
  AgentPrimitiveServerContext,
  'harness'
> & {
  harness?: {
    stage: HarnessStage;
    workflowId: string;
    workflowRevision: number;
  };
};

export interface AgentPrimitiveTraceEvent {
  primitiveId: string;
  phase: 'invoked' | 'succeeded' | 'rejected';
  serverContext: AgentPrimitiveTraceServerContext;
  error?: string;
}

export interface AgentPrimitiveTracePort {
  append(event: AgentPrimitiveTraceEvent): Promise<void>;
}

export interface AgentPrimitiveExecutionRequest {
  primitiveId: string;
  modelInput: unknown;
  serverContext: AgentPrimitiveServerContext;
}

export class AgentPrimitiveRequestError extends Error {
  readonly code = 'AGENT_PRIMITIVE_REQUEST_INVALID';
  readonly status = 400;

  constructor(message: string) {
    super(message);
    this.name = 'AgentPrimitiveRequestError';
  }
}

export function requireAvailableExecutionAttempt(
  serverContext: AgentPrimitiveServerContext,
  primitiveId: 'generate' | 'revise',
): BoundedExecutionSnapshot {
  const snapshot = serverContext.boundedExecution;
  if (
    !snapshot ||
    snapshot.stopReason !== null ||
    snapshot.maxIterations === 'unset' ||
    !snapshot.requiredLimits.includes('maxIterations')
  ) {
    throw new AgentPrimitiveRequestError(
      `${primitiveId} requires an active server-owned bounded execution snapshot with maxIterations.`,
    );
  }
  const availability = new ExecutionAttemptBudget({
    maxAttempts: snapshot.maxIterations,
    consumedAttempts: snapshot.consumption.iterations,
  });
  // This is an availability probe. The provider port owns observed consumption.
  availability.consume();
  return snapshot;
}

function invalidRequest(error: unknown): AgentPrimitiveRequestError {
  return error instanceof AgentPrimitiveRequestError
    ? error
    : new AgentPrimitiveRequestError(
        error instanceof Error ? error.message : String(error),
      );
}

export class AgentPrimitiveRuntime {
  readonly #bindings: Partial<AgentPrimitiveBindings>;

  constructor(
    private readonly options: {
      bindings: Partial<AgentPrimitiveBindings>;
      registry: AgentPrimitiveRegistry;
      tracePort: AgentPrimitiveTracePort;
    },
  ) {
    this.#bindings = Object.freeze({ ...options.bindings });
    this.assertComplete();
  }

  assertComplete(): void {
    const registered = new Set(
      this.options.registry.list().map(({ id }) => id),
    );
    for (const primitiveId of AGENT_PRIMITIVE_IDS) {
      if (!registered.has(primitiveId)) {
        throw new Error(
          `Agent primitive registry is incomplete: ${primitiveId}`,
        );
      }
      if (typeof this.#bindings[primitiveId] !== 'function') {
        throw new Error(`Agent primitive handler is not bound: ${primitiveId}`);
      }
    }
  }

  async execute(args: AgentPrimitiveExecutionRequest): Promise<unknown> {
    const serverContext = snapshotServerContext(args.serverContext);
    const traceServerContext = projectTraceServerContext(serverContext);
    const { definition, input } = await (async () => {
      try {
        const definition = this.options.registry.resolve(args.primitiveId);
        const input = definition.inputSchema.parse(args.modelInput);
        if (definition.billed && !serverContext.billing) {
          throw new AgentPrimitiveRequestError(
            `Billed agent primitive requires billing context: ${args.primitiveId}`,
          );
        }
        if (definition.id === 'generate' || definition.id === 'revise') {
          requireAvailableExecutionAttempt(serverContext, definition.id);
        }
        return { definition, input };
      } catch (error) {
        const rejection =
          error instanceof ExecutionAttemptBudgetExceeded
            ? error
            : invalidRequest(error);
        await this.options.tracePort.append({
          error: rejection.message,
          phase: 'rejected',
          primitiveId: args.primitiveId,
          serverContext: traceServerContext,
        });
        throw rejection;
      }
    })();
    try {
      const handler = this.#bindings[
        definition.id
      ] as (args: {
        input: unknown;
        serverContext: AgentPrimitiveServerContext;
      }) => Promise<unknown>;
      await this.options.tracePort.append({
        phase: 'invoked',
        primitiveId: args.primitiveId,
        serverContext: traceServerContext,
      });
      const result = await handler({
        input,
        serverContext,
      });
      await this.options.tracePort.append({
        phase: 'succeeded',
        primitiveId: args.primitiveId,
        serverContext: traceServerContext,
      });
      return result;
    } catch (error) {
      try {
        await this.options.tracePort.append({
          error: error instanceof Error ? error.message : String(error),
          phase: 'rejected',
          primitiveId: args.primitiveId,
          serverContext: traceServerContext,
        });
      } catch (traceError) {
        throw new Error('Agent primitive trace failed after request validation.', {
          cause: traceError,
        });
      }
      if (
        error instanceof AgentPrimitiveRequestError ||
        error instanceof ExecutionAttemptBudgetExceeded
      ) {
        throw new Error(
          'Agent primitive execution failed after request validation.',
          { cause: error },
        );
      }
      throw error;
    }
  }
}

function snapshotServerContext(
  input: AgentPrimitiveServerContext,
): AgentPrimitiveServerContext {
  const harness = input.harness
    ? freezeHarnessContext(input.harness)
    : undefined;
  const boundedExecution = input.boundedExecution
    ? freezeBoundedExecution(input.boundedExecution)
    : undefined;
  return Object.freeze({
    ...input,
    observability: Object.freeze({ ...input.observability }),
    ...(input.billing
      ? { billing: Object.freeze({ ...input.billing }) }
      : {}),
    ...(boundedExecution ? { boundedExecution } : {}),
    ...(harness ? { harness } : {}),
  });
}

function freezeBoundedExecution(
  input: BoundedExecutionSnapshot,
): BoundedExecutionSnapshot {
  const requiredLimits = [...input.requiredLimits];
  Object.freeze(requiredLimits);
  return Object.freeze({
    ...input,
    consumption: Object.freeze({ ...input.consumption }),
    requiredLimits,
  });
}

function freezeHarnessContext(
  input: NonNullable<AgentPrimitiveServerContext['harness']>,
): NonNullable<AgentPrimitiveServerContext['harness']> {
  const options = input.question.options.map((option) =>
    Object.freeze({ ...option }),
  );
  Object.freeze(options);
  const question: QuestionCard = {
    ...input.question,
    freeText: Object.freeze({ ...input.question.freeText }),
    options,
    response: Object.freeze({ ...input.question.response }),
  };
  Object.freeze(question);
  return Object.freeze({
    question,
    stage: input.stage,
  });
}

function projectTraceServerContext(
  input: AgentPrimitiveServerContext,
): AgentPrimitiveTraceServerContext {
  const { harness, ...context } = input;
  return Object.freeze({
    ...context,
    ...(harness
      ? {
          harness: Object.freeze({
            stage: harness.stage,
            workflowId: harness.question.workflowId,
            workflowRevision: harness.question.workflowRevision,
          }),
        }
      : {}),
  });
}
