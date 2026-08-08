/**
 * Agent Session Harness turn runner (V31-06 / V3.1 §21.4).
 *
 * Orchestrates: release controlLimits (U11) → context projection → middleware
 * → AgentKernel (no durable ckpt) → system-only intercept → decision parse →
 * partial activity → optional compaction.
 *
 * Read-only session turns (durability=exit) must not call paid primitives such
 * as `record` — enforced via tool call log + didNotCall helper.
 */

import type {
  AgentControlLimits,
  HarnessMiddlewareBinding,
  HarnessReleaseArtifact,
} from '@meiye/contracts';

import { P1DomainError } from '../foundation/domain.js';
import { assertControlLimitsFullySet } from '../harness/harness-release.js';
import type { AgentKernel, AgentKernelToolDefinition } from './agent-kernel.js';
import { assertNoDurableCheckpointSurface } from './agent-kernel.js';
import {
  buildModelContextProjection,
  type ModelContextProjection,
  type ModelContextSource,
} from './context-projection.js';
import type {
  CompactionWriteResult,
  ThreadCheckpointWriter,
} from './compaction.js';
import { applyIntentRetrievalDecisionPatch } from './intent-retrieval-policies.js';
import { PartialActivityBuffer } from './partial-activity.js';
import {
  PolicyMiddlewareRunner,
  type PolicyControlDecision,
  type RegisteredPolicy,
} from './policy-middleware.js';
import {
  canTransition,
  transition,
  type SessionHarnessState,
} from './state-machine.js';
import { interceptSystemOnlyProposal } from './system-only-intercept.js';
import type { AgentToolRegistry } from './tool-registry.js';
import {
  parseAgentTurnDecision,
  parseAgentTurnInput,
  type AgentTurnDecision,
  type AgentTurnInput,
} from './turn-contracts.js';

export type ToolCallLogEntry = {
  toolName: string;
  args: unknown;
  sideEffect: AgentKernelToolDefinition['sideEffect'];
};

/**
 * Quick-check style helper (V31-08 will promote to shared registry).
 * Negative assertion for read-only session turns.
 */
export function didNotCall(
  toolCalls: readonly ToolCallLogEntry[],
  toolName: string,
): boolean {
  return !toolCalls.some((call) => call.toolName === toolName);
}

export function toolOrder(
  toolCalls: readonly ToolCallLogEntry[],
  expected: readonly string[],
): boolean {
  const names = toolCalls.map((call) => call.toolName);
  let index = 0;
  for (const name of names) {
    if (name === expected[index]) index += 1;
    if (index === expected.length) return true;
  }
  return index === expected.length;
}

export type ReleaseControlLimitsSource = {
  /**
   * Frozen release artifact or partial controlLimits bag.
   * Unset keys fail closed via assertControlLimitsFullySet (U11).
   */
  controlLimits: unknown;
  middlewareBindings?: readonly HarnessMiddlewareBinding[];
  releaseId?: string;
};

export type AgentTurnRunnerDeps = {
  kernel: AgentKernel;
  /** Resolve release pin for the turn; must return fully calibrated limits. */
  resolveRelease: (harnessReleaseId: string) => Promise<ReleaseControlLimitsSource>;
  tools?: Record<string, AgentKernelToolDefinition>;
  /**
   * V31-07: server-owned tool registry. When set, tools for the turn are
   * `registry.toKernelTools(phase) ∩ approvedToolNames` (registry wins merge).
   */
  toolRegistry?: AgentToolRegistry;
  policies?: readonly RegisteredPolicy[];
  contextSource?: ModelContextSource | ((input: AgentTurnInput) => ModelContextSource);
  activity?: PartialActivityBuffer;
  checkpointWriter?: ThreadCheckpointWriter;
  /** When true (default for exit/read-only), reject paid tool side effects. */
  readOnly?: boolean;
  resourceId?: string;
  initialState?: SessionHarnessState;
  /** Optional creation mode for projection (D-175 free layering). */
  creationMode?: 'customized' | 'free';
};

