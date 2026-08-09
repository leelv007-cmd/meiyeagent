/**
 * Composer submission → Agent Thread/Run + PlanCompiler production boundary.
 *
 * The browser may suggest a continuation Thread, but this coordinator resolves
 * it only through the workspace-scoped AgentSessionStore. Stable ids make a
 * retried submission reuse its Run instead of appending another plan revision.
 */

import {
  planMemoryContextSchema,
  type ExecutionPlanApprovalBasis,
  type MarketingPlanRevision,
  type PlanMemoryContext,
} from '@meiye/contracts';

import type {
  ComposerAgentBinding,
  ComposerSubmissionAgentPlanningPort,
  CreationSubmissionRecord,
} from '../execution-spine/submission-coordinator.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import { isAgentMemoryDisabledError } from '../operations/agent-memory-platform.js';
import type { ExecutionPlanCompileFreeze } from '../harness/execution-plan-admission.js';
import type { AgentSessionStore } from './agent-session-store.js';
import type { RetrievalExperience } from './context-retrieval.js';
import type { CompilePlanInput, CompilePlanResult } from './plan-compiler.js';
import type { MarketingPlanStore } from './plan-store.js';
import type { AgentTurnInput, PlanProposal } from './turn-contracts.js';
import type { AgentTurnRunnerResult } from './turn-runner.js';

export type ComposerPlanCompilerPort = {
  compilePlan(input: CompilePlanInput): Promise<CompilePlanResult>;
  adjustPlan(
    input: CompilePlanInput & { existingPlanId: string }
  ): Promise<CompilePlanResult>;
  /**
   * V31-18 P0-2 (可达性): server-owned confirmed-experience retrieval is
   * REQUIRED, not opportunistic. It is derived from the production Composer
   * surface — a deploy that can accept a submission can always retrieve
   * confirmed memory — and must never be inferred from the presence of an
   * LLM kernel (`runTurn`), which is absent whenever the provider is not
   * `live_verified`.
   */
  retrieveConfirmedExperience(input: {
    workspaceId: string;
    threadId: string;
    taskId: string;
    runId: string;
    harnessReleaseId: string;
    storeId: string;
    platform: string;
  }): Promise<RetrievalExperience[]>;
  runTurn?(input: {
    resourceId: string;
    turn: AgentTurnInput;
    readOnly?: boolean;
  }): Promise<Pick<AgentTurnRunnerResult, 'releaseId' | 'toolCalls'>>;
};

/**
 * Why a plan carries no injected memory. `kill_switch` is a deliberate ops
 * action; `unavailable` is an outage or a receipt conflict. The two must never
 * be indistinguishable from each other or from a silent success.
 */
export type ComposerPlanMemoryDegradation = {
  workspaceId: string;
  taskId: string;
  runId: string;
  reason: 'kill_switch' | 'unavailable';
  detail: string;
};

export type ComposerPlanSessionOptions = {
  now?: () => string;
  resolveHarnessReleaseId?: (
    submission: CreationSubmissionRecord
  ) => string | Promise<string>;
  /**
   * V31-18 P0-1 (出口): memory is advisory. `prepare()` runs *after*
   * `store.claim()` has already consumed the merchant's credits, so a
   * memory-layer failure degrades the plan to "no injected memory, therefore
   * no receipt" instead of failing a paid submission. Every degradation is
   * reported here so it is never silent.
   */
  onMemoryDegraded?: (event: ComposerPlanMemoryDegradation) => void;
};

const COMPOSER_PLAN_HARNESS_RELEASE_ID = 'composer-plan-surface-v1';
const COMPOSER_SESSION_LIMITS = {
  maxLlmSteps: 6,
  maxToolCalls: 12,
  maxRetrievalCalls: 6,
  maxMerchantQuestions: 1,
  maxReplans: 2,
  maxSchemaRepairs: 2,
  maxContextTokens: 32_000,
  maxDelegations: 2,
} as const;

