/**
 * Paid-generation execution confirmation gate (symbol anchor).
 *
 * Migrated out of workflow-core for V31-14 / V3.1 §22.4 so runner convergence
 * (V3.1-I) does not lose the XHS §3.2 confirmation anchor.
 *
 * Authority: D-164③ / xhs-spec §3.2 / D-043 pure-copy exemption.
 * Trigger = operation would execute paid media (units), not harness path.
 *
 * Grep anchors: confirmPaidGenerationExecution, triggersPaidMediaExecution.
 */

import {
  type ExecutionPlanSnapshot,
  type PlanConfirmationDecision,
  questionCardSchema,
  type QuestionCard,
  type StructuredDecisionInput,
} from '@meiye/contracts';

import type { CreateExecutionConfirmationAuthorityInput } from '../agent-session/execution-confirmation-authority.js';
import type {
  ConfirmationAuthorityStore,
} from '../agent-session/execution-confirmation-authority-store.js';
import type { CreateExecutionConfirmationResult } from '../agent-session/execution-confirmation-service.js';
import type {
  RefreshPlanLiveBindingsInput,
  RefreshPlanLiveBindingsResult,
} from '../agent-session/plan-compiler.js';
import type { RepricedPaidExecutionSuccessorRequest } from '../execution-spine/submission-coordinator.js';
import { executionConfirmationRequestId } from './execution-confirmation-id.js';
import { HarnessExecutionFenceSafeStopError } from './context-fence.js';
import {
  buildExecutionPlanSnapshot,
  evaluateExecutionPlanStaleness,
  type SnapshotLiveFacts,
} from './execution-plan-admission.js';
import {
  merchantPaidGenerationConfirmationAccepted,
  merchantPaidGenerationConfirmationQuestion,
  merchantPaidGenerationConfirmationReason,
} from './merchant-delivery-language.js';
import {
  executionPlanAdmissionWorkflowId,
  type HarnessWorkflowInput,
} from './task-admission.js';

export type PaidGenerationNoteOutline = {
  pageCount: number;
  pages: Array<{ order: number; title: string }>;
};

type SnapshotBackedHarnessWorkflowInput = HarnessWorkflowInput & {
  executionSnapshot: NonNullable<HarnessWorkflowInput['executionSnapshot']>;
};

type ReservedUsageResource = NonNullable<
  HarnessWorkflowInput['usageReservation']
>['units'][number]['resource'];

/**
 * Usage resources that count as paid media execution (not pure copy).
 * Typed against the reservation union on purpose: this set guards spend, and an
 * untyped `Set<string>` would let a rename of the resource union pass silently.
 */
const PAID_MEDIA_USAGE_RESOURCES = new Set<ReservedUsageResource>([
  'image',
  'video',
]);

/**
 * xhs-vertical-integration-spec §3.2 / D-164③:
 * Whether this request would trigger paid media execution and therefore needs
 * a pre-run confirmation hold. Pure copy remains free of confirmation (D-043).
 *
 * Judgment is operation-based — what the reserved units say this run will
 * spend — not "which Harness path am I on".
 *
 * Note path (image_text_note) calls the same gate after plan.ready — style
 * selected and brief fenced — so batch page generation cannot spend before
 * merchant confirm (P1-05 / xhs-spec §8.2 P1-6).
 */
export function triggersPaidMediaExecution(
  request: HarnessWorkflowInput,
): request is SnapshotBackedHarnessWorkflowInput {
  if (request.executionPlanSnapshot?.approvalBasis === 'merchant_confirmed') {
    return false;
  }
  const reservation = request.usageReservation;
  if (!request.executionSnapshot?.quote || !reservation) {
    return false;
  }
  const units = reservation.units;
  if (!Array.isArray(units)) {
    // Fail closed: a reserved run with no unit breakdown cannot be shown to be
    // copy-only, and this gate stands in front of spend. The Coordinator always
    // persists an array for production submissions.
    return true;
  }
  if (units.length === 0) {
    // Credit-priced submissions intentionally carry no legacy product units.
    // Their frozen lens is server-owned: copy keeps the D-043 exemption, while
    // media and note lenses still require confirmation before provider spend.
    if (reservation.credits !== undefined) {
      return request.executionSnapshot.lens !== 'copy';
    }
    // A legacy reservation with no credit marker cannot establish the
    // copy-only exemption. It may still represent billable product usage, so
    // keep it behind the confirmation gate rather than infer a free path.
    return true;
  }
  return units.some((unit) => PAID_MEDIA_USAGE_RESOURCES.has(unit.resource));
}

