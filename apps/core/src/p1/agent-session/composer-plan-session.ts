/**
 * Composer submission → Agent Thread/Run + PlanCompiler production boundary.
 *
 * The browser may suggest a continuation Thread, but this coordinator resolves
 * it only through the workspace-scoped AgentSessionStore. Stable ids make a
 * retried submission reuse its Run instead of appending another plan revision.
 */

import {
  planMemoryContextSchema,
  type BuildProductQuoteInput,
  type ExecutionPlanApprovalBasis,
  type MarketingPlanRevision,
  type PlanDeliverable,
  type PlanMemoryContext,
} from '@meiye/contracts';

import { briefSourceRevisionId } from '../creation-experience/postgres-brief-revision-context.js';
import { asAgentThreadIdentity } from '../execution-spine/submission-coordinator.js';
import type {
  ComposerAgentBinding,
  ComposerClarificationResolution,
  ComposerSubmissionAgentPlanningPort,
  CreationSubmissionRecord,
} from '../execution-spine/submission-coordinator.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import { isAgentMemoryDisabledError } from '../operations/agent-memory-platform.js';
import type { ExecutionPlanCompileFreeze } from '../harness/execution-plan-admission.js';
import type { AgentSessionStore } from './agent-session-store.js';
import type { RetrievalExperience } from './context-retrieval.js';
import type {
  CompilePlanInput,
  CompilePlanResult,
  CompiledCarrierExecutionPlan,
  PlanCompilerQuoteResolution,
  PlanCompilerRecipeAuthorityHint,
} from './plan-compiler.js';
import { buildCompiledCarrierExecutionPlans } from './plan-compiler.js';
import type { MarketingPlanStore } from './plan-store.js';
import { projectMarketingPlanReadiness } from './plan-readiness.js';
import {
  canonicalPlanPatchFromMerchantInstruction,
  type PlanProposal,
} from './turn-contracts.js';
import type { AgentTurnRunnerResult } from './turn-runner.js';
import type { ImpactCategory } from './ambiguity-policy.js';
import { projectComposerTurnAuthority } from './composer-turn-authority.js';
import type { ComposerClarificationInterruptPort } from './composer-clarification-interrupt.js';

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
   * LLM kernel (`runComposerTurn`), which is absent whenever the provider is
   * not `live_verified`.
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
  runComposerTurn?(input: {
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
    authority: {
      progressiveLevel: {
        lens: 'copy' | 'note' | 'media' | 'image_text' | 'video';
        carriers: Array<'copy' | 'note' | 'media'>;
        includesPaidMediaExecution: boolean;
        paidMediaUnitResources: string[];
      };
      knownFields: readonly string[];
      impactByKey: ReadonlyMap<string, ImpactCategory>;
      authoritativeKeys: ReadonlySet<string>;
    };
  }): Promise<AgentTurnRunnerResult>;
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
  /** Production must never bypass the Session intent turn. */
  requireSessionTurn?: boolean;
  requireQuoteAuthority?: boolean;
  quoteAuthority?: ComposerPlanQuoteAuthority;
  clarificationInterrupts?: ComposerClarificationInterruptPort;
  resolveHarnessReleaseId?: (
    submission: CreationSubmissionRecord,
    runId: string
  ) => string | Promise<string>;
  /**
   * Compile from the submission when the turn offers no proposal and asks
   * nothing. Only the fixture kernel is allowed this: it is one assembly-level
   * instance whose turn request carries no submission, so it cannot propose
   * this merchant's plan and must not invent one. With a real model the same
   * silence is a paid call that left the plan untouched, and that fails loudly.
   */
  compileFromSubmissionWithoutProposal?: boolean;
  /**
   * V31-18 P0-1 (出口): memory is advisory. `prepare()` runs *after*
   * `store.claim()` has already consumed the merchant's credits, so a
   * memory-layer failure degrades the plan to "no injected memory, therefore
   * no receipt" instead of failing a paid submission. Every degradation is
   * reported here so it is never silent.
   */
  onMemoryDegraded?: (event: ComposerPlanMemoryDegradation) => void;
};

export type ComposerPlanQuoteAuthority = {
  resolveCurrent(input: {
    submission: CreationSubmissionRecord;
  }): Promise<PlanCompilerQuoteResolution>;
  reprice(input: {
    submission: CreationSubmissionRecord;
    merchantInstruction: string;
    quantity: number;
  }): Promise<{
    resolution: PlanCompilerQuoteResolution;
    successorQuote: BuildProductQuoteInput;
  }>;
};

const COMPOSER_PLAN_HARNESS_RELEASE_ID = 'composer-plan-surface-v1';

const CLARIFICATION_ANSWER_MARKER = '商家补充：';

/**
 * V31-28: the clarification answer turn replays the original intent together
 * with the merchant's supplement. The Composer intent-turn projection carries
 * no thread history (`contextSource` is unbound on this assembly), so without
 * this the kernel — fixture and live alike — sees only the bare answer and
 * cannot plan from the request it belongs to.
 */
export function clarificationAnswerTurnMessage(
  intentText: string,
  merchantAnswer: string,
): string {
  return `${intentText}\n${CLARIFICATION_ANSWER_MARKER}${merchantAnswer}`;
}

/** Inverse of {@link clarificationAnswerTurnMessage}; null when not an answer turn. */
export function splitClarificationAnswerTurnMessage(
  message: string,
): { intentText: string; merchantAnswer: string } | null {
  const separator = `\n${CLARIFICATION_ANSWER_MARKER}`;
  const index = message.indexOf(separator);
  if (index < 0) return null;
  return {
    intentText: message.slice(0, index),
    merchantAnswer: message.slice(index + separator.length),
  };
}

