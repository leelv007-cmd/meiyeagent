/**
 * Composer submission → Agent Thread/Run + PlanCompiler production boundary.
 *
 * The browser may suggest a continuation Thread, but this coordinator resolves
 * it only through the workspace-scoped AgentSessionStore. Stable ids make a
 * retried submission reuse its Run instead of appending another plan revision.
 */

import type {
  BuildProductQuoteInput,
  ExecutionPlanApprovalBasis,
} from '@meiye/contracts';
import type { MarketingPlanRevision } from '@meiye/contracts';

import type {
  ComposerAgentBinding,
  ComposerClarificationResolution,
  ComposerSubmissionAgentPlanningPort,
  CreationSubmissionRecord,
} from '../execution-spine/submission-coordinator.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import type { ExecutionPlanCompileFreeze } from '../harness/execution-plan-admission.js';
import type { AgentSessionStore } from './agent-session-store.js';
import type {
  CompilePlanInput,
  CompilePlanResult,
  PlanCompilerQuoteResolution,
} from './plan-compiler.js';
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
  runComposerTurn?(input: {
    resourceId: string;
    threadId: string;
    runId: string;
    actorId: string;
    sessionRevision: number;
    harnessReleaseId: string;
    merchantMessage: string;
    creationMode: 'customized' | 'free';
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

export type ComposerPlanSessionOptions = {
  now?: () => string;
  /** Production must never bypass the Session intent turn. */
  requireSessionTurn?: boolean;
  requireQuoteAuthority?: boolean;
  quoteAuthority?: ComposerPlanQuoteAuthority;
  clarificationInterrupts?: ComposerClarificationInterruptPort;
  resolveHarnessReleaseId?: (
    submission: CreationSubmissionRecord
  ) => string | Promise<string>;
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

export class ComposerPlanSessionCoordinator
  implements ComposerSubmissionAgentPlanningPort
{
  private readonly now: () => string;
  private readonly resolveHarnessReleaseId: (
    submission: CreationSubmissionRecord
  ) => string | Promise<string>;
  private readonly quoteAuthority?: ComposerPlanQuoteAuthority;
  private readonly clarificationInterrupts?: ComposerClarificationInterruptPort;

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
    this.clarificationInterrupts = options.clarificationInterrupts;
    this.now = options.now ?? (() => new Date().toISOString());
    this.resolveHarnessReleaseId =
      options.resolveHarnessReleaseId ??
      (() => COMPOSER_PLAN_HARNESS_RELEASE_ID);
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
      try {
        const turnResult = await this.runIntentTurn({
          submission,
          threadId,
          runId,
          sessionRevision: started.thread.sessionRevision,
          harnessReleaseId: started.run.harnessReleaseId,
        });
        if (this.compiler.runComposerTurn && !isCompilableTurn(turnResult)) {
          assertTurnCanBeWaitedOn(turnResult);
          await this.requestClarificationInterrupt({
            resourceId,
            threadId,
            runId,
            revision: started.thread.sessionRevision,
            turnResult,
          });
          await this.sessions.updateRunStatus({
            resourceId,
            runId,
            status: 'waiting',
          });
          return { threadId, runId, makeReady: false };
        }
        await this.compile({
          submission,
          threadId,
          runSessionRevision: started.thread.sessionRevision,
          planId,
          previous: latest?.revision ?? null,
          harnessReleaseId: started.run.harnessReleaseId,
          now,
          proposal: isCompilableTurn(turnResult)
            ? turnResult.decision.action.proposal
            : proposalFromSubmission(submission),
        });
      } catch (error) {
        if (
          started.run.status === 'running' ||
          started.run.status === 'waiting'
        ) {
          await this.sessions.updateRunStatus({
            resourceId,
            runId,
            status: 'failed',
            finishedAt: this.now(),
          });
        }
        throw error;
      }
    }

    if (!submission.executionPlanFreeze) {
      const compiled = await this.plans.getLatest(planId);
      if (!compiled) {
        throw new Error(`Composer plan ${planId} was not found after compile.`);
      }
      submission.executionPlanFreeze = compileFinalizeExecutionPlanFreeze({
        result: compiled,
        contextBundleId: submission.snapshot.briefContext.id,
        contextRevision: String(submission.snapshot.briefContext.revision),
        approvalBasis: approvalBasisForSubmission(submission.snapshot.lens),
      });
    }

    const currentRun = await this.sessions.getRun({ resourceId, runId });
    const makeReady =
      !this.compiler.runComposerTurn ||
      approvalBasisForSubmission(submission.snapshot.lens) ===
        'policy_exempt_copy';
    if (makeReady && currentRun &&
      (currentRun.status === 'running' || currentRun.status === 'waiting')) {
      await this.sessions.updateRunStatus({
        resourceId,
        runId,
        status: 'completed',
        finishedAt: this.now(),
      });
    }

    return { threadId, runId, makeReady };
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
      threadId: run.threadId,
    });
    if (!thread) throw new Error(`Composer Thread ${run.threadId} was not found.`);
    const planId = composerPlanId(resourceId, run.threadId);
    const turnResult = await this.runIntentTurn({
      submission: input.submission,
      threadId: run.threadId,
      runId,
      sessionRevision: thread.sessionRevision,
      harnessReleaseId: run.harnessReleaseId,
      merchantMessage: answer,
    });
    if (!isCompilableTurn(turnResult)) {
      await this.clarificationInterrupts?.resolve({
        resourceId,
        threadId: run.threadId,
        runId,
        occurredAt: this.now(),
      });
      await this.requestClarificationInterrupt({
        resourceId,
        threadId: run.threadId,
        runId,
        revision: thread.sessionRevision,
        turnResult,
      });
      return { threadId: run.threadId, runId, makeReady: false };
    }
    const pendingInterrupt = await this.clarificationInterrupts?.pending({
      resourceId,
      threadId: run.threadId,
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
    await this.compile({
      submission: input.submission,
      threadId: run.threadId,
      runSessionRevision: thread.sessionRevision,
      planId,
      previous: (await this.plans.getLatest(planId))?.revision ?? null,
      proposal: turnResult.decision.action.proposal,
      harnessReleaseId: run.harnessReleaseId,
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
    return {
      threadId: run.threadId,
      runId,
      makeReady: false,
      ...(pendingInterrupt
        ? {
            clarificationResolution: {
              ...pendingInterrupt,
              threadId: run.threadId,
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
    const runId = composerRunId(input.submission);
    const run = await this.sessions.getRun({ resourceId, runId });
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
    return { threadId: run.threadId, runId, makeReady: true };
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
      threadId: run.threadId,
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
    input.submission.executionPlanFreeze = compileFinalizeExecutionPlanFreeze({
      result,
      contextBundleId: snapshot.briefContext.id,
      contextRevision: String(snapshot.briefContext.revision),
      approvalBasis: approvalBasisForSubmission(snapshot.lens),
    });
    return {
      threadId: run.threadId,
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
  }) {
    if (!this.clarificationInterrupts) return;
    const decision = input.turnResult?.decision;
    if (!decision || decision.action.kind !== 'ask_merchant') return;
    await this.clarificationInterrupts.request({
      resourceId: input.resourceId,
      threadId: input.threadId,
      runId: input.runId,
      question: decision.action.question,
      revision: input.revision,
      occurredAt: this.now(),
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
      proposal: input.proposal ?? proposalFromSubmission(input.submission),
      intentRevision: input.runSessionRevision,
      contextBundleId: snapshot.briefContext.id,
      contextRevision: String(snapshot.briefContext.revision),
      harnessReleaseId: input.harnessReleaseId,
      quoteRefHint: snapshot.quote,
      ...(quoteResolutionHint ? { quoteResolutionHint } : {}),
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

/**
 * A non-compilable turn may only park the run when something can still move it:
 * an `ask_merchant` decision becomes a clarification interrupt the merchant can
 * answer, and a null decision / systemOnlyBlock is the deliberate
 * nothing-was-produced contract. A decision that finished the turn without a
 * plan and without a question is neither — leaving that `waiting` gave the run
 * no plan to start and no question to answer, so nothing could ever advance it.
 */
function assertTurnCanBeWaitedOn(result: AgentTurnRunnerResult | null): void {
  const decision = result?.decision;
  if (!decision || result?.systemOnlyBlock) return;
  if (decision.action.kind === 'ask_merchant') return;
  throw new Error(
    `Composer Intent turn produced neither a plan proposal nor a merchant question (action=${decision.action.kind}).`,
  );
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
