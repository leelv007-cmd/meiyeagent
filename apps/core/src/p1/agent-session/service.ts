/**
 * Agent Session Harness service façade (V31-06 / V31-08).
 *
 * Thin assembly over store + turn runner + sole checkpoint writer.
 * Progressive levels + billing UX ports mount here (V31-08) without rewriting
 * the turn-runner core.
 * Plan Compiler mounts in V31-09 (bindPlanCompiler / compilePlan / adjustPlan).
 */

import type { AgentControlLimits, HarnessMiddlewareBinding } from '@meiye/contracts';

import type { AgentSessionStore } from './agent-session-store.js';
import type { AgentKernel, AgentKernelToolDefinition } from './agent-kernel.js';
import type {
  SessionBillingBalancePort,
  SessionBillingQuotePort,
} from './billing-ux.js';
import {
  ThreadCheckpointWriter,
  assertSoleCheckpointWriter,
  registerSoleCheckpointWriter,
  type CompactionSections,
  type RetainedTailMessage,
} from './compaction.js';
import type { ModelContextSource } from './context-projection.js';
import type { RetrievalExperience } from './context-retrieval.js';
import type {
  CompilePlanInput,
  CompilePlanResult,
  PlanCompiler,
} from './plan-compiler.js';
import type { RegisteredPolicy } from './policy-middleware.js';
import type { ProgressiveLevelInput } from './progressive-level.js';
import type { AgentToolRegistry } from './tool-registry.js';
import {
  parseAgentTurnInput,
  type AgentTurnInput,
} from './turn-contracts.js';
import {
  AgentTurnRunner,
  type AgentTurnRunnerResult,
  type ReleaseControlLimitsSource,
} from './turn-runner.js';
import { canonicalPlanPatchFromMerchantInstruction } from './turn-contracts.js';
import type {
  CreateExecutionConfirmationInput,
  CreateExecutionConfirmationResult,
  DecideExecutionConfirmationInput,
  DecideExecutionConfirmationResult,
  ExecutionConfirmationService,
  ExpireExecutionConfirmationInput,
  ExpireExecutionConfirmationResult,
} from './execution-confirmation-service.js';

export type AgentSessionHarnessServiceOptions = {
  store: AgentSessionStore;
  kernel: AgentKernel;
  resolveRelease: (harnessReleaseId: string) => Promise<ReleaseControlLimitsSource>;
  tools?: Record<string, AgentKernelToolDefinition>;
  /** V31-07 server-owned retrieval + governed tool registry (static). */
  toolRegistry?: AgentToolRegistry;
  /**
   * Per-turn registry factory (workspace isolation + creationMode).
   * Preferred in production assembly over a static toolRegistry.
   */
  createToolRegistry?: (input: AgentTurnInput) => AgentToolRegistry;
  /** Server-owned pre-plan lookup; does not depend on model tool choice. */
  retrieveConfirmedExperience?: (input: {
    workspaceId: string;
    threadId: string;
    taskId: string;
    runId: string;
    harnessReleaseId: string;
    storeId: string;
    platform: string;
  }) => Promise<RetrievalExperience[]>;
  /**
   * Factory so each turn can close over fresh knownFields / call counters.
   * When omitted, `policies` static list is used.
   */
  createPolicies?: (
    input: AgentTurnInput,
    authority?: ServerOwnedTurnAuthority,
  ) => readonly RegisteredPolicy[];
  policies?: readonly RegisteredPolicy[];
  contextSource?:
    | ModelContextSource
    | ((input: AgentTurnInput) => ModelContextSource);
  creationMode?: 'customized' | 'free';
  /** Optional resolver when creationMode is turn-dependent. */
  resolveCreationMode?: (
    input: AgentTurnInput,
  ) => 'customized' | 'free' | undefined;
  /** Register this process's sole Thread checkpoint writer (default true). */
  registerCheckpointWriter?: boolean;
  /** V31-08 progressive level facts (carriers / paid units / kill switch). */
  resolveLevelInput?: (
    input: AgentTurnInput,
  ) => ProgressiveLevelInput | Promise<ProgressiveLevelInput>;
  /** V31-08 kill switch: tighten pure-copy exemption only. */
  forceConfirmationKillSwitch?: boolean | (() => boolean | Promise<boolean>);
  /** V31-08 A5 quote port (product quote authority). */
  billingQuotePort?: SessionBillingQuotePort;
  /** V31-08 A5 balance port (credit ledger projection). */
  billingBalancePort?: SessionBillingBalancePort;
  /**
   * V31-09 Plan Compiler. May be bound at construction or later via
   * bindPlanCompiler when production ports assemble after the harness shell.
   */
  planCompiler?: PlanCompiler;
  /**
   * V31-11 confirmation objects (create reserve + decide + hold expiry).
   * Bound from production assembly onto the Session confirmation path.
   */
  executionConfirmation?: ExecutionConfirmationService;
};