export class ComposerPlanSessionCoordinator
  implements ComposerSubmissionAgentPlanningPort
{
  private readonly now: () => string;
  private readonly resolveHarnessReleaseId: (
    submission: CreationSubmissionRecord,
    runId: string
  ) => string | Promise<string>;
  private readonly quoteAuthority?: ComposerPlanQuoteAuthority;
  private readonly onMemoryDegraded:
    | ((event: ComposerPlanMemoryDegradation) => void)
    | undefined;
  private readonly clarificationInterrupts?: ComposerClarificationInterruptPort;
  private readonly compileFromSubmissionWithoutProposal: boolean;

  constructor(
    private readonly sessions: AgentSessionStore,
    private readonly plans: MarketingPlanStore,
    private readonly compiler: ComposerPlanCompilerPort,
    options: ComposerPlanSessionOptions = {}
  ) {
    if (options.requireSessionTurn && !compiler.runComposerTurn) {
      throw new Error('Production Composer requires Session runTurn.');
    }
    if (options.requireQuoteAuthority && !options.quoteAuthority) {
      throw new Error('Production Composer requires ProductQuote authority.');
    }
    this.quoteAuthority = options.quoteAuthority;
    // Assembly-layer reachability assertion (V31-18 P0-2). A bare
    // `{ compilePlan, adjustPlan }` fallback — the shape a non-`live_verified`
    // production deploy used to get — cannot construct this coordinator, so
    // confirmed memory can no longer be skipped silently in production.
    if (typeof compiler.retrieveConfirmedExperience !== 'function') {
      throw new Error(
        'Composer plan session requires server-owned confirmed experience retrieval.'
      );
    }
    this.onMemoryDegraded = options.onMemoryDegraded;
    this.clarificationInterrupts = options.clarificationInterrupts;
    this.compileFromSubmissionWithoutProposal =
      options.compileFromSubmissionWithoutProposal === true;
    this.now = options.now ?? (() => new Date().toISOString());
    this.resolveHarnessReleaseId =
      options.resolveHarnessReleaseId ??
      (() => COMPOSER_PLAN_HARNESS_RELEASE_ID);
  }

  /**
   * A turn that answered, blocked nothing, and asked nothing: it declined to
   * propose. Only the fixture kernel may fall back to the submission here — a
   * missing decision or a system-only block is still a wait with no producer
   * for its exit, and stays parked so the leak keeps its own report.
   */
  private turnDeclinedToPlan(result: AgentTurnRunnerResult | null): boolean {
    if (!this.compileFromSubmissionWithoutProposal) return false;
    const decision = result?.decision;
    if (!decision || result?.systemOnlyBlock) return false;
    return decision.action.kind !== 'ask_merchant';
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
          harnessReleaseId: await this.resolveHarnessReleaseId(submission, runId),
          now,
        });

		const exitRuns = (await this.sessions.listRuns({ resourceId, threadId }))
	  .filter((run) => run.durability === 'exit')
	  .sort((left, right) =>
		left.startedAt.localeCompare(right.startedAt) || left.runId.localeCompare(right.runId),
	  );
	const runIndex = exitRuns.findIndex((run) => run.runId === runId);
	if (runIndex < 0) throw new Error(`Composer Run ${runId} is missing from its Thread.`);
	const expectedIntentRevision = runIndex + 1;
	const revisions = await this.plans.listRevisions(planId);
	const matchingRevisions = revisions.filter((revision) =>
	  revision.boundRevisions.intentRevision === expectedIntentRevision &&
	  revision.intent.summary === submission.snapshot.intent.text &&
	  revision.boundRevisions.contextBundleId === submission.snapshot.briefContext.id &&
	  revision.boundRevisions.contextRevision === String(submission.snapshot.briefContext.revision) &&
	  revision.boundRevisions.harnessReleaseId === started.run.harnessReleaseId,
	);
	if (matchingRevisions.length > 1) {
	  throw new Error(`Composer Run ${runId} has ambiguous durable plan revisions.`);
	}
	const matchedRevision = matchingRevisions[0];
	const exactCompiled = matchedRevision
	  ? await this.plans.getRevision(planId, matchedRevision.revision)
	  : null;
	if (matchedRevision && !exactCompiled) {
	  throw new Error(`Composer Run ${runId} durable plan revision is missing.`);
	}
	if (
	  exactCompiled &&
	  (exactCompiled.revision.boundRevisions.intentRevision !== expectedIntentRevision ||
		!exactCompiled.revision.quoteRef.id ||
		!String(exactCompiled.revision.quoteRef.revision).trim())
	) {
	  throw new Error(`Composer Run ${runId} durable plan binding is invalid.`);
	}
	const latest = await this.plans.getLatest(planId);
	const alreadyCompiled = exactCompiled !== null;
	if (existingRun?.status === 'completed' && !alreadyCompiled) {
	  throw new Error(`Completed Composer Run ${runId} has no exact durable plan revision.`);
	}

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
      const turnResult = await this.runIntentTurn({
        submission,
        threadId,
        runId,
        sessionRevision: started.thread.sessionRevision,
        harnessReleaseId: started.run.harnessReleaseId,
      });
      if (
        this.compiler.runComposerTurn &&
        !isCompilableTurn(turnResult) &&
        !this.turnDeclinedToPlan(turnResult)
      ) {
        try {
          assertTurnCanBeWaitedOn(turnResult);
        } catch (error) {
          // V31-39: neither a plan proposal nor a merchant question means
          // nothing can ever advance this run. Leaving it `running` (or
          // parking it `waiting` with no interrupt to answer) strands it
          // forever; fail it with the real error instead of a fabricated one.
          await this.sessions.updateRunStatus({
            resourceId,
            runId,
            status: 'failed',
            finishedAt: this.now(),
          });
          throw error;
        }
        const interrupted = await this.requestClarificationInterrupt({
          resourceId,
          threadId,
          runId,
          revision: started.thread.sessionRevision,
          turnResult,
        });
        if (!interrupted) {
          await this.sessions.updateRunStatus({
            resourceId,
            runId,
            status: 'failed',
            finishedAt: this.now(),
          });
          throw new Error(
            'Composer Intent turn requires a durable clarification interrupt before it can wait.',
          );
        }
        await this.sessions.updateRunStatus({
          resourceId,
          runId,
          status: 'waiting',
        });
        return { threadId: asAgentThreadIdentity(threadId), runId, makeReady: false };
      }
      const memoryContext = await this.retrievePlanMemoryContext({
        submission,
        threadId,
        runId,
        harnessReleaseId: started.run.harnessReleaseId,
      });
      // V31-18 P0-1 (出口证明): planning failures propagate but must NOT close
      // the Run terminally. `submit()` now runs `prepare()` *before*
      // `store.claim()` (the atomic prepare-before-claim order, V31-39), so a
      // failure here means claim() never ran — nothing is charged yet. But
      // `composerRunId` is a deterministic function of workspace+task, and
      // this Run already exists in the session store from `started` above;
      // marking it `failed` would make the retry's `prepare()` call hit its
      // own `started.run.status === 'failed'` guard (~line 294, "cannot
      // resume from failed") and permanently brick this task. Leaving the
      // Run non-terminal IS the exit: the retry re-enters this branch and
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
        proposal: isCompilableTurn(turnResult)
          ? turnResult.decision.action.proposal
          : proposalFromSubmission(submission),
      });
		} else if (exactCompiled && !submission.executionPlanFreeze) {
	  // A process may die after PlanCompiler durably appends the revision but
	  // before the submission row stores its freeze. Rebuild only from that
	  // durable compiled artifact; never compile/append a second revision.
	  // (V31-18 P0-1, second half: every replay rebuilds the record from
	  // `execution_spine.creation_submissions` and the in-memory freeze is
	  // gone — skipping this rebuild drops the recovered paid submission onto
	  // the legacy admission branch and silently loses its
	  // ExecutionPlanSnapshot.)
	  assignExecutionPlanFreezes(
		submission,
		compileFinalizeExecutionPlanFreezes({
		  result: compileResultFromArtifact(exactCompiled, submission.snapshot.workspaceId),
		  contextBundleId: submission.snapshot.briefContext.id,
		  contextRevision: String(submission.snapshot.briefContext.revision),
		  approvalBasis: approvalBasisForDeliverables(exactCompiled.revision.deliverables),
		}),
	  );
    }

    const currentRun = await this.sessions.getRun({ resourceId, runId });
    const packageBasis =
      submission.executionPlanFreeze?.approvalBasis ??
      approvalBasisForSubmission(submission.snapshot.lens);
    const makeReady =
      !this.compiler.runComposerTurn || packageBasis === 'policy_exempt_copy';
    if (makeReady && currentRun &&
      (currentRun.status === 'running' || currentRun.status === 'waiting')) {
      await this.sessions.updateRunStatus({
        resourceId,
        runId,
        status: 'completed',
        finishedAt: this.now(),
      });
    }

    const binding = {
      threadId: asAgentThreadIdentity(threadId),
      runId,
      makeReady,
    };
    submission.agentBinding = { threadId: binding.threadId, runId };
    return binding;
  }

  async answerClarification(input: {
    submission: CreationSubmissionRecord;
    merchantAnswer: string;
  }): Promise<ComposerAgentBinding> {
    const answer = input.merchantAnswer.trim();
    if (!answer) throw new Error('Clarification answer is required.');
    const resourceId = input.submission.snapshot.workspaceId;
    const runId = composerRunId(input.submission);
    const run = await this.sessions.getRun({ resourceId, runId });
    if (!run || run.status !== 'waiting') {
      throw new Error('Composer clarification requires a waiting Session run.');
    }
    const thread = await this.sessions.getThread({
      resourceId,
      threadId: asAgentThreadIdentity(run.threadId),
    });
    if (!thread) throw new Error(`Composer Thread ${run.threadId} was not found.`);
    const planId = composerPlanId(resourceId, run.threadId);
    const turnResult = await this.runIntentTurn({
      submission: input.submission,
      threadId: asAgentThreadIdentity(run.threadId),
      runId,
      sessionRevision: thread.sessionRevision,
      harnessReleaseId: run.harnessReleaseId,
      // The projection carries no thread history, so the answer turn replays
      // the original intent with the supplement (V31-28) — a bare answer would
      // ask the kernel to plan a request it cannot see.
      merchantMessage: clarificationAnswerTurnMessage(
        input.submission.snapshot.intent.text,
        answer,
      ),
    });
    if (!isCompilableTurn(turnResult)) {
      await this.clarificationInterrupts?.resolve({
        resourceId,
        threadId: asAgentThreadIdentity(run.threadId),
        runId,
        occurredAt: this.now(),
      });
      try {
        assertTurnCanBeWaitedOn(turnResult);
        const interrupted = await this.requestClarificationInterrupt({
          resourceId,
          threadId: asAgentThreadIdentity(run.threadId),
          runId,
          revision: thread.sessionRevision,
          turnResult,
        });
        if (!interrupted) {
          throw new Error(
            'Composer Intent turn requires a durable clarification interrupt before it can wait.',
          );
        }
      } catch (error) {
        await this.sessions.updateRunStatus({
          resourceId,
          runId,
          status: 'failed',
          finishedAt: this.now(),
        });
        throw error;
      }
      return { threadId: asAgentThreadIdentity(run.threadId), runId, makeReady: false };
    }
    const pendingInterrupt = await this.clarificationInterrupts?.pending({
      resourceId,
      threadId: asAgentThreadIdentity(run.threadId),
      runId,
    });
    const previousQuoteRef = { ...input.submission.snapshot.quote };
    const quantity =
      turnResult.decision.action.proposal.recommendedDeliverables[0]?.quantity ?? 1;
    const reprice = await this.quoteAuthority?.reprice({
      submission: input.submission,
      merchantInstruction: answer,
      quantity,
    });
    const memoryContext = await this.retrievePlanMemoryContext({
      submission: input.submission,
      threadId: asAgentThreadIdentity(run.threadId),
      runId,
      harnessReleaseId: run.harnessReleaseId,
    });
    await this.compile({
      submission: input.submission,
      threadId: asAgentThreadIdentity(run.threadId),
      runSessionRevision: thread.sessionRevision,
      planId,
      previous: (await this.plans.getLatest(planId))?.revision ?? null,
      proposal: turnResult.decision.action.proposal,
      harnessReleaseId: run.harnessReleaseId,
      memoryContext,
      now: this.now(),
      ...(reprice ? { quoteResolutionHint: reprice.resolution } : {}),
    });
    const successorCredits = reprice?.resolution.summary?.creditCost;
    const hasSuccessorCredits =
      typeof successorCredits === 'number' &&
      Number.isSafeInteger(successorCredits) &&
      successorCredits > 0;
    if (reprice) {
      input.submission.snapshot = {
        ...input.submission.snapshot,
        quote: {
          id: reprice.resolution.quoteRef.id,
          revision: String(reprice.resolution.quoteRef.revision),
        },
      };
      if (hasSuccessorCredits) {
        input.submission.usageReservation.credits = successorCredits;
      }
    }
    // V31-28 / D-043: an exempt copy plan is confirmation-free, so the
    // answered clarification is make-ready the same way `prepare()` is for a
    // directly-compiled exempt plan. Paid (merchant_confirmed) plans keep
    // waiting for the explicit start — this branch never touches them.
    const makeReady =
      input.submission.executionPlanFreeze?.approvalBasis ===
      'policy_exempt_copy';
    if (makeReady) {
      const answeredRun = await this.sessions.getRun({ resourceId, runId });
      if (
        answeredRun &&
        (answeredRun.status === 'running' || answeredRun.status === 'waiting')
      ) {
        await this.sessions.updateRunStatus({
          resourceId,
          runId,
          status: 'completed',
          finishedAt: this.now(),
        });
      }
    }
    return {
      threadId: asAgentThreadIdentity(run.threadId),
      runId,
      makeReady,
      ...(pendingInterrupt
        ? {
            clarificationResolution: {
              ...pendingInterrupt,
              threadId: asAgentThreadIdentity(run.threadId),
              runId,
            },
          }
        : {}),
      ...(reprice && hasSuccessorCredits
        ? {
            repriceCommit: {
              expectedFreeze: null,
              previousQuoteRef,
              successorQuote: reprice.successorQuote,
              credits: successorCredits,
            },
          }
        : {}),
    };
  }

  async commitClarificationResolution(input: {
    submission: CreationSubmissionRecord;
    resolution?: ComposerClarificationResolution;
  }): Promise<void> {
    if (!this.clarificationInterrupts) return;
    const resourceId = input.submission.snapshot.workspaceId;
    const runId = composerRunId(input.submission);
    const run = await this.sessions.getRun({ resourceId, runId });
    if (!run) throw new Error(`Composer Agent Run ${runId} was not found.`);
    await this.clarificationInterrupts.resolve({
      resourceId,
      threadId: input.resolution?.threadId ?? run.threadId,
      runId: input.resolution?.runId ?? runId,
      ...(input.resolution?.interruptId ? { interruptId: input.resolution.interruptId } : {}),
      occurredAt: this.now(),
    });
  }

  async completeExplicitStart(input: {
    submission: CreationSubmissionRecord;
    planRevision: number;
  }): Promise<ComposerAgentBinding> {
    const resourceId = input.submission.snapshot.workspaceId;
    let runId = composerRunId(input.submission);
    let run = await this.sessions.getRun({ resourceId, runId });
    if (!run && input.submission.agentBinding?.runId) {
      // V31-63: a reprice successor never opens its own Composer Run — it is
      // admitted durably by the store transaction and executes in the
      // predecessor's session thread, whose binding the successor record
      // inherits. Resolve that inherited Run instead of failing the start.
      runId = input.submission.agentBinding.runId;
      run = await this.sessions.getRun({ resourceId, runId });
    }
    if (!run) throw new Error(`Composer Agent Run ${runId} was not found.`);
    const planId = composerPlanId(resourceId, run.threadId);
    const latest = await this.plans.getLatest(planId);
    if (!latest || latest.revision.revision !== input.planRevision) {
      throw new Error(
        `Explicit start requires latest plan revision ${latest?.revision.revision ?? 'missing'}.`,
      );
    }
    const freeze = input.submission.executionPlanFreeze;
    if (
      !freeze ||
      freeze.planId !== latest.revision.planId ||
      freeze.planRevision !== latest.revision.revision ||
      freeze.approvalBasis !== 'merchant_confirmed' ||
      freeze.quoteRef.id !== latest.revision.quoteRef.id ||
      String(freeze.quoteRef.revision) !== String(latest.revision.quoteRef.revision)
    ) {
      throw new Error('Explicit start requires the exact durable latest plan freeze.');
    }
    const rightsSummary = latest.revision.rightsSummary as {
      unauthorizedAssetIds?: unknown[];
    };
    const capabilitySummary = latest.revision.capabilitySummary as {
      modelAvailable?: boolean;
    };
    const readiness = projectMarketingPlanReadiness({
      revision: latest.revision,
      facts: {
        blocked: (rightsSummary.unauthorizedAssetIds?.length ?? 0) > 0,
        modelUnavailable: capabilitySummary.modelAvailable === false,
      },
      now: this.now(),
    });
    if (readiness !== 'ready') {
      throw new Error(`Explicit start denied because latest plan is ${readiness}.`);
    }
    if (
      run.status !== 'running' &&
      run.status !== 'waiting' &&
      run.status !== 'completed'
    ) {
      throw new Error(`Composer Agent Run ${runId} cannot start from ${run.status}.`);
    }
    return { threadId: asAgentThreadIdentity(run.threadId), runId, makeReady: true };
  }

  async markExplicitStartCompleted(input: {
    submission: CreationSubmissionRecord;
  }): Promise<void> {
    const resourceId = input.submission.snapshot.workspaceId;
    const runId = composerRunId(input.submission);
    const run = await this.sessions.getRun({ resourceId, runId });
    if (run?.status === 'running' || run?.status === 'waiting') {
      await this.sessions.updateRunStatus({
        resourceId,
        runId,
        status: 'completed',
        finishedAt: this.now(),
      });
    }
  }

  async revisePrepared(input: {
    submission: CreationSubmissionRecord;
    planRevision: number;
    merchantInstruction: string;
  }): Promise<ComposerAgentBinding> {
    const resourceId = input.submission.snapshot.workspaceId;
    const runId = composerRunId(input.submission);
    const run = await this.sessions.getRun({ resourceId, runId });
    if (!run || (run.status !== 'running' && run.status !== 'waiting')) {
      throw new Error('Only a waiting Composer plan can be revised.');
    }
    const planId = composerPlanId(resourceId, run.threadId);
    const latest = await this.plans.getLatest(planId);
    if (!latest || latest.revision.revision !== input.planRevision) {
      throw new Error(
        `Plan revision conflict; latest is ${latest?.revision.revision ?? 'missing'}.`,
      );
    }
    const instruction = input.merchantInstruction.trim();
    if (!instruction) throw new Error('Plan revision instruction is required.');
    const snapshot = input.submission.snapshot;
    const expectedFreeze = input.submission.executionPlanFreeze;
    if (!expectedFreeze) {
      throw new Error('Plan revision requires the current durable freeze.');
    }
    const patch = canonicalPlanPatchFromMerchantInstruction(instruction);
    const quantity =
      patch.deliverableQuantity ?? latest.revision.deliverables[0]?.quantity ?? 1;
    const reprice = await this.quoteAuthority?.reprice({
      submission: input.submission,
      merchantInstruction: instruction,
      quantity,
    });
    const quoteResolutionHint = reprice?.resolution;
    const result = await this.compiler.adjustPlan({
      workspaceId: resourceId,
      resourceId,
      threadId: asAgentThreadIdentity(run.threadId),
      planId,
      existingPlanId: planId,
      proposal: proposalFromSubmission(input.submission),
      patch,
      intentRevision: latest.revision.boundRevisions.intentRevision,
      contextBundleId: snapshot.briefContext.id,
      contextRevision: String(snapshot.briefContext.revision),
      harnessReleaseId: run.harnessReleaseId,
      quoteRefHint: snapshot.quote,
      ...(quoteResolutionHint ? { quoteResolutionHint } : {}),
      now: this.now(),
      ...(input.submission.usageReservation.credits !== undefined
        ? {
            livingPlanBilling: {
              creditCost: input.submission.usageReservation.credits,
            },
          }
        : {}),
    });
    const successorCredits = quoteResolutionHint?.summary?.creditCost;
    const hasSuccessorCredits =
      typeof successorCredits === 'number' &&
      Number.isSafeInteger(successorCredits) &&
      successorCredits > 0;
    if (quoteResolutionHint) {
      input.submission.snapshot = {
        ...input.submission.snapshot,
        quote: {
          id: quoteResolutionHint.quoteRef.id,
          revision: String(quoteResolutionHint.quoteRef.revision),
        },
      };
      if (hasSuccessorCredits) {
        input.submission.usageReservation.credits = successorCredits;
      }
    }
  assignExecutionPlanFreezes(
      input.submission,
      compileFinalizeExecutionPlanFreezes({
        result,
        contextBundleId: snapshot.briefContext.id,
        contextRevision: String(snapshot.briefContext.revision),
        approvalBasis: approvalBasisForDeliverables(result.revision.deliverables),
      }),
    );
    return {
      threadId: asAgentThreadIdentity(run.threadId),
      runId,
      makeReady: false,
      ...(reprice && hasSuccessorCredits
        ? {
            repriceCommit: {
              expectedFreeze,
              previousQuoteRef: {
                id: expectedFreeze.quoteRef.id,
                revision: String(expectedFreeze.quoteRef.revision),
              },
              successorQuote: reprice.successorQuote,
              credits: successorCredits,
            },
          }
        : {}),
    };
  }

  private runIntentTurn(input: {
    submission: CreationSubmissionRecord;
    threadId: string;
    runId: string;
    sessionRevision: number;
    harnessReleaseId: string;
    merchantMessage?: string;
  }): Promise<AgentTurnRunnerResult | null> {
    if (!this.compiler.runComposerTurn) return Promise.resolve(null);
    const { submission } = input;
    const snapshot = submission.snapshot;
    const carrier = carrierForLens(snapshot.lens);
    const paidResources = submission.usageReservation.units
      .filter((unit) => unit.resource !== 'copy')
      .map((unit) => unit.resource);
    return this.compiler.runComposerTurn({
      resourceId: snapshot.workspaceId,
      threadId: input.threadId,
      runId: input.runId,
      actorId: snapshot.actorId,
      sessionRevision: input.sessionRevision,
      harnessReleaseId: input.harnessReleaseId,
      merchantMessage: input.merchantMessage ?? snapshot.intent.text,
      creationMode: snapshot.creationMode,
      platform: snapshot.contentPackagePlatform,
      activeTaskRef: {
        taskId: submission.task.id,
        workflowId: submission.task.id,
      },
      approvedToolNames: [
        'find_store_projects',
        'read_confirmed_store_facts',
        'find_authorized_assets',
        'read_marketing_identity',
        'read_recent_content',
        'read_confirmed_experience',
        'read_platform_requirements',
        'read_model_capabilities',
      ],
      authority: {
        progressiveLevel: {
          lens: progressiveLens(snapshot.lens),
          carriers: [carrier],
          includesPaidMediaExecution: paidResources.length > 0,
          paidMediaUnitResources: paidResources,
        },
        ...projectComposerTurnAuthority(submission),
      },
    });
  }

  private async requestClarificationInterrupt(input: {
    resourceId: string;
    threadId: string;
    runId: string;
    revision: number;
    turnResult: AgentTurnRunnerResult | null;
  }): Promise<boolean> {
    const question = clarificationQuestionFromTurn(input.turnResult);
    if (!this.clarificationInterrupts || !question) return false;
    await this.clarificationInterrupts.request({
      resourceId: input.resourceId,
      threadId: input.threadId,
      runId: input.runId,
      question,
      revision: input.revision,
      occurredAt: this.now(),
    });
    return true;
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
    proposal?: PlanProposal;
    harnessReleaseId: string;
    memoryContext: PlanMemoryContext | null;
    now: string;
    quoteResolutionHint?: PlanCompilerQuoteResolution;
  }): Promise<void> {
    const snapshot = input.submission.snapshot;
    const quoteResolutionHint =
      input.quoteResolutionHint ??
      (await this.quoteAuthority?.resolveCurrent({ submission: input.submission }));
    const compileInput: CompilePlanInput = {
      workspaceId: snapshot.workspaceId,
      resourceId: snapshot.workspaceId,
      threadId: input.threadId,
      planId: input.planId,
      // V31-63 defect A: the frozen rights baseline must derive from the same
      // source the admission verify side reads — the submission snapshot's
      // `sources.assets` (verify reads `request.intent.assetReferences`, which
      // IS that list), in the same order. Kernel proposals do not carry
      // faithful asset intentions (the e2e session-kernel fixture hardcodes
      // `[]` at core-assembly.ts, and a live LLM proposal is not required to
      // echo asset ids), so trusting them freezes an empty rights baseline and
      // every asset-bearing paid run falsely trips SNAPSHOT_STALE on
      // admission. Enforced here at the single compile chokepoint so every
      // proposal source obeys the V31-55 doctrine pinned in
      // plan-compiler-production-ports.ts `resolveRights` (compile/verify
      // narrowing must match exactly).
      proposal: withSnapshotAssetIntentions(
        input.proposal ?? proposalFromSubmission(input.submission),
        input.submission,
      ),
      intentRevision: input.runSessionRevision,
      contextBundleId: snapshot.briefContext.id,
      contextRevision: String(snapshot.briefContext.revision),
      harnessReleaseId: input.harnessReleaseId,
      quoteRefHint: snapshot.quote,
      ...(quoteResolutionHint ? { quoteResolutionHint } : {}),
      // V31-38: recipe / source / catalog bind from the admitted snapshot only.
      recipeAuthorityHint: recipeAuthorityHintFromSubmission(input.submission),
      memoryContext: input.memoryContext,
      now: input.now,
      billingQuoteRef: snapshot.quote,
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
    assignExecutionPlanFreezes(
      input.submission,
      compileFinalizeExecutionPlanFreezes({
        result,
        contextBundleId: compileInput.contextBundleId,
        contextRevision: compileInput.contextRevision,
        approvalBasis: approvalBasisForDeliverables(result.revision.deliverables),
      }),
    );
  }
}