export type ConfirmPaidGenerationProgressEvent = {
  stage: 'execution_selection';
  state: 'suspended' | 'success';
  message: string;
};

/**
 * The current DBOS workflow owns an immutable task admission and its exact
 * confirmation reservation. A changed post-confirm plan cannot be converted
 * into a second pending request in this workflow: doing so would leave the
 * replacement authority, credit hold, BillingIdentity, and task_request
 * outside one atomic admission transaction.
 *
 * The caller must create a new immutable admission attempt before asking for
 * confirmation again. This is deliberately terminal for the current run.
 */
export class PaidExecutionRequiresSuccessorAdmissionError extends Error {
  readonly code = 'REQUIRES_SUCCESSOR_ADMISSION';
  readonly status = 409;

  constructor(
    readonly details: {
      workflowId: string;
      confirmationRequestId: string;
      diffFields: string[];
      /**
       * The current runtime has no transaction-aware reprice successor writer.
       * This keeps the 409 diagnosable without inventing a replacement request
       * inside the old workflow.
       */
      repricedSuccessorAuthority: 'unavailable';
    },
  ) {
    super('当前确认所依据的方案已变化，请基于最新方案重新发起确认。');
    this.name = 'PaidExecutionRequiresSuccessorAdmissionError';
  }
}

/**
 * The current DBOS attempt must terminate after atomically admitting its
 * replacement. Callers receive the new durable confirmation id, never a
 * mutated request/reservation under the old workflow.
 */
export class PaidExecutionRepricedSuccessorCreatedError extends Error {
  readonly code = 'REPRICED_SUCCESSOR_CREATED';
  readonly status = 409;

  constructor(
    readonly details: {
      workflowId: string;
      predecessorRequestId: string;
      successorTaskId: string;
      successorConfirmationRequestId: string;
    },
  ) {
    super('报价已更新，新的确认卡已准备完成，请确认最新方案。');
    this.name = 'PaidExecutionRepricedSuccessorCreatedError';
  }
}

export type ConfirmPaidGenerationExecutionInput = {
  workflowId: string;
  request: HarnessWorkflowInput;
  onActiveRequest?: (request: HarnessWorkflowInput) => void;
  reportProgress: (
    event: ConfirmPaidGenerationProgressEvent,
  ) => Promise<void>;
  noteOutline?: PaidGenerationNoteOutline;
  /**
   * Injected so this module stays free of workflow-core private helpers while
   * keeping the `confirmPaidGenerationExecution` symbol as the gate anchor.
   */
  awaitResolvedDecision: (
    question: QuestionCard,
    stage: 'execution_selection',
  ) => Promise<StructuredDecisionInput>;
  applyCurrentTaskDecision: (
    workflowId: string,
    request: HarnessWorkflowInput,
    command: StructuredDecisionInput,
  ) => Promise<HarnessWorkflowInput>;
  getExecutionConfirmationDecision?: (
    workspaceId: string,
    requestId: string,
  ) => Promise<PlanConfirmationDecision | null>;
  admitExecutionPlanSnapshot?: (input: {
    workflowId: string;
    workspaceId: string;
    snapshot: ExecutionPlanSnapshot;
    live?: SnapshotLiveFacts;
  }) => Promise<ExecutionPlanSnapshot>;
  resolveExecutionPlanLiveFacts?: (input: {
    workflowId: string;
    request: HarnessWorkflowInput;
    snapshot: ExecutionPlanSnapshot;
  }) => Promise<SnapshotLiveFacts | undefined>;
  /**
   * Kept as a compatibility seam for stage assemblies. The confirmation gate
   * intentionally does not use these to create a successor on its own.
   */
  refreshExecutionPlanLiveBindings?: (
    input: RefreshPlanLiveBindingsInput,
  ) => Promise<RefreshPlanLiveBindingsResult>;
  createExecutionConfirmationRequest?: (
    input: CreateExecutionConfirmationAuthorityInput,
  ) => Promise<CreateExecutionConfirmationResult>;
  putExecutionConfirmationAuthority?: ConfirmationAuthorityStore['putCurrent'];
	/** Durable immutable successor writer supplied by the composition root. */
	createRepricedPaidExecutionSuccessor?: (
		input: RepricedPaidExecutionSuccessorRequest,
	) => Promise<{
		kind: 'created' | 'existing';
		submission: {
			task: { id: string };
			confirmationDispatch?: { requestId?: string };
		};
	}>;
};