export class ComposerPlanSessionCoordinator
  implements ComposerSubmissionAgentPlanningPort
{
  private readonly now: () => string;
  private readonly resolveHarnessReleaseId: (
    submission: CreationSubmissionRecord
  ) => string | Promise<string>;
  private readonly onMemoryDegraded:
    | ((event: ComposerPlanMemoryDegradation) => void)
    | undefined;

  constructor(
    private readonly sessions: AgentSessionStore,
    private readonly plans: MarketingPlanStore,
    private readonly compiler: ComposerPlanCompilerPort,
    options: ComposerPlanSessionOptions = {}
  ) {
    // Assembly-layer reachability assertion (V31-18 P0-2). A bare
    // `{ compilePlan, adjustPlan }` fallback — the shape a non-`live_verified`
    // production deploy used to get — cannot construct this coordinator, so
    // confirmed memory can no longer be skipped silently in production.
    if (typeof compiler.retrieveConfirmedExperience !== 'function') {
      throw new Error(
        'Composer plan session requires server-owned confirmed experience retrieval.'
      );
    }
    this.now = options.now ?? (() => new Date().toISOString());
    this.resolveHarnessReleaseId =
      options.resolveHarnessReleaseId ??
      (() => COMPOSER_PLAN_HARNESS_RELEASE_ID);
    this.onMemoryDegraded = options.onMemoryDegraded;
  }

  async prepare(input: {
    continuationThreadId?: string;
    submission: CreationSubmissionRecord;
  }): Promise<ComposerAgentBinding> {
    const { submission } = input;
    const resourceId = submission.snapshot.workspaceId;
    const runId = composerRunId(submission);
    const existingRun = await this.sessions.getRun({ resourceId, runId });
    const threadId =
      existingRun?.threadId ??
      input.continuationThreadId?.trim() ??
      composerThreadId(submission);
    const planId = composerPlanId(resourceId, threadId);
    const now = this.now();

    let thread = await this.sessions.getThread({ resourceId, threadId });
    if (!thread) {
      thread = await this.sessions.createThread({
        resourceId,
        threadId,
        title: submission.snapshot.intent.text.slice(0, 500),
        now,
      });
    }

    const started = existingRun
      ? { thread, run: existingRun }
      : await this.sessions.startWriteTurn({
          resourceId,
          threadId,
          expectedSessionRevision: thread.sessionRevision,
          runId,
          trigger: 'merchant_turn',
          harnessReleaseId: await this.resolveHarnessReleaseId(submission),
          now,
        });

    const latest = await this.plans.getLatest(planId);
    const alreadyCompiled =
      existingRun?.status === 'completed' ||
      latest?.revision.boundRevisions.intentRevision ===
        started.thread.sessionRevision;

    if (!alreadyCompiled) {
      if (
        started.run.status === 'failed' ||
        started.run.status === 'cancelled'
      ) {
        throw new Error(
          `Composer Agent Run ${runId} cannot resume from ${started.run.status}.`
        );
      }
      // The read-only pre-plan turn runs for its own effects. Its `releaseId`
      // is deliberately NOT the injection binding (V31-18 P2-10): the receipt
      // used to record the turn's release while the plan bound the Run's, so
      // the transparency artifact named a release the plan never used. One
      // value now drives both, and it is the one the plan binds.
      await this.runSessionTurn({
        submission,
        threadId,
        runId,
        sessionRevision: started.thread.sessionRevision,
        harnessReleaseId: started.run.harnessReleaseId,
      });
      const memoryContext = await this.retrievePlanMemoryContext({
        submission,
        threadId,
        runId,
        harnessReleaseId: started.run.harnessReleaseId,
      });
      // V31-18 P0-1 (出口证明): planning failures propagate but must NOT close
      // the Run terminally. `submit()` consumed the merchant's credits inside
      // `store.claim()` *before* calling `prepare()`, and `composerRunId` is a
      // deterministic function of workspace+task — a terminal Run here would
      // make the retry with the same idempotencyKey hit `cannot resume from
      // failed` forever, holding the credits with no exit. Leaving the Run
      // non-terminal IS the exit: the retry re-enters this branch and
      // recompiles against the same session revision.
      await this.compile({
        submission,
        threadId,
        runSessionRevision: started.thread.sessionRevision,
        planId,
        previous: latest?.revision ?? null,
        harnessReleaseId: started.run.harnessReleaseId,
        memoryContext,
        now,
      });
    } else if (latest) {
      // V31-18 P0-1 (出口证明, second half): skipping compile must not skip the
      // freeze. `executionPlanFreeze` is in-memory only — `storedSubmission`
      // has no key for it — so every replay that rebuilds the record from
      // `execution_spine.creation_submissions` (`submit()`'s existing-receipt
      // branch and `recoverPendingStarts()`) arrives with it unset. Leaving it
      // unset made the *recovered* submission fall through
      // `task-admission.ts:427` onto the legacy five-stage branch: the retry
      // stopped being bricked but silently lost its ExecutionPlanSnapshot. The
      // compiled plan is durable and immutable, so rebuild the identical freeze
      // from it instead of recompiling.
      input.submission.executionPlanFreeze = compileFinalizeExecutionPlanFreeze(
        {
          result: latest,
          contextBundleId: submission.snapshot.briefContext.id,
          contextRevision: String(submission.snapshot.briefContext.revision),
          approvalBasis: approvalBasisForSubmission(submission.snapshot.lens),
        }
      );
    }

    const currentRun = await this.sessions.getRun({ resourceId, runId });
    if (
      currentRun &&
      (currentRun.status === 'running' || currentRun.status === 'waiting')
    ) {
      await this.sessions.updateRunStatus({
        resourceId,
        runId,
        status: 'completed',
        finishedAt: this.now(),
      });
    }

    return { threadId, runId };
  }

  private async runSessionTurn(input: {
    submission: CreationSubmissionRecord;
    threadId: string;
    runId: string;
    sessionRevision: number;
    harnessReleaseId: string;
  }): Promise<Pick<AgentTurnRunnerResult, 'releaseId' | 'toolCalls'> | null> {
    if (!this.compiler.runTurn) return null;
    const snapshot = input.submission.snapshot;
    return this.compiler.runTurn({
      resourceId: snapshot.workspaceId,
      readOnly: true,
      turn: {
        threadId: input.threadId,
        runId: input.runId,
        workspaceId: snapshot.workspaceId,
        actorId: snapshot.actorId,
        phase: 'intent',
        merchantMessage: snapshot.intent.text,
        proactiveMode: 'balanced',
        creationMode: snapshot.creationMode,
        sessionRevision: input.sessionRevision,
        activeTaskRef: {
          taskId: input.submission.task.id,
          workflowId: input.submission.task.id,
        },
        memoryScope: {
          storeId: snapshot.workspaceId,
          platform: snapshot.contentPackagePlatform,
        },
        // Confirmed experience is a server-owned pre-plan lookup below; the
        // model must not control whether this authority is loaded.
        approvedToolNames: [],
        limits: COMPOSER_SESSION_LIMITS,
        harnessReleaseId: input.harnessReleaseId,
      },
    });
  }

  private async retrievePlanMemoryContext(input: {
    submission: CreationSubmissionRecord;
    threadId: string;
    runId: string;
    harnessReleaseId: string;
  }): Promise<PlanMemoryContext | null> {
    const snapshot = input.submission.snapshot;
    let entries: RetrievalExperience[];
    try {
      entries = await this.compiler.retrieveConfirmedExperience({
        workspaceId: snapshot.workspaceId,
        threadId: input.threadId,
        taskId: input.submission.task.id,
        runId: input.runId,
        harnessReleaseId: input.harnessReleaseId,
        storeId: snapshot.workspaceId,
        platform: snapshot.contentPackagePlatform,
      });
    } catch (error) {
      // The receipt is written inside retrieval (transparency invariant:
      // no receipt ⇒ no injection). So a receipt CONFLICT, an outage, or a
      // deliberate `disable_memory_read` all land here and all mean the same
      // thing for this plan: compile without injected memory. They never fail
      // an already-claimed paid submission.
      this.onMemoryDegraded?.({
        workspaceId: snapshot.workspaceId,
        taskId: input.submission.task.id,
        runId: input.runId,
        reason: isAgentMemoryDisabledError(error) ? 'kill_switch' : 'unavailable',
        detail: error instanceof Error ? error.message : String(error),
      });
      return null;
    }
    return planMemoryContextFromConfirmedExperience({
      entries,
      runId: input.runId,
      taskId: input.submission.task.id,
      harnessReleaseId: input.harnessReleaseId,
    });
  }

  private async compile(input: {
    submission: CreationSubmissionRecord;
    threadId: string;
    runSessionRevision: number;
    planId: string;
    previous: MarketingPlanRevision | null;
    harnessReleaseId: string;
    memoryContext: PlanMemoryContext | null;
    now: string;
  }): Promise<void> {
    const snapshot = input.submission.snapshot;
    const compileInput: CompilePlanInput = {
      workspaceId: snapshot.workspaceId,
      resourceId: snapshot.workspaceId,
      threadId: input.threadId,
      planId: input.planId,
      proposal: proposalFromSubmission(input.submission),
      intentRevision: input.runSessionRevision,
      contextBundleId: snapshot.briefContext.id,
      contextRevision: String(snapshot.briefContext.revision),
      harnessReleaseId: input.harnessReleaseId,
      memoryContext: input.memoryContext,
      now: input.now,
      ...(input.submission.usageReservation.credits !== undefined
        ? {
            livingPlanBilling: {
              creditCost: input.submission.usageReservation.credits,
            },
          }
        : {}),
    };

    // V31-12 producer: the compile-finalize boundary freezes the compiled
    // plan so admission can bind the ExecutionPlanSnapshot one-shot.
    const result = input.previous
      ? await this.compiler.adjustPlan({
          ...compileInput,
          existingPlanId: input.planId,
          patch: {
            summary: snapshot.intent.text,
            instructions: snapshot.intent.text,
          },
        })
      : await this.compiler.compilePlan(compileInput);
    input.submission.executionPlanFreeze = compileFinalizeExecutionPlanFreeze({
      result,
      contextBundleId: compileInput.contextBundleId,
      contextRevision: compileInput.contextRevision,
      approvalBasis: approvalBasisForSubmission(snapshot.lens),
    });
  }
}