export class ExecutionPlanFreezeError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'ExecutionPlanFreezeError';
    this.code = code;
  }
}

/**
 * V31-47: one freeze per carrier. A Plan revision may span carriers (Living
 * Plan / quote / credit already do); each freeze carries only that carrier's
 * executionPlan and deliverables so Make cannot half-deliver against a full
 * quote. Callers fan out one Make per freeze.
 */
export function compileFinalizeExecutionPlanFreezes(input: {
  result: Pick<
    CompilePlanResult,
    'revision' | 'executionPlan' | 'executionPlans' | 'packageBilling'
  >;
  contextBundleId: string;
  contextRevision: string;
  approvalBasis: ExecutionPlanApprovalBasis;
}): ExecutionPlanCompileFreeze[] {
  const { result } = input;
  const revision = result.revision;
  const carrierPlans = resolveCarrierPlansForFreeze(result);
  const carriers = carrierPlans.map((plan) => plan.carrier);
  const revisionCarriers = [
    ...new Set(revision.deliverables.map((item) => item.kind)),
  ];
  if (
    carriers.length !== revisionCarriers.length ||
    revisionCarriers.some((carrier) => !carriers.includes(carrier))
  ) {
    throw new ExecutionPlanFreezeError(
      'MULTI_CARRIER_FREEZE_INCOMPLETE',
      `Plan ${revision.planId} revision ${revision.revision} spans ${revisionCarriers.join(', ')} but freeze plans only cover ${carriers.join(', ') || '(none)'}.`,
    );
  }
  return carrierPlans.map((compiled) =>
    freezeOneCarrier({
      revision,
      compiled,
      contextBundleId: input.contextBundleId,
      contextRevision: input.contextRevision,
      approvalBasis: input.approvalBasis,
      ...(result.packageBilling
        ? { packageBilling: result.packageBilling }
        : {}),
    }),
  );
}

