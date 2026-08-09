/**
 * Composer submission → Agent Thread/Run + PlanCompiler production boundary.
 *
 * The browser may suggest a continuation Thread, but this coordinator resolves
 * it only through the workspace-scoped AgentSessionStore. Stable ids make a
 * retried submission reuse its Run instead of appending another plan revision.
 */

import type { ExecutionPlanApprovalBasis } from '@meiye/contracts';
import type { MarketingPlanRevision } from '@meiye/contracts';

import type {
  ComposerAgentBinding,
  ComposerSubmissionAgentPlanningPort,
  CreationSubmissionRecord,
} from '../execution-spine/submission-coordinator.js';
import { asAgentThreadIdentity } from '../execution-spine/submission-coordinator.js';
import { fingerprintValue } from '../job-runtime/job-contracts.js';
import type { ExecutionPlanCompileFreeze } from '../harness/execution-plan-admission.js';
import type { AgentSessionStore } from './agent-session-store.js';
import type { CompilePlanInput, CompilePlanResult } from './plan-compiler.js';
import type { MarketingPlanStore } from './plan-store.js';
import type { PlanProposal } from './turn-contracts.js';

export type ComposerPlanCompilerPort = {
  compilePlan(input: CompilePlanInput): Promise<CompilePlanResult>;
  adjustPlan(
    input: CompilePlanInput & { existingPlanId: string }
  ): Promise<CompilePlanResult>;
};

export type ComposerPlanSessionOptions = {
  now?: () => string;
  resolveHarnessReleaseId?: (
    submission: CreationSubmissionRecord
  ) => string | Promise<string>;
};

const COMPOSER_PLAN_HARNESS_RELEASE_ID = 'composer-plan-surface-v1';

export class ComposerPlanSessionCoordinator
  implements ComposerSubmissionAgentPlanningPort
{
  private readonly now: () => string;
  private readonly resolveHarnessReleaseId: (
    submission: CreationSubmissionRecord
  ) => string | Promise<string>;

  constructor(
    private readonly sessions: AgentSessionStore,
    private readonly plans: MarketingPlanStore,
    private readonly compiler: ComposerPlanCompilerPort,
    options: ComposerPlanSessionOptions = {}
  ) {
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
      try {
        await this.compile({
          submission,
          threadId,
          runSessionRevision: started.thread.sessionRevision,
          planId,
          previous: latest?.revision ?? null,
          harnessReleaseId: started.run.harnessReleaseId,
          now,
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
	} else if (exactCompiled && !submission.executionPlanFreeze) {
	  // A process may die after PlanCompiler durably appends the revision but
	  // before the submission row stores its freeze. Rebuild only from that
	  // durable compiled artifact; never compile/append a second revision.
	  submission.executionPlanFreeze = compileFinalizeExecutionPlanFreeze({
		result: exactCompiled,
		contextBundleId: submission.snapshot.briefContext.id,
		contextRevision: String(submission.snapshot.briefContext.revision),
		approvalBasis: approvalBasisForSubmission(submission.snapshot.lens),
	  });
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

    const binding = { threadId: asAgentThreadIdentity(threadId), runId };
    submission.agentBinding = binding;
    return binding;
  }

  private async compile(input: {
    submission: CreationSubmissionRecord;
    threadId: string;
    runSessionRevision: number;
    planId: string;
    previous: MarketingPlanRevision | null;
    harnessReleaseId: string;
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