export type AgentTurnRunnerResult = {
  decision: AgentTurnDecision | null;
  state: SessionHarnessState;
  toolCalls: ToolCallLogEntry[];
  projection: ModelContextProjection;
  controlLimits: AgentControlLimits;
  systemOnlyBlock: ReturnType<typeof interceptSystemOnlyProposal> | null;
  policyDecision: PolicyControlDecision;
  activityStableId: string;
  compaction: CompactionWriteResult | null;
  releaseId: string;
  /** Middleware state bag (question budget / high-risk filters). */
  policyState: Record<string, unknown>;
};

export class AgentTurnRunner {
  private readonly activity: PartialActivityBuffer;
  private state: SessionHarnessState;

  constructor(private readonly deps: AgentTurnRunnerDeps) {
    assertNoDurableCheckpointSurface(deps.kernel);
    this.activity = deps.activity ?? new PartialActivityBuffer();
    this.state = deps.initialState ?? 'idle';
  }

  get currentState(): SessionHarnessState {
    return this.state;
  }

  async run(rawInput: unknown): Promise<AgentTurnRunnerResult> {
    const input = parseAgentTurnInput(rawInput);

    // U11: control limits only from release-frozen binding; unset rejects production path.
    const release = await this.deps.resolveRelease(input.harnessReleaseId);
    let controlLimits: AgentControlLimits;
    try {
      controlLimits = assertControlLimitsFullySet(release.controlLimits);
    } catch (error) {
      const message =
        error instanceof P1DomainError
          ? error.message
          : error instanceof Error
            ? error.message
            : String(error);
      throw new P1DomainError(
        'INVALID_STATE',
        `AgentControlLimits unset or incomplete for release ${input.harnessReleaseId}; refuse production path (U11): ${message}`,
      );
    }

    // Prefer release limits over any client-supplied bag (server authority).
    const authoritativeInput: AgentTurnInput = {
      ...input,
      limits: controlLimits,
    };

    this.advance('interpreting');

    const source =
      typeof this.deps.contextSource === 'function'
        ? this.deps.contextSource(authoritativeInput)
        : (this.deps.contextSource ?? {
            merchantRequest: {
              text: authoritativeInput.merchantMessage,
              ...(this.deps.creationMode
                ? { creationMode: this.deps.creationMode }
                : {}),
            },
          });
    const projection = buildModelContextProjection(authoritativeInput, source);

    const bindings = release.middlewareBindings ?? [];
    const middleware = new PolicyMiddlewareRunner(
      bindings,
      this.deps.policies ?? [],
    );

    const middlewareCtx = {
      phase: authoritativeInput.phase,
      runId: authoritativeInput.runId,
      workspaceId: authoritativeInput.workspaceId,
      state: {} as Record<string, unknown>,
    };

    const before = await middleware.runBeforeModel(middlewareCtx);
    if (before.control !== 'continue') {
      return this.earlyExit({
        input: authoritativeInput,
        projection,
        controlLimits,
        policyDecision: before,
        toolCalls: [],
        releaseId: release.releaseId ?? authoritativeInput.harnessReleaseId,
      });
    }

    // Server-owned tools: registry (V31-07) merged over static map; approved ∩ registered.
    const staticTools = this.deps.tools ?? {};
    const registryTools = this.deps.toolRegistry
      ? this.deps.toolRegistry.toKernelTools({
          phase: authoritativeInput.phase,
          allowNames: authoritativeInput.approvedToolNames,
        })
      : {};
    const tools: Record<string, AgentKernelToolDefinition> = {
      ...staticTools,
      ...registryTools,
    };
    const activeToolNames = authoritativeInput.approvedToolNames.filter(
      (name) => name in tools,
    );

    // Retrieval phase when tools will run (state machine signal).
    if (
      activeToolNames.length > 0 &&
      canTransition(this.state, 'retrieving')
    ) {
      this.state = transition(this.state, 'retrieving');
    }

    const activityStableId = `turn-activity:${authoritativeInput.runId}`;
    const readOnly = this.deps.readOnly !== false;

    // wrap_tool_call runs inside tool.execute so AI SDK / Fixture loops hit it.
    const wrappedTools = wrapToolsWithMiddleware({
      tools,
      middleware,
      middlewareCtx,
      readOnly,
    });

    const kernelResult = await middleware.wrapModelCall(middlewareCtx, () =>
      this.deps.kernel.runTurn({
        instructions: `beauty-marketing-agent phase=${authoritativeInput.phase}`,
        prompt: JSON.stringify(projection),
        tools: wrappedTools,
        activeToolNames,
        maxLlmSteps: controlLimits.maxLlmSteps,
        onPartial: async (partial) => {
          this.activity.upsertPartial({
            stableId: activityStableId,
            payload: partial,
            status: 'forming',
          });
        },
      }),
    );

    const toolCalls: ToolCallLogEntry[] = [];
    if (
      kernelResult &&
      typeof kernelResult === 'object' &&
      'toolCalls' in kernelResult
    ) {
      const typed = kernelResult as Awaited<
        ReturnType<AgentKernel['runTurn']>
      >;
      for (const call of typed.toolCalls) {
        const tool = tools[call.toolName];
        const sideEffect = tool?.sideEffect ?? 'none';
        // Refused wrap_tool_call returns a model-visible gate payload; still log.
        toolCalls.push({
          toolName: call.toolName,
          args: call.args,
          sideEffect,
        });
      }
    }

    // Read-only negative gate (acceptance): record must not appear.
    if (readOnly && !didNotCall(toolCalls, 'record')) {
      throw new P1DomainError(
        'FORBIDDEN',
        "Read-only session turn violated didNotCall('record').",
      );
    }

    const rawDecision =
      kernelResult &&
      typeof kernelResult === 'object' &&
      'decision' in kernelResult
        ? (kernelResult as Awaited<ReturnType<AgentKernel['runTurn']>>).decision
        : kernelResult;

    // System-only proposal intercept (after-model layer).
    const systemOnlyBlock = interceptSystemOnlyProposal(rawDecision);
    if (systemOnlyBlock.blocked) {
      this.activity.replaceWithFinal({
        stableId: activityStableId,
        payload: systemOnlyBlock,
      });
      const afterBlocked = await middleware.runAfterModel({
        ...middlewareCtx,
        modelOutput: rawDecision,
      });
      return {
        decision: null,
        state: this.state,
        toolCalls,
        projection,
        controlLimits,
        systemOnlyBlock,
        policyDecision:
          afterBlocked.control === 'continue'
            ? {
                control: 'ask_merchant',
                reason: systemOnlyBlock.reason,
                question: {
                  itemId: 'system_only_block',
                  question: systemOnlyBlock.reason,
                },
              }
            : afterBlocked,
        activityStableId,
        compaction: null,
        releaseId: release.releaseId ?? authoritativeInput.harnessReleaseId,
        policyState: { ...middlewareCtx.state },
      };
    }

    let decision = parseAgentTurnDecision(rawDecision);

    // hypothesis_ready after successful decision parse (pre-policy).
    if (canTransition(this.state, 'hypothesis_ready')) {
      this.state = transition(this.state, 'hypothesis_ready');
    }

    const after = await middleware.runAfterModel({
      ...middlewareCtx,
      modelOutput: decision,
    });

    // V31-07: apply question-budget / high-risk assumption patches onto decision.
    decision = applyIntentRetrievalDecisionPatch(decision, middlewareCtx.state);
    // Policy may force ask_merchant control without mutating decision — honor it.
    if (
      after.control === 'ask_merchant' &&
      decision.action.kind !== 'ask_merchant' &&
      after.question
    ) {
      decision = {
        ...decision,
        action: { kind: 'ask_merchant', question: after.question },
      };
    }

    this.activity.replaceWithFinal({
      stableId: activityStableId,
      payload: decision,
    });

    if (decision.action.kind === 'ask_merchant') {
      if (canTransition(this.state, 'awaiting_clarification')) {
        this.state = transition(this.state, 'awaiting_clarification');
      }
    } else if (
      decision.action.kind === 'propose_plan' ||
      decision.action.kind === 'patch_plan'
    ) {
      if (canTransition(this.state, 'plan_compiling')) {
        this.state = transition(this.state, 'plan_compiling');
      } else if (canTransition(this.state, 'handing_off')) {
        this.state = transition(this.state, 'handing_off');
      }
    } else if (decision.action.kind === 'finish_turn') {
      if (canTransition(this.state, 'handing_off')) {
        this.state = transition(this.state, 'handing_off');
      }
    }

    let compaction: CompactionWriteResult | null = null;
    if (this.deps.checkpointWriter && this.deps.resourceId) {
      compaction = await this.deps.checkpointWriter.write({
        resourceId: this.deps.resourceId,
        threadId: authoritativeInput.threadId,
        sections: {
          goal: decision.merchantMessage.slice(0, 500),
          progress: `phase=${authoritativeInput.phase}; action=${decision.action.kind}`,
          keyDecisions: decision.assumptions
            .map((item) => `${item.key}:${item.statement}`)
            .join('; ')
            .slice(0, 1_000),
          nextSteps: decision.action.kind,
          criticalContext: projection.threadSummary ?? '',
          referencedObjects: decision.evidenceRefs.slice(0, 20),
        },
        retainedTail: [
          { role: 'user', text: authoritativeInput.merchantMessage },
          { role: 'assistant', text: decision.merchantMessage },
        ],
        now: new Date().toISOString(),
        previousSummary: projection.threadSummary ?? null,
      });
      // U4: failure must not block the turn (blocked:false always).
    }

    return {
      decision,
      state: this.state,
      toolCalls,
      projection,
      controlLimits,
      systemOnlyBlock: null,
      policyDecision: after,
      activityStableId,
      compaction,
      releaseId: release.releaseId ?? authoritativeInput.harnessReleaseId,
      policyState: { ...middlewareCtx.state },
    };
  }