/**
 * Single-carrier convenience. Multi-carrier callers must use
 * `compileFinalizeExecutionPlanFreezes` and fan out Makes.
 */
export function compileFinalizeExecutionPlanFreeze(input: {
  result: Pick<CompilePlanResult, 'revision' | 'executionPlan' | 'executionPlans'>;
  contextBundleId: string;
  contextRevision: string;
  approvalBasis: ExecutionPlanApprovalBasis;
}): ExecutionPlanCompileFreeze {
  const freezes = compileFinalizeExecutionPlanFreezes(input);
  if (freezes.length !== 1) {
    const carriers = freezes.map((freeze) => freeze.carrier ?? '?').join(', ');
    throw new ExecutionPlanFreezeError(
      'MULTI_CARRIER_FREEZE_REQUIRES_FANOUT',
      `Plan freeze produced ${freezes.length} carrier freezes (${carriers}); use compileFinalizeExecutionPlanFreezes and start one Make per freeze.`,
    );
  }
  return freezes[0]!;
}

function resolveCarrierPlansForFreeze(
  result: Pick<CompilePlanResult, 'revision' | 'executionPlan' | 'executionPlans'>,
): CompiledCarrierExecutionPlan[] {
  if (result.executionPlans && result.executionPlans.length > 0) {
    return result.executionPlans;
  }
  const carriers = [
    ...new Set(result.revision.deliverables.map((item) => item.kind)),
  ];
  if (carriers.length === 1) {
    return [
      {
        carrier: carriers[0]!,
        executionPlan: result.executionPlan,
        unitCacheKeys: {},
      },
    ];
  }
  return [];
}