/**
 * Internal-only projection used by production adapters. It is deliberately
 * outside AgentTurnInput so a browser/model cannot supply level, known-field,
 * or high-risk authority.
 */
export type ServerOwnedTurnAuthority = {
  progressiveLevel: Omit<ProgressiveLevelInput, 'merchantMessage'>;
  knownFields: readonly string[];
  impactByKey?: ReadonlyMap<string, import('./ambiguity-policy.js').ImpactCategory>;
  authoritativeKeys?: ReadonlySet<string>;
};

export type ComposerSessionTurnInput = {
  resourceId: string;
  threadId: string;
  runId: string;
  actorId: string;
  sessionRevision: number;
  harnessReleaseId: string;
  merchantMessage: string;
  creationMode: 'customized' | 'free';
  platform: string;
  activeTaskRef: { taskId: string; workflowId: string };
  approvedToolNames: string[];
  authority: ServerOwnedTurnAuthority;
};

export class AgentSessionHarnessService {
  readonly checkpointWriter: ThreadCheckpointWriter;
  private readonly options: AgentSessionHarnessServiceOptions;
  private planCompiler: PlanCompiler | undefined;
  private executionConfirmation: ExecutionConfirmationService | undefined;

  constructor(options: AgentSessionHarnessServiceOptions) {
    this.options = options;
    this.planCompiler = options.planCompiler;
    this.executionConfirmation = options.executionConfirmation;
    this.checkpointWriter = new ThreadCheckpointWriter(options.store);
    assertSoleCheckpointWriter(this.checkpointWriter);
    if (options.registerCheckpointWriter !== false) {
      registerSoleCheckpointWriter(this.checkpointWriter);
    }
  }

  /** Late-bind Plan Compiler after deterministic quote/rights/model ports exist. */
  bindPlanCompiler(compiler: PlanCompiler): void {
    this.planCompiler = compiler;
  }

  getPlanCompiler(): PlanCompiler | undefined {
    return this.planCompiler;
  }

  /**
   * Late-bind confirmation service (V31-11) onto the Session confirmation path.
   * createRequest must complete balance check + FEFO reserve before the card waits.
   */
  bindExecutionConfirmation(service: ExecutionConfirmationService): void {
    this.executionConfirmation = service;
  }

  getExecutionConfirmation(): ExecutionConfirmationService | undefined {
    return this.executionConfirmation;
  }

  async createExecutionConfirmation(
    input: CreateExecutionConfirmationInput,
  ): Promise<CreateExecutionConfirmationResult> {
    return this.requireExecutionConfirmation().createRequest(input);
  }

  async decideExecutionConfirmation(
    input: DecideExecutionConfirmationInput,
  ): Promise<DecideExecutionConfirmationResult> {
    return this.requireExecutionConfirmation().decide(input);
  }

  async expireExecutionConfirmationHold(
    input: ExpireExecutionConfirmationInput,
  ): Promise<ExpireExecutionConfirmationResult> {
    return this.requireExecutionConfirmation().expireHold(input);
  }

  async compilePlan(input: CompilePlanInput): Promise<CompilePlanResult> {
    return this.requirePlanCompiler().compile(input);
  }

  async adjustPlan(
    input: CompilePlanInput & { existingPlanId: string },
  ): Promise<CompilePlanResult> {
    return this.requirePlanCompiler().adjust(input);
  }

  /**
   * Public coordination seam for commit-strip/steering revisions. Callers
   * provide their server-owned compile context and merchant instruction; this
   * method owns the canonical patch shape and append-only adjustment.
   */
  async revisePlanFromMerchantInstruction(
    input: CompilePlanInput & {
      existingPlanId: string;
      merchantInstruction: string;
    },
  ): Promise<CompilePlanResult> {
    const instruction = input.merchantInstruction.trim();
    if (!instruction) {
      throw new Error('Plan revision requires a merchant instruction.');
    }
    const { merchantInstruction: _merchantInstruction, ...compile } = input;
    return this.requirePlanCompiler().adjust({
      ...compile,
      patch: canonicalPlanPatchFromMerchantInstruction(instruction),
    });
  }

  async retrieveConfirmedExperience(input: {
    workspaceId: string;
    threadId: string;
    taskId: string;
    runId: string;
    harnessReleaseId: string;
    storeId: string;
    platform: string;
  }): Promise<RetrievalExperience[]> {
    if (!this.options.retrieveConfirmedExperience) {
      throw new Error(
        'Server-owned confirmed experience retrieval is not configured.'
      );
    }
    return this.options.retrieveConfirmedExperience(input);
  }

