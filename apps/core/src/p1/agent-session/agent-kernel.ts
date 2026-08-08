/**
 * AgentKernel port (V3.1 §7.3 / §21.4).
 *
 * Thin isolation for tests + AI SDK major upgrades. **No durable checkpoint** —
 * DBOS remains the sole durable runtime (D-016 residual half).
 */

import type { z } from 'zod';

import type { AgentTurnDecision } from './turn-contracts.js';
import { parseAgentTurnDecision } from './turn-contracts.js';

export type AgentKernelToolCall = {
  toolName: string;
  args: unknown;
  result?: unknown;
};

export type AgentKernelToolDefinition = {
  description: string;
  /** Side-effect class for read-only turn guards. */
  sideEffect: 'none' | 'internal_write' | 'paid' | 'external';
  /**
   * Per-tool Zod input schema (V31-07). When absent, AI SDK adapter uses
   * passthrough object for fixture-only tools.
   */
  inputSchema?: z.ZodType;
  execute: (args: unknown) => Promise<unknown> | unknown;
};

export type AgentKernelTurnRequest = {
  instructions: string;
  prompt: string;
  tools: Record<string, AgentKernelToolDefinition>;
  activeToolNames: readonly string[];
  maxLlmSteps: number;
  onPartial?: (partial: unknown) => Promise<void> | void;
};

export type AgentKernelTurnResult = {
  decision: AgentTurnDecision;
  toolCalls: AgentKernelToolCall[];
  steps: number;
};

/**
 * Port surface. Implementations must not expose save/load checkpoint APIs.
 */
export interface AgentKernel {
  runTurn(request: AgentKernelTurnRequest): Promise<AgentKernelTurnResult>;
}

/** Constructive proof: kernel has no durable checkpoint methods. */
export const AGENT_KERNEL_FORBIDDEN_METHODS = [
  'saveCheckpoint',
  'loadCheckpoint',
  'resumeFromCheckpoint',
  'persistDurableState',
] as const;

export function assertNoDurableCheckpointSurface(kernel: object): void {
  for (const method of AGENT_KERNEL_FORBIDDEN_METHODS) {
    if (method in kernel) {
      throw new Error(
        `AgentKernel must not expose durable checkpoint method "${method}" (D-016 / §7.3).`,
      );
    }
  }
}

/**
 * Fixture kernel for zero-LLM tests. Invokes tools in declaration order when
 * listed in activeToolNames, then returns a canned decision (or from factory).
 */
export class FixtureAgentKernel implements AgentKernel {
  constructor(
    private readonly options: {
      decision:
        | AgentTurnDecision
        | ((request: AgentKernelTurnRequest) => AgentTurnDecision);
      /** Optional forced tool call sequence (names only). */
      toolCallPlan?: readonly { toolName: string; args?: unknown }[];
      partialChunks?: readonly unknown[];
    },
  ) {}

  async runTurn(
    request: AgentKernelTurnRequest,
  ): Promise<AgentKernelTurnResult> {
    if (request.onPartial && this.options.partialChunks) {
      for (const chunk of this.options.partialChunks) {
        await request.onPartial(chunk);
      }
    }

    const toolCalls: AgentKernelToolCall[] = [];
    const plan =
      this.options.toolCallPlan ??
      request.activeToolNames.map((toolName) => ({ toolName, args: {} }));

    for (const step of plan) {
      if (!request.activeToolNames.includes(step.toolName)) {
        continue;
      }
      const tool = request.tools[step.toolName];
      if (!tool) continue;
      const args = step.args ?? {};
      const result = await tool.execute(args);
      toolCalls.push({ toolName: step.toolName, args, result });
    }

    const raw =
      typeof this.options.decision === 'function'
        ? this.options.decision(request)
        : this.options.decision;
    const decision = parseAgentTurnDecision(raw);

    return {
      decision,
      toolCalls,
      steps: Math.max(1, toolCalls.length),
    };
  }
}
