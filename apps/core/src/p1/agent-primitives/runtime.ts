import {
  AGENT_PRIMITIVE_IDS,
  type AgentPrimitiveId,
  type AgentPrimitiveInputById,
  type ObservabilityAxes,
} from '@meiye/contracts';

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

export interface AgentPrimitiveTraceEvent {
  primitiveId: string;
  phase: 'invoked' | 'succeeded' | 'rejected';
  serverContext: AgentPrimitiveServerContext;
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
    for (const primitiveId of AGENT_PRIMITIVE_IDS) {
      if (typeof this.#bindings[primitiveId] !== 'function') {
        throw new Error(`Agent primitive handler is not bound: ${primitiveId}`);
      }
    }
  }

  async execute(args: AgentPrimitiveExecutionRequest): Promise<unknown> {
    const serverContext = snapshotServerContext(args.serverContext);
    try {
      const { definition, input } = (() => {
        try {
          const definition = this.options.registry.resolve(args.primitiveId);
          const input = definition.inputSchema.parse(args.modelInput);
          if (definition.billed && !serverContext.billing) {
            throw new AgentPrimitiveRequestError(
              `Billed agent primitive requires billing context: ${args.primitiveId}`,
            );
          }
          return { definition, input };
        } catch (error) {
          throw invalidRequest(error);
        }
      })();
      const handler = this.#bindings[
        definition.id
      ] as (args: {
        input: unknown;
        serverContext: AgentPrimitiveServerContext;
      }) => Promise<unknown>;
      await this.options.tracePort.append({
        phase: 'invoked',
        primitiveId: args.primitiveId,
        serverContext,
      });
      const result = await handler({
        input,
        serverContext,
      });
      await this.options.tracePort.append({
        phase: 'succeeded',
        primitiveId: args.primitiveId,
        serverContext,
      });
      return result;
    } catch (error) {
      await this.options.tracePort.append({
        error: error instanceof Error ? error.message : String(error),
        phase: 'rejected',
        primitiveId: args.primitiveId,
        serverContext,
      });
      throw error;
    }
  }
}

function snapshotServerContext(
  input: AgentPrimitiveServerContext,
): AgentPrimitiveServerContext {
  return Object.freeze({
    ...input,
    observability: Object.freeze({ ...input.observability }),
    ...(input.billing
      ? { billing: Object.freeze({ ...input.billing }) }
      : {}),
  });
}
