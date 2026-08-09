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
  questionCardSchema,
  type QuestionCard,
  type StructuredDecisionInput,
} from '@meiye/contracts';

import type {
  CreateExecutionConfirmationInput,
  CreateExecutionConfirmationResult,
} from '../agent-session/execution-confirmation-service.js';
import { creditUsageOperationId } from '../credit-billing/credit-ledger.js';
import {
  merchantPaidGenerationConfirmationAccepted,
  merchantPaidGenerationConfirmationQuestion,
  merchantPaidGenerationConfirmationReason,
} from './merchant-delivery-language.js';
import type { HarnessWorkflowInput } from './task-admission.js';

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
    return true;
  }
  return units.some((unit) => PAID_MEDIA_USAGE_RESOURCES.has(unit.resource));
}

export type ConfirmPaidGenerationProgressEvent = {
  stage: 'execution_selection';
  state: 'suspended' | 'success';
  message: string;
};

export type ConfirmPaidGenerationExecutionInput = {
  workflowId: string;
  request: HarnessWorkflowInput;
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
  /**
   * V31-11 confirmation-objects wiring: after merchant approval, create the
   * domain confirmation request (balance check + FEFO reserve under the
   * workspace credit lock). Idempotent by requestId — a durable replay that
   * re-enters the approved branch reuses the existing request. The reserve
   * reuses the Coordinator submission operation id, so confirmation-time and
   * submission-time holds collapse into one ledger debit (U8=A, no double
   * charge at execution-time settlement). Optional — absent in fixture paths.
   */
  createExecutionConfirmationRequest?: (
    input: CreateExecutionConfirmationInput,
  ) => Promise<CreateExecutionConfirmationResult>;
};

/**
 * D-153: confirmation-objects hold window (1h–30d). Matches the DBOS
 * confirmation-card default hold so the domain request outlives the card.
 */
const PAID_CONFIRMATION_HOLD_DURATION_MS = 48 * 60 * 60 * 1000;

/**
 * D-164③ paid-generation execution confirmation (xhs-spec §3.2).
 *
 * Symbol-anchored export — do not rename without updating V3.1 §22.4 anchors
 * and XHS §3.2 regression suite.
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
    if (request.pendingExecutionPlanSnapshot) {
      const existingDecision = await input.getExecutionConfirmationDecision?.(
        executionConfirmationRequestId(input.workflowId),
      );
      if (existingDecision?.decision === 'confirmed') {
        return admitConfirmedExecutionPlan(input, request);
      }
    }
    const question = questionCardSchema.parse({
      questionId: `execution-confirmation:${snapshot.id}`,
      workflowId: input.workflowId,
      workflowRevision: request.workflowRevision,
      question: merchantPaidGenerationConfirmationQuestion(),
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
      await createPaidExecutionConfirmationRequest(input, request);
      return request;
    }
    request = await input.applyCurrentTaskDecision(
      input.workflowId,
      request,
      command,
    );
  }
}

/**
 * V31-11: create the confirmation-object request only once the merchant
 * approved execution. Skipped when the wiring port or plan snapshot is absent
 * (legacy paths keep the Coordinator submission-time reserve semantics).
 *
 * Idempotency contract (U8=A — confirmation-time reserve is authoritative):
 * - requestId `confirmation:<workflowId>` — same workflow re-entry reuses the
 *   pending request instead of reserving twice.
 * - reservationIdempotencyKey reuses `creditUsageOperationId(taskId)`, the
 *   same operation id the Coordinator submission already consumed, so the
 *   ledger collapses both holds into one FEFO debit; execution-time settlement
 *   (quote/usage settle) never debits again, and failure refunds release the
 *   same operation id exactly once.
 */
async function createPaidExecutionConfirmationRequest(
  input: ConfirmPaidGenerationExecutionInput,
  request: HarnessWorkflowInput,
): Promise<void> {
  const create = input.createExecutionConfirmationRequest;
  const snapshot = request.executionSnapshot;
  const plan = request.executionPlanSnapshot;
  if (!create || !snapshot || !plan) return;
  const createdAt = new Date().toISOString();
  await create({
    requestId: `confirmation:${input.workflowId}`,
    workspaceId: request.workspaceId,
    planId: plan.planId,
    planRevision: plan.planRevision,
    snapshotHash: plan.snapshotHash,
    quoteRef: snapshot.quote,
    reservationIdempotencyKey: creditUsageOperationId(snapshot.task.id),
    createdAt,
    holdExpiresAt: new Date(
      Date.parse(createdAt) + PAID_CONFIRMATION_HOLD_DURATION_MS,
    ).toISOString(),
    actorId: request.actorId,
    creditCost: request.usageReservation?.credits ?? 0,
    failureRefundsCredits: true,
  });
}