function freezeOneCarrier(input: {
  revision: CompilePlanResult['revision'];
  compiled: CompiledCarrierExecutionPlan;
  contextBundleId: string;
  contextRevision: string;
  approvalBasis: ExecutionPlanApprovalBasis;
  packageBilling?: CompilePlanResult['packageBilling'];
}): ExecutionPlanCompileFreeze {
  const deliverables = input.revision.deliverables.filter(
    (item) => item.kind === input.compiled.carrier,
  );
  if (deliverables.length === 0) {
    throw new ExecutionPlanFreezeError(
      'CARRIER_FREEZE_EMPTY',
      `Carrier ${input.compiled.carrier} has no deliverables on plan ${input.revision.planId}@${input.revision.revision}.`,
    );
  }
  return {
    planId: input.revision.planId,
    planRevision: input.revision.revision,
    intentDeclaration: input.revision.intent,
    contextBundleRef: {
      bundleId: input.contextBundleId,
      revision: Number(input.contextRevision),
      hash: fingerprintValue({
        bundleId: input.contextBundleId,
        revision: input.contextRevision,
      }),
    },
    executionPlan: input.compiled.executionPlan,
    deliverables,
    quoteRef: input.revision.quoteRef,
    ...(input.packageBilling
      ? { packageBilling: structuredClone(input.packageBilling) }
      : {}),
    rightsRevisionRefs: input.revision.boundRevisions.rightsRevisionIds,
    harnessReleaseId: input.revision.boundRevisions.harnessReleaseId,
    approvalBasis: input.approvalBasis,
    carrier: input.compiled.carrier,
    ...(input.packageBilling
      ? {
          carrierUnitId: packageCarrierUnitId(
            input.packageBilling,
            input.compiled.carrier,
          ),
        }
      : {}),
  };
}