/**
 * Deterministic bundle fingerprint for the freeze: same bundle + revision
 * always yields the same contextBundleRef.hash (idempotent freeze).
 */
export function compileFinalizeExecutionPlanFreeze(input: {
  result: Pick<CompilePlanResult, 'revision' | 'executionPlan'>;
  contextBundleId: string;
  contextRevision: string;
  approvalBasis: ExecutionPlanApprovalBasis;
}): ExecutionPlanCompileFreeze {
  const { result } = input;
  const revision = result.revision;
  return {
    planId: revision.planId,
    planRevision: revision.revision,
    intentDeclaration: revision.intent,
    contextBundleRef: {
      bundleId: input.contextBundleId,
      revision: Number(input.contextRevision),
      hash: fingerprintValue({
        bundleId: input.contextBundleId,
        revision: input.contextRevision,
      }),
    },
    executionPlan: result.executionPlan,
    deliverables: revision.deliverables,
    quoteRef: revision.quoteRef,
    rightsRevisionRefs: revision.boundRevisions.rightsRevisionIds,
    harnessReleaseId: revision.boundRevisions.harnessReleaseId,
    approvalBasis: input.approvalBasis,
  };
}

/**
 * U9: only pure copy is exempt from confirmation; every paid-media
 * execution freezes as merchant_confirmed. Exemption skips the decision,
 * never the freeze.
 */
