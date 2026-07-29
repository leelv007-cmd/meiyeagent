import {
  AGENT_PRIMITIVE_IDS,
  agentPrimitiveInputSchemas,
  type AgentPrimitiveId,
} from '@meiye/contracts';

export type AgentPrimitiveSideEffectClass =
  | 'none'
  | 'read'
  | 'bounded_write';

export interface AgentPrimitiveDefinition {
  readonly id: AgentPrimitiveId;
  readonly inputSchema: (typeof agentPrimitiveInputSchemas)[AgentPrimitiveId];
  readonly sideEffectClass: AgentPrimitiveSideEffectClass;
  readonly billed: boolean;
}

export const AGENT_PRIMITIVE_DEFINITIONS = Object.freeze([
  Object.freeze({
    id: 'read_context',
    inputSchema: agentPrimitiveInputSchemas.read_context,
    sideEffectClass: 'read',
    billed: false,
  }),
  Object.freeze({
    id: 'generate',
    inputSchema: agentPrimitiveInputSchemas.generate,
    sideEffectClass: 'none',
    billed: true,
  }),
  Object.freeze({
    id: 'revise',
    inputSchema: agentPrimitiveInputSchemas.revise,
    sideEffectClass: 'bounded_write',
    billed: true,
  }),
  Object.freeze({
    id: 'record',
    inputSchema: agentPrimitiveInputSchemas.record,
    sideEffectClass: 'bounded_write',
    billed: false,
  }),
  Object.freeze({
    id: 'check',
    inputSchema: agentPrimitiveInputSchemas.check,
    sideEffectClass: 'none',
    billed: false,
  }),
  Object.freeze({
    id: 'ask_merchant',
    inputSchema: agentPrimitiveInputSchemas.ask_merchant,
    sideEffectClass: 'none',
    billed: false,
  }),
] as const satisfies readonly AgentPrimitiveDefinition[]);

const allowedPrimitiveIds = new Set<string>(AGENT_PRIMITIVE_IDS);

export class AgentPrimitiveRegistry {
  readonly #definitions = new Map<AgentPrimitiveId, AgentPrimitiveDefinition>();

  constructor(definitions: readonly AgentPrimitiveDefinition[]) {
    for (const candidate of definitions) {
      if (!allowedPrimitiveIds.has(candidate.id)) {
        throw new Error(
          `Agent primitive identifier is not allowed: ${candidate.id}`,
        );
      }
      if (this.#definitions.has(candidate.id)) {
        throw new Error(
          `Agent primitive is registered more than once: ${candidate.id}`,
        );
      }

      this.#definitions.set(candidate.id, Object.freeze({ ...candidate }));
    }
  }

  list(): AgentPrimitiveDefinition[] {
    return [...this.#definitions.values()];
  }

  resolve(primitiveId: string): AgentPrimitiveDefinition {
    const definition = this.#definitions.get(primitiveId as AgentPrimitiveId);
    if (!definition) {
      throw new Error(`Agent primitive is not registered: ${primitiveId}`);
    }
    return definition;
  }
}

export function createCanonicalAgentPrimitiveRegistry() {
  return new AgentPrimitiveRegistry(AGENT_PRIMITIVE_DEFINITIONS);
}

export const canonicalAgentPrimitiveRegistry =
  createCanonicalAgentPrimitiveRegistry();