function packageCarrierUnitId(
  packageBilling: NonNullable<CompilePlanResult['packageBilling']>,
  carrier: PlanDeliverable['kind'],
): string {
  const allocations = packageBilling.allocations.filter(
    (allocation) => allocation.carrier === carrier,
  );
  if (allocations.length !== 1 || !allocations[0]?.carrierUnitId.trim()) {
    throw new ExecutionPlanFreezeError(
      'PACKAGE_CARRIER_UNIT_MISSING',
      `Package billing must contain exactly one carrier unit for ${carrier}.`,
    );
  }
  return allocations[0].carrierUnitId;
}

/** Bind primary + full freeze set onto a submission (V31-47). */
export function assignExecutionPlanFreezes(
  submission: CreationSubmissionRecord,
  freezes: ExecutionPlanCompileFreeze[],
): void {
  if (freezes.length === 0) {
    throw new ExecutionPlanFreezeError(
      'EMPTY_FREEZE_SET',
      'At least one carrier execution freeze is required.',
    );
  }
  submission.executionPlanFreeze = freezes[0];
  submission.executionPlanFreezes = freezes;
}

/**
 * Rebuild CompilePlanResult-shaped carrier plans from a store artifact that
 * only round-trips the primary execution plan.
 */
export function compileResultFromArtifact(
  artifact: {
    revision: CompilePlanResult['revision'];
    executionPlan: CompilePlanResult['executionPlan'];
    packageBilling?: CompilePlanResult['packageBilling'];
  },
  workspaceId: string,
): Pick<
  CompilePlanResult,
  'revision' | 'executionPlan' | 'executionPlans' | 'packageBilling'