/**
 * D-164③ paid-generation execution confirmation (xhs-spec §3.2).
 *
 * Symbol-anchored export — do not rename without updating V3.1 §22.4 anchors
 * and XHS §3.2 regression suite.
 *
 * Living Plan / explicit Composer start records the immutable domain decision
 * *before* dispatching Make (`decide` then `tasks/:id/start`). When that
 * decision is already `confirmed`, this gate must admit the pending freeze and
 * proceed — not re-suspend on a second merchant click that will never come.
 * (V31-56 delivery projection: start 202 + makeReady true with no delivery
 * card was the prepare→decide→start path stuck here forever.)
 */
export async function confirmPaidGenerationExecution(
  input: ConfirmPaidGenerationExecutionInput,
): Promise<HarnessWorkflowInput> {
  let request = input.request;
  for (;;) {
    if (!triggersPaidMediaExecution(request)) {
      return request;
    }
    const snapshot = request.executionSnapshot;
    if (!snapshot) {
      return request;
    }
    const requestId =
      request.executionConfirmationRequestId ??
      executionConfirmationRequestId(input.workflowId);

    // Pre-confirmed path: Living Plan commit strip (or any surface) already
    // wrote PlanConfirmationDecision before startHarness. Skip the interaction
    // wait and attach the decision to the pending freeze immediately.
    if (
      request.pendingExecutionPlanSnapshot &&
      input.getExecutionConfirmationDecision
    ) {
      const existing = await input.getExecutionConfirmationDecision(
        request.workspaceId,
        requestId,
      );
      if (existing?.decision === 'confirmed') {
        await input.reportProgress({
          stage: 'execution_selection',
          state: 'success',
          message: merchantPaidGenerationConfirmationAccepted(),
        });
        const confirmed = await admitConfirmedExecutionPlan(input, request);
        if (confirmed.executionPlanSnapshot) return confirmed;
        request = confirmed;
        input.onActiveRequest?.(request);
        continue;
      }
    }

    const diffFields = request.executionConfirmationDiffFields ?? [];
    const question = questionCardSchema.parse({
      questionId: requestId,
      workflowId: input.workflowId,
      workflowRevision: request.workflowRevision,
      question:
        diffFields.length > 0
          ? `${merchantPaidGenerationConfirmationQuestion()}（方案已变化：${diffFields.join(', ')}，请重新确认）`
          : merchantPaidGenerationConfirmationQuestion(),
      options: [
        { id: 'approved', label: '确认执行' },
        { id: 'rejected', label: '暂不执行' },
      ],
      freeText: { enabled: false },
      response: {
        field: 'execution_confirmation',
        reason: merchantPaidGenerationConfirmationReason(),
      },
      unattended: 'hold',
      executionConfirmationAuthority: {
        kind: 'external_action',
        revision: 'execution-external-action/v1',
        ...(request.executionConfirmationReservedCredits
          ? {
              reservedCredits:
                request.executionConfirmationReservedCredits,
            }
          : {}),
        ...(input.noteOutline ? { outline: input.noteOutline } : {}),
      },
      scope: 'current_task',
    });
    await input.reportProgress({
      stage: 'execution_selection',
      state: 'suspended',
      message: question.question,
    });
    const command = await input.awaitResolvedDecision(
      question,
      'execution_selection',
    );
    if (
      command.decision.state === 'accepted' &&
      command.decision.value === 'approved'
    ) {
      await input.reportProgress({
        stage: 'execution_selection',
        state: 'success',
        message: merchantPaidGenerationConfirmationAccepted(),
      });
      if (!request.pendingExecutionPlanSnapshot) return request;
      const confirmed = await admitConfirmedExecutionPlan(input, request);
      if (confirmed.executionPlanSnapshot) return confirmed;
      request = confirmed;
      input.onActiveRequest?.(request);
      continue;
    }
    request = await input.applyCurrentTaskDecision(
      input.workflowId,
      request,
      command,
    );
    input.onActiveRequest?.(request);
  }
}

