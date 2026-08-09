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

import { executionConfirmationRequestId } from './execution-confirmation-id.js';
import { buildExecutionPlanSnapshot } from './execution-plan-admission.js';
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
  getExecutionConfirmationDecision?: (
    requestId: string,
  ) => Promise<PlanConfirmationDecision | null>;
  admitExecutionPlanSnapshot?: (input: {
    workflowId: string;
    workspaceId: string;
    snapshot: ExecutionPlanSnapshot;
  }) => Promise<ExecutionPlanSnapshot>;
};

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
    const question = questionCardSchema.parse({
      questionId: executionConfirmationRequestId(input.workflowId),
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
      return admitConfirmedExecutionPlan(input, request);
    }
    request = await input.applyCurrentTaskDecision(
      input.workflowId,
      request,
      command,
    );
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
  const requestId = executionConfirmationRequestId(input.workflowId);
  const decision = await input.getExecutionConfirmationDecision(requestId);
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
  const admitted = await input.admitExecutionPlanSnapshot({
    workflowId: input.workflowId,
    workspaceId: request.workspaceId,
    snapshot,
  });
  return {
    ...request,
    executionPlanSnapshot: admitted,
  };
}