> {
  const executionPlans = buildCompiledCarrierExecutionPlans({
    revision: artifact.revision,
    workspaceId,
    primaryExecutionPlan: artifact.executionPlan,
  });
  return {
    revision: artifact.revision,
    executionPlan: artifact.executionPlan,
    executionPlans,
    ...(artifact.packageBilling
      ? { packageBilling: structuredClone(artifact.packageBilling) }
      : {}),
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

/**
 * V31-47 package-level basis: any non-copy deliverable makes the whole
 * multi-carrier freeze set merchant_confirmed (one confirmation covers all).
 */
export function approvalBasisForDeliverables(
  deliverables: readonly { kind: string }[],
): ExecutionPlanApprovalBasis {
  return deliverables.every((item) => item.kind === 'copy')
    ? 'policy_exempt_copy'
    : 'merchant_confirmed';
}

/** Carrier this freeze executes (legacy freezes derive from deliverables). */
export function carrierOfExecutionPlanFreeze(
  freeze: ExecutionPlanCompileFreeze,
): string {
  if (freeze.carrier) return freeze.carrier;
  const kinds = [...new Set(freeze.deliverables.map((item) => item.kind))];
  if (kinds.length !== 1 || !kinds[0]) {
    throw new ExecutionPlanFreezeError(
      'FREEZE_CARRIER_AMBIGUOUS',
      `Execution freeze for plan ${freeze.planId}@${freeze.planRevision} does not name a single carrier.`,
    );
  }
  return kinds[0];
}

/**
 * A non-compilable turn may only park the run when something can still move it:
 * an `ask_merchant` decision becomes a clarification interrupt the merchant can
 * answer. A system-only block is also surfaced as an actionable clarification
 * interrupt. A null decision or a decision that finished the turn without a
 * plan and without a question is neither — leaving that `waiting` gave the run
 * no plan to start and no question to answer, so nothing could ever advance it.
 */
function assertTurnCanBeWaitedOn(result: AgentTurnRunnerResult | null): void {
  if (clarificationQuestionFromTurn(result)) return;
  const decision = result?.decision;
  if (!decision) {
    throw new Error(
      'Composer Intent turn produced no actionable decision or merchant question.',
    );
  }
  throw new Error(
    `Composer Intent turn produced neither a plan proposal nor a merchant question (action=${decision.action.kind}).`,
  );
}

function clarificationQuestionFromTurn(
  result: AgentTurnRunnerResult | null,
): { itemId: string; question: string; options?: Array<{ label: string; description?: string }> } | null {
  if (result?.systemOnlyBlock?.blocked) {
    return {
      itemId: `system-only:${result.systemOnlyBlock.gateId}`,
      question: result.systemOnlyBlock.reason,
    };
  }
  const decision = result?.decision;
  return decision?.action.kind === 'ask_merchant' ? decision.action.question : null;
}

function isCompilableTurn(
  result: AgentTurnRunnerResult | null,
): result is AgentTurnRunnerResult & {
  decision: NonNullable<AgentTurnRunnerResult['decision']> & {
    action: { kind: 'propose_plan'; proposal: PlanProposal };
  };
} {
  return (
    Boolean(result) &&
    !result!.systemOnlyBlock &&
    result!.decision?.action.kind === 'propose_plan'
  );
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

/**
 * V31-38: exact recipe / source / catalog pins from the admitted submission.
 * Production PlanCompiler fails closed when any of these authorities is empty.
 *
 * - recipe: CreationExperience recipe revision id on the snapshot
 * - catalog: route catalog revision (same pin harness admission freezes)
 * - source: asset / content-package revisions; empty source set still binds
 *   the deterministic brief source-set hash used by Brief confirmation
 */
export function recipeAuthorityHintFromSubmission(
  submission: CreationSubmissionRecord,
): PlanCompilerRecipeAuthorityHint {
  const snapshot = submission.snapshot;
  const sourceIds = [
    ...snapshot.sources.assets.map((asset) => asset.id),
    ...(snapshot.sources.contentPackage
      ? [snapshot.sources.contentPackage.id]
      : []),
  ];
  const sourceRevisionIds = [
    ...new Set(
      [
        ...snapshot.sources.assets.map((asset) => asset.revision),
        ...(snapshot.sources.contentPackage
          ? [snapshot.sources.contentPackage.revision]
          : []),
      ]
        .map((value) => value.trim())
        .filter((value) => value.length > 0),
    ),
  ];
  // Free-copy submissions often carry no assets; pin the same source-set
  // revision the brief domain uses so the plan remains reproducible.
  if (sourceRevisionIds.length === 0) {
    sourceRevisionIds.push(briefSourceRevisionId(sourceIds));
  }
  return {
    recipeRevisionIds: [snapshot.recipe.revision],
    catalogRevisionId: snapshot.route.revision,
    sourceRevisionIds,
  };
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

/**
 * V31-63 defect A: overwrite whatever asset intentions the proposal carries
 * with the submission snapshot's `sources.assets` ids, preserving the
 * snapshot's order (`proposalFromSubmission` derives them the same way, so
 * for that path this is a no-op). This keeps the compile-time rights
 * fingerprint and the admission verify-time fingerprint
 * (execution-plan-live-facts.ts reads `request.intent.assetReferences`) on
 * one source of truth.
 */
function withSnapshotAssetIntentions(
  proposal: PlanProposal,
  submission: CreationSubmissionRecord,
): PlanProposal {
  return {
    ...proposal,
    assetIntentions: submission.snapshot.sources.assets.map(
      (asset) => asset.id,
    ),
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

// Exported test-only: lets api-runtime.resolveAgentCoordinates.test.ts pin
// that interrupt projection's taskId selection produces the same runId this
// function commits the Composer's Agent Run to (see 4C).
export function composerRunId(submission: CreationSubmissionRecord): string {
  return `run:composer:${fingerprintValue({
    workspaceId: submission.snapshot.workspaceId,
    taskId: submission.task.id,
  }).slice(0, 32)}`;
}

function composerPlanId(resourceId: string, threadId: string): string {
  return `plan_${fingerprintValue({ resourceId, threadId }).slice(0, 24)}`;
}

function carrierForLens(
  lens: CreationSubmissionRecord['snapshot']['lens'],
): 'copy' | 'note' | 'media' {
  if (lens === 'copy') return 'copy';
  if (lens === 'image_text_note') return 'note';
  return 'media';
}

function progressiveLens(
  lens: CreationSubmissionRecord['snapshot']['lens'],
): 'copy' | 'note' | 'media' | 'image_text' | 'video' {
  if (lens === 'image_text_note') return 'note';
  if (lens === 'image') return 'media';
  return lens;
}