async function admitConfirmedExecutionPlan(
  input: ConfirmPaidGenerationExecutionInput,
  request: HarnessWorkflowInput,
): Promise<HarnessWorkflowInput> {
  const pending = request.pendingExecutionPlanSnapshot;
  if (!pending) return request;
  if (
    !input.getExecutionConfirmationDecision ||
    !input.admitExecutionPlanSnapshot
  ) {
    throw new Error(
      'Paid execution cannot start without confirmation decision and snapshot admission ports.',
    );
  }
  const requestId =
    request.executionConfirmationRequestId ??
    executionConfirmationRequestId(input.workflowId);
  const decision = await input.getExecutionConfirmationDecision(
    request.workspaceId,
    requestId,
  );
  if (!decision || decision.decision !== 'confirmed') {
    throw new Error(
      `Paid execution confirmation ${requestId} has no immutable confirmed decision.`,
    );
  }
  const snapshot = buildExecutionPlanSnapshot({
    content: pending.content,
    snapshotHash: pending.snapshotHash,
    confirmationDecisionRef: decision.decisionId,
  });
  const live = await input.resolveExecutionPlanLiveFacts?.({
    workflowId: input.workflowId,
    request,
    snapshot,
  });
  if (live) {
    if (live.quoteMissing === true) {
      throw new Error('Paid execution quote is missing after confirmation.');
    }
    const staleness = evaluateExecutionPlanStaleness({ snapshot, live });
    if (staleness.status === 'stale') {
      if (live.rightsRevoked === true) {
        // Same safe-stop contract as mid-execution fence (§23.4): refund
        // reservation, no additional charge, merchant-visible 授权已撤销 copy.
        throw new HarnessExecutionFenceSafeStopError(
          '素材授权已撤销，已安全停止且不会重复扣费。',
        );
      }
		const diffFields = Object.keys(staleness.diff);
		const observedQuoteRevision =
			live.quoteRevision ?? snapshot.quoteRef.revision;
		if (
			request.executionSnapshot &&
			input.createRepricedPaidExecutionSuccessor &&
			staleness.diff.authorityRevisionRefs === undefined
		) {
			const successor = await input.createRepricedPaidExecutionSuccessor({
				workspaceId: request.workspaceId,
				predecessor: {
					workflowId: input.workflowId,
					submissionId: request.executionSnapshot.id,
					taskId: request.executionSnapshot.task.id,
					confirmationRequestId: requestId,
				},
				staleFence: {
					expectedSnapshotHash: pending.snapshotHash,
					expectedQuoteRef: {
						id: snapshot.quoteRef.id,
						revision: String(snapshot.quoteRef.revision),
					},
					observedQuoteRevision: String(observedQuoteRevision),
					observedRightsRevisionRefs: [
						...(live.rightsRevisionRefs ?? snapshot.rightsRevisionRefs),
					],
					observedFactRevisionRefs: [
						...(live.factRevisionRefs ?? snapshot.factRevisionRefs),
					],
					diffFields,
				},
			});
			const successorRequestId = successor.submission.confirmationDispatch?.requestId;
			if (!successorRequestId) {
				throw new Error('Price-drift successor did not persist a confirmation request.');
			}
			throw new PaidExecutionRepricedSuccessorCreatedError({
				workflowId: input.workflowId,
				predecessorRequestId: requestId,
				successorTaskId: successor.submission.task.id,
				successorConfirmationRequestId: successorRequestId,
			});
		}
      throw new PaidExecutionRequiresSuccessorAdmissionError({
        workflowId: input.workflowId,
        confirmationRequestId: requestId,
        diffFields: Object.keys(staleness.diff),
        repricedSuccessorAuthority: 'unavailable',
      });
    }
  }
  const admitted = await input.admitExecutionPlanSnapshot({
    workflowId: executionPlanAdmissionWorkflowId(input.workflowId, {
      executionPlanSnapshot: snapshot,
    }),
    workspaceId: request.workspaceId,
    snapshot,
    ...(live ? { live } : {}),
  });
  return {
    ...request,
    executionPlanSnapshot: admitted,
  };
}