export function approvalBasisForSubmission(
  lens: CreationSubmissionRecord['snapshot']['lens'],
): ExecutionPlanApprovalBasis {
  return lens === 'copy' ? 'policy_exempt_copy' : 'merchant_confirmed';
}

function planMemoryContextFromConfirmedExperience(input: {
  entries: RetrievalExperience[];
  runId: string;
  taskId: string;
  harnessReleaseId: string;
}): PlanMemoryContext | null {
  const confirmed = input.entries.filter(
    (entry) => entry.status === 'confirmed' && entry.ref.startsWith('experience:')
  );
  const entries = confirmed.map((entry) => ({
    memoryId: entry.ref.slice('experience:'.length),
    revision: entry.revision,
  }));
  if (entries.length === 0) return null;
  const statements = confirmed.map((entry) => entry.instruction).join('\n');
  const concise = /简洁|简短|精炼/u.test(statements);
  const restrained = /克制|不夸张|少夸张/u.test(statements);
  return planMemoryContextSchema.parse({
    entries,
    receiptRef: {
      harnessReleaseId: input.harnessReleaseId,
      runId: input.runId,
      taskId: input.taskId,
    },
    styleConstraints: {
      forbiddenPhrases: restrained ? ['绝对', '保证', '必然'] : [],
      maxBodyChars: concise ? 32 : 4_000,
      maxSentenceChars: concise ? 24 : 500,
      maxTitleChars: concise ? 24 : 500,
      tones: [
        ...(concise ? (['concise'] as const) : []),
        ...(restrained ? (['restrained'] as const) : []),
      ],
    },
  });
}

