import { observabilityAxesSchema } from '@meiye/contracts';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import type {
  FoundationStore,
  P1OperationModule,
} from '../foundation/ports.js';
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
    const observability = observabilityAxesSchema.safeParse(
      payload.observability,
    );
    if (!observability.success) {
      fail('Agent primitive observability context is invalid.');
    }

    try {
      return await this.runtime.execute({
        modelInput: payload.modelInput,
        primitiveId: text(payload, 'primitiveId'),
        serverContext: {
          actorId: args.context.userId,
          billing,
          correlationId: args.context.correlationId,
          idempotencyKey: args.idempotencyKey,
          observability: observability.data,
          workspaceId: args.context.workspaceId,
        },
      });
    } catch (error) {
      if (error instanceof AgentPrimitiveRequestError) throw error;
      throw new AgentPrimitiveExecutionError(error);
    }
  }
}
