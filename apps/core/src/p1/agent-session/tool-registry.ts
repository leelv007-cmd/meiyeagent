/**
 * Agent tool registry governance (V31-07 / V3.1 §20.1–§20.3).
 *
 * Fields: sideEffect / riskClass / approval / allowedPhases / maxCalls / timeout.
 * Refusal is model-visible: { allowed:false, gateId, reason } — never throw the turn.
 * Retrieval tools carry response_format: concise | detailed (B6).
 */

import { z } from 'zod';

import type { AgentKernelToolDefinition } from './agent-kernel.js';
import type { AgentTurnPhase } from './turn-contracts.js';

export const AGENT_TOOL_SIDE_EFFECTS = [
  'none',
  'internal_write',
  'paid',
  'external',
] as const;
export type AgentToolSideEffect = (typeof AGENT_TOOL_SIDE_EFFECTS)[number];

export const AGENT_TOOL_RISK_CLASSES = [
  'read',
  'reversible',
  'sensitive',
  'irreversible',
] as const;
export type AgentToolRiskClass = (typeof AGENT_TOOL_RISK_CLASSES)[number];

export const AGENT_TOOL_APPROVALS = [
  'never',
  'policy',
  'merchant',
  'admin',
] as const;
export type AgentToolApproval = (typeof AGENT_TOOL_APPROVALS)[number];

/** Tool-policy phases (V3.1 §20.1). Live turn observations are intent/plan/make. */
export const AGENT_TOOL_PHASES = [
  'intent',
  'plan',
  'make',
  'delivery',
] as const;
export type AgentToolPhase = (typeof AGENT_TOOL_PHASES)[number];

export const responseFormatSchema = z.enum(['concise', 'detailed']);
export type ResponseFormat = z.infer<typeof responseFormatSchema>;

export type ToolCallRefusal = {
  allowed: false;
  gateId: string;
  reason: string;
};

export type ToolCallAllowance = { allowed: true };

export type ToolCallAdmission = ToolCallAllowance | ToolCallRefusal;

export type AgentToolPolicy = {
  toolName: string;
  description: string;
  sideEffect: AgentToolSideEffect;
  riskClass: AgentToolRiskClass;
  approval: AgentToolApproval;
  allowedPhases: readonly AgentToolPhase[];
  dataClasses: readonly string[];
  maxCallsPerRun: number;
  timeoutMs: number;
  /** Zod input schema pinned for AI SDK tools (replaces passthrough). */
  inputSchema: z.ZodType;
  /** Retrieval tools expose response_format (B6). */
  isRetrieval?: boolean;
};

export type RegisteredAgentTool = {
  policy: AgentToolPolicy;
  execute: (args: unknown) => Promise<unknown> | unknown;
};

export function refuseTool(gateId: string, reason: string): ToolCallRefusal {
  return { allowed: false, gateId, reason };
}

export function isToolCallRefusal(value: unknown): value is ToolCallRefusal {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    (value as { allowed?: unknown }).allowed === false &&
    typeof (value as { gateId?: unknown }).gateId === 'string' &&
    typeof (value as { reason?: unknown }).reason === 'string'
  );
}

/** Map a live turn observation (or explicit tool-policy phase) to a tool phase. */
export function toToolPhase(
  phase: AgentTurnPhase | string,
): AgentToolPhase | null {
  if (
    phase === 'intent' ||
    phase === 'plan' ||
    phase === 'make' ||
    phase === 'delivery'
  ) {
    return phase;
  }
  return null;
}

export type ToolCallEvaluationInput = {
  toolName: string;
  phase: AgentTurnPhase | string;
  /** 0-based count of prior successful admissions for this tool in the run. */
  priorCallCount: number;
};

/**
 * Deterministic tool admission (phase / maxCalls / unknown tool).
 * Timeout is enforced at execute wrapper (wall clock), not here.
 */