export function proposalFromSubmission(
  submission: CreationSubmissionRecord
): PlanProposal {
  const snapshot = submission.snapshot;
  const carrier =
    snapshot.lens === 'copy'
      ? ('copy' as const)
      : snapshot.lens === 'image_text_note'
        ? ('note' as const)
        : ('media' as const);
  const pageQuantity =
    carrier === 'note' ? pageQuantityFromIntent(snapshot.intent.text) : null;
  const quantity = Math.min(50, pageQuantity ?? snapshot.deliverable.quantity);
  const softPromotion = /不要太像广告|少(?:一)?点广告|别太硬|软(?:一)?点/u.test(
    snapshot.intent.text
  );

  return {
    goalNarrative: snapshot.intent.text,
    recommendedDeliverables: [
      {
        carrier,
        platform: snapshot.contentPackagePlatform,
        quantity,
        purpose:
          carrier === 'note'
            ? '小红书图文笔记'
            : carrier === 'copy'
              ? '发布文案'
              : '视觉内容',
      },
    ],
    expressionStrategy: {
      ...(snapshot.beautyVoiceRole ? { voice: snapshot.beautyVoiceRole } : {}),
      ...(softPromotion ? { promotionIntensity: 'soft' } : {}),
    },
    factIntentions: [
      `identity:${snapshot.identity.id}@${snapshot.identity.revision}`,
      `brief:${snapshot.briefContext.id}@${snapshot.briefContext.revision}`,
    ],
    assetIntentions: snapshot.sources.assets.map((asset) => asset.id),
  };
}

function pageQuantityFromIntent(intent: string): number | null {
  const matched = intent.match(/(?:减到|改成|做成|只做)?\s*(\d{1,2})\s*页/u);
  if (!matched?.[1]) return null;
  const quantity = Number(matched[1]);
  return Number.isSafeInteger(quantity) && quantity >= 1 && quantity <= 50
    ? quantity
    : null;
}

function composerThreadId(submission: CreationSubmissionRecord): string {
  return `thread:composer:${fingerprintValue({
    workspaceId: submission.snapshot.workspaceId,
    taskId: submission.task.id,
  }).slice(0, 32)}`;
}

function composerRunId(submission: CreationSubmissionRecord): string {
  return `run:composer:${fingerprintValue({
    workspaceId: submission.snapshot.workspaceId,
    taskId: submission.task.id,
  }).slice(0, 32)}`;
}

function composerPlanId(resourceId: string, threadId: string): string {
  return `plan_${fingerprintValue({ resourceId, threadId }).slice(0, 24)}`;
}
