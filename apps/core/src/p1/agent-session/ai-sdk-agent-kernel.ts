/**
 * Production AgentKernel adapter (V31-06 / V3.1 §7.3 / §21.4).
 *
 * Thin streamText tool-loop wrapper over the AI SDK — same transport family as
 * model-supply `OpenAiCompatibleAiSdkRunner` (createNativeLanguageModel +
 * languageModelCallSettings). No durable checkpoint surface.
 */

import {
  isStepCount,
  Output,
  streamText,
  tool,
  type LanguageModel,
  type ToolSet,
} from 'ai';
import { z } from 'zod';

import {
  createNativeLanguageModel,
  languageModelCallSettings,
  type AiSdkTelemetryContext,
  type OpenAiCompatibleAiSdkOptions,
} from '../model-supply/ai-sdk-runner.js';
import {
  assertNoDurableCheckpointSurface,
  FixtureAgentKernel,
  type AgentKernel,
  type AgentKernelToolCall,
  type AgentKernelTurnRequest,
  type AgentKernelTurnResult,
} from './agent-kernel.js';
import {
  agentTurnDecisionSchema,
  parseAgentTurnDecision,
  type AgentTurnDecision,
} from './turn-contracts.js';

/**
 * Fallback when a tool definition omits inputSchema (fixture-only paths).
 * Production retrieval tools pin Zod via tool-registry (V31-07).
 */
const agentKernelToolArgsPassthroughSchema = z.object({}).passthrough();

export type AiSdkAgentKernelOptions = {
  model: LanguageModel;
  /** Provider call settings (maxOutputTokens / thinking) from model-supply. */
  callSettings?: ReturnType<typeof languageModelCallSettings>;
  abortSignal?: AbortSignal;
  telemetryContext?: AiSdkTelemetryContext;
};

/**
 * AI SDK streamText AgentKernel. Tools execute through the definitions supplied
 * by the turn runner (which may already wrap wrap_tool_call).
 */
export class AiSdkAgentKernel implements AgentKernel {
  constructor(private readonly options: AiSdkAgentKernelOptions) {
    assertNoDurableCheckpointSurface(this);
  }

  async runTurn(
    request: AgentKernelTurnRequest,
  ): Promise<AgentKernelTurnResult> {
    const toolCalls: AgentKernelToolCall[] = [];
    const tools = buildAiSdkTools(request, toolCalls);

    const result = streamText({
      abortSignal: this.options.abortSignal,
      ...(this.options.callSettings ?? {}),
      model: this.options.model,
      instructions: request.instructions,
      prompt: request.prompt,
      maxRetries: 0,
      tools,
      activeTools: [...request.activeToolNames],
      stopWhen: isStepCount(Math.max(1, request.maxLlmSteps)),
      output: Output.object({
        name: 'beauty_marketing_agent_turn',
        schema: agentTurnDecisionSchema,
      }),
      telemetry: {
        functionId: 'agent-session-turn',
        ...(this.options.telemetryContext
          ? {
              metadata: {
                workspaceId: this.options.telemetryContext.workspaceId,
                actorId: this.options.telemetryContext.actorId,
                taskId: this.options.telemetryContext.taskId,
                modality: this.options.telemetryContext.modality,
                operation: this.options.telemetryContext.operation,
              },
            }
          : {}),
      },
    });

    if (request.onPartial) {
      for await (const partial of result.partialOutputStream) {
        await request.onPartial(partial);
      }
    }

    const [output, steps] = await Promise.all([
      Promise.resolve(result.output),
      Promise.resolve(result.steps),
    ]);
    const decision = parseAgentTurnDecision(output);

    return {
      decision,
      toolCalls,
      steps: steps.length,
    };
  }
}

function buildAiSdkTools(
  request: AgentKernelTurnRequest,
  toolCalls: AgentKernelToolCall[],
): ToolSet {
  const tools: ToolSet = {};
  for (const name of request.activeToolNames) {
    const definition = request.tools[name];
    if (!definition) continue;
    // Dynamic name registration: ToolSet index typing is closed; cast is the
    // same pattern used when assembling server-owned tool maps at runtime.
    tools[name] = tool({
      description: definition.description,
      inputSchema:
        definition.inputSchema ?? agentKernelToolArgsPassthroughSchema,
      execute: async (args) => {
        const result = await definition.execute(args);
        toolCalls.push({ toolName: name, args, result });
        return result;
      },
    }) as ToolSet[string];
  }
  return tools;
}

/**
 * Production factory: bind model-supply direct options (same as
 * OpenAiCompatibleAiSdkRunner / AiSdkStructuredObjectExecutor).
 */
export function createAiSdkAgentKernelFromDirect(
  direct: OpenAiCompatibleAiSdkOptions,
  extras?: Omit<AiSdkAgentKernelOptions, 'model' | 'callSettings'>,
): AiSdkAgentKernel {
  return new AiSdkAgentKernel({
    model: createNativeLanguageModel(direct),
    callSettings: languageModelCallSettings(direct),
    ...extras,
  });
}

const DEFAULT_FIXTURE_DECISION: AgentTurnDecision = {
  merchantMessage: 'fixture-session-turn',
  action: { kind: 'finish_turn' },
  evidenceRefs: [],
  assumptions: [],
};

/**
 * Assembly selector: fixture mode → FixtureAgentKernel (always green);
 * live_verified + direct → AiSdkAgentKernel. Missing live binding → undefined.
 */
export function createSessionAgentKernel(input: {
  mode: string;
  activation?: string | null;
  direct?: OpenAiCompatibleAiSdkOptions | null;
  fixtureDecision?:
    | AgentTurnDecision
    | ((request: AgentKernelTurnRequest) => AgentTurnDecision);
}): AgentKernel | undefined {
  if (input.mode === 'fixture') {
    return new FixtureAgentKernel({
      decision: input.fixtureDecision ?? DEFAULT_FIXTURE_DECISION,
    });
  }
  if (input.activation === 'live_verified' && input.direct) {
    return createAiSdkAgentKernelFromDirect(input.direct);
  }
  return undefined;
}