  private advance(to: SessionHarnessState): void {
    this.state = transition(this.state, to);
  }

  private earlyExit(args: {
    input: AgentTurnInput;
    projection: ModelContextProjection;
    controlLimits: AgentControlLimits;
    policyDecision: PolicyControlDecision;
    toolCalls: ToolCallLogEntry[];
    releaseId: string;
  }): AgentTurnRunnerResult {
    const activityStableId = `turn-activity:${args.input.runId}`;
    this.activity.replaceWithFinal({
      stableId: activityStableId,
      payload: { policy: args.policyDecision },
    });
    return {
      decision: null,
      state: this.state,
      toolCalls: args.toolCalls,
      projection: args.projection,
      controlLimits: args.controlLimits,
      systemOnlyBlock: null,
      policyDecision: args.policyDecision,
      activityStableId,
      compaction: null,
      releaseId: args.releaseId,
      policyState: {},
    };
  }
}

/** Convenience: extract controlLimits from a full release artifact. */
export function controlLimitsFromArtifact(
  artifact: HarnessReleaseArtifact,
): ReleaseControlLimitsSource {
  return {
    controlLimits: artifact.controlLimits,
    middlewareBindings: artifact.middlewareBindings,
    releaseId: artifact.releaseId,
  };
}

function wrapToolsWithMiddleware(input: {
  tools: Record<string, AgentKernelToolDefinition>;
  middleware: PolicyMiddlewareRunner;
  middlewareCtx: {
    phase: string;
    runId: string;
    workspaceId: string;
    state: Record<string, unknown>;
  };
  readOnly: boolean;
}): Record<string, AgentKernelToolDefinition> {
  const wrapped: Record<string, AgentKernelToolDefinition> = {};
  for (const [name, definition] of Object.entries(input.tools)) {
    wrapped[name] = {
      ...definition,
      execute: async (args) => {
        if (
          input.readOnly &&
          (definition.sideEffect === 'paid' || name === 'record')
        ) {
          throw new P1DomainError(
            'FORBIDDEN',
            `Read-only session turn must not invoke paid/side-effect tool "${name}".`,
          );
        }
        const outcome = await input.middleware.wrapToolCall(
          {
            ...input.middlewareCtx,
            toolName: name,
            toolArgs: args,
          },
          async () => definition.execute(args),
        );
        if (
          outcome &&
          typeof outcome === 'object' &&
          'allowed' in outcome &&
          (outcome as { allowed: boolean }).allowed === false
        ) {
          // Model-visible refusal (gate id + reason); do not throw the turn.
          return outcome;
        }
        return outcome;
      },
    };
  }
  return wrapped;
}