export function evaluateToolCall(
  policy: AgentToolPolicy | undefined,
  input: ToolCallEvaluationInput,
): ToolCallAdmission {
  if (!policy) {
    return refuseTool(
      'tool_not_registered',
      `Tool "${input.toolName}" is not registered; server-owned registry refuses unknown tools.`,
    );
  }
  const phase = toToolPhase(input.phase);
  if (!phase || !policy.allowedPhases.includes(phase)) {
    return refuseTool(
      'tool_phase_forbidden',
      `Tool "${policy.toolName}" is not allowed in phase "${input.phase}" (allowed: ${policy.allowedPhases.join(',')}).`,
    );
  }
  if (input.priorCallCount >= policy.maxCallsPerRun) {
    return refuseTool(
      'tool_max_calls_exceeded',
      `Tool "${policy.toolName}" exceeded maxCallsPerRun=${policy.maxCallsPerRun}.`,
    );
  }
  return { allowed: true };
}

export class AgentToolRegistry {
  private readonly tools = new Map<string, RegisteredAgentTool>();

  register(tool: RegisteredAgentTool): this {
    if (this.tools.has(tool.policy.toolName)) {
      throw new Error(
        `Agent tool registered more than once: ${tool.policy.toolName}`,
      );
    }
    this.tools.set(tool.policy.toolName, tool);
    return this;
  }

  get(toolName: string): RegisteredAgentTool | undefined {
    return this.tools.get(toolName);
  }

  list(): RegisteredAgentTool[] {
    return [...this.tools.values()];
  }

  policies(): AgentToolPolicy[] {
    return this.list().map((item) => item.policy);
  }

  namesForPhase(phase: AgentTurnPhase | string): string[] {
    const toolPhase = toToolPhase(phase);
    if (!toolPhase) return [];
    return this.list()
      .filter((item) => item.policy.allowedPhases.includes(toolPhase))
      .map((item) => item.policy.toolName);
  }

  /**
   * Build kernel tool map for a phase. Execute path admits via evaluateToolCall
   * and enforces timeoutMs; refusals are model-visible.
   */
  toKernelTools(input: {
    phase: AgentTurnPhase | string;
    /** Mutable per-run call counters (toolName → count admitted). */
    callCounts?: Map<string, number>;
    /** Optional name allowlist (server-owned approvedToolNames ∩ registry). */
    allowNames?: readonly string[];
  }): Record<string, AgentKernelToolDefinition> {
    const callCounts = input.callCounts ?? new Map<string, number>();
    const allow =
      input.allowNames === undefined
        ? null
        : new Set(input.allowNames);
    const out: Record<string, AgentKernelToolDefinition> = {};

    for (const registered of this.list()) {
      const { policy, execute } = registered;
      if (allow && !allow.has(policy.toolName)) continue;
      const toolPhase = toToolPhase(input.phase);
      if (!toolPhase || !policy.allowedPhases.includes(toolPhase)) continue;

      out[policy.toolName] = {
        description: policy.description,
        sideEffect: policy.sideEffect,
        inputSchema: policy.inputSchema,
        execute: async (args) => {
          const prior = callCounts.get(policy.toolName) ?? 0;
          const admission = evaluateToolCall(policy, {
            toolName: policy.toolName,
            phase: input.phase,
            priorCallCount: prior,
          });
          if (!admission.allowed) return admission;

          const result = await runWithTimeout(
            () => Promise.resolve(execute(args)),
            policy.timeoutMs,
            policy.toolName,
          );
          if (isToolCallRefusal(result)) return result;
          callCounts.set(policy.toolName, prior + 1);
          return result;
        },
      };
    }
    return out;
  }
}

async function runWithTimeout<T>(
  run: () => Promise<T>,
  timeoutMs: number,
  toolName: string,
): Promise<T | ToolCallRefusal> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return refuseTool(
      'tool_timeout_invalid',
      `Tool "${toolName}" has invalid timeoutMs=${String(timeoutMs)}.`,
    );
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      run(),
      new Promise<ToolCallRefusal>((resolve) => {
        timer = setTimeout(() => {
          resolve(
            refuseTool(
              'tool_timeout',
              `Tool "${toolName}" exceeded timeoutMs=${timeoutMs}.`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** Shared retrieval arg fragment (B6 response_format). */
export const retrievalArgsBaseSchema = z
  .object({
    response_format: responseFormatSchema.optional().default('concise'),
    query: z.string().min(1).max(500).optional(),
    limit: z.number().int().positive().max(50).optional(),
  })
  .strict();