  private requirePlanCompiler(): PlanCompiler {
    if (!this.planCompiler) {
      throw new Error(
        'PlanCompiler is not bound on AgentSessionHarnessService (V31-09 assembly required).',
      );
    }
    return this.planCompiler;
  }

  private requireExecutionConfirmation(): ExecutionConfirmationService {
    if (!this.executionConfirmation) {
      throw new Error(
        'ExecutionConfirmationService is not bound on AgentSessionHarnessService (V31-11 assembly required).',
      );
    }
    return this.executionConfirmation;
  }

  createTurnRunner(input: {
    resourceId: string;
    readOnly?: boolean;
    turn?: AgentTurnInput;
    authority?: ServerOwnedTurnAuthority;
  }): AgentTurnRunner {
    const policies =
      input.turn && this.options.createPolicies
        ? this.options.createPolicies(input.turn, input.authority)
        : this.options.policies;
    const toolRegistry =
      input.turn && this.options.createToolRegistry
        ? this.options.createToolRegistry(input.turn)
        : this.options.toolRegistry;
    const creationMode =
      (input.turn && this.options.resolveCreationMode?.(input.turn)) ??
      this.options.creationMode;
    return new AgentTurnRunner({
      kernel: this.options.kernel,
      resolveRelease: this.options.resolveRelease,
      tools: this.options.tools,
      toolRegistry,
      policies,
      contextSource: this.options.contextSource,
      checkpointWriter: this.checkpointWriter,
      resourceId: input.resourceId,
      readOnly: input.readOnly,
      creationMode,
      resolveLevelInput: this.options.resolveLevelInput,
      forceConfirmationKillSwitch: this.options.forceConfirmationKillSwitch,
      billingQuotePort: this.options.billingQuotePort,
      billingBalancePort: this.options.billingBalancePort,
      ...(input.authority
        ? {
            resolveLevelInput: (turn: AgentTurnInput) => ({
              merchantMessage: turn.merchantMessage,
              ...input.authority!.progressiveLevel,
            }),
          }
        : {}),
    });
  }

  /** Production Composer seam: structured authority enters before PlanCompiler. */
  async runComposerTurn(
    input: ComposerSessionTurnInput,
  ): Promise<AgentTurnRunnerResult> {
    const turn: AgentTurnInput = {
      threadId: input.threadId,
      runId: input.runId,
      workspaceId: input.resourceId,
      actorId: input.actorId,
      phase: 'intent',
      merchantMessage: input.merchantMessage,
      proactiveMode: 'balanced',
      creationMode: input.creationMode,
      platform: input.platform,
      sessionRevision: input.sessionRevision,
      activeTaskRef: input.activeTaskRef,
      approvedToolNames: [...input.approvedToolNames],
      // Parsed for shape only. AgentTurnRunner replaces it with the exact
      // HarnessRelease control limits before model/tool execution.
      limits: {
        maxLlmSteps: 1,
        maxToolCalls: 1,
        maxRetrievalCalls: 1,
        maxMerchantQuestions: 1,
        maxReplans: 0,
        maxSchemaRepairs: 0,
        maxContextTokens: 1,
        maxDelegations: 0,
      },
      harnessReleaseId: input.harnessReleaseId,
    };
    return this.runTurn({
      resourceId: input.resourceId,
      readOnly: true,
      turn,
      authority: input.authority,
    });
  }

  async runTurn(input: {
    resourceId: string;
    turn: unknown;
    readOnly?: boolean;
    /** Internal production authority; never accepted from an HTTP payload. */
    authority?: ServerOwnedTurnAuthority;
  }): Promise<AgentTurnRunnerResult> {
    // Per-turn factories need a parsed turn before constructing the runner.
    if (this.options.createPolicies || this.options.createToolRegistry) {
      const turn = parseAgentTurnInput(input.turn);
      const runner = this.createTurnRunner({
        resourceId: input.resourceId,
        readOnly: input.readOnly,
        turn,
        authority: input.authority,
      });
      return runner.run(turn);
    }
    const runner = this.createTurnRunner({
      resourceId: input.resourceId,
      readOnly: input.readOnly,
      authority: input.authority,
    });
    return runner.run(input.turn);
  }

  async compact(input: {
    resourceId: string;
    threadId: string;
    sections: CompactionSections;
    retainedTail: RetainedTailMessage[];
    now: string;
    previousSummary?: string | null;
  }) {
    return this.checkpointWriter.write(input);
  }
}

export type { AgentControlLimits, HarnessMiddlewareBinding };
