import {
	isAdmissionHttpCode,
} from "../../http-errors.js";
import {
	HarnessAdmissionError,
	type HarnessTaskRequest,
} from "../harness/task-admission.js";
import type { ExecutionPlanCompileFreeze } from "../harness/execution-plan-admission.js";
import { UserSelectedSkillIneligibleError } from "../skills/service.js";
import {
	carrierOfExecutionPlanFreeze,
} from "../agent-session/composer-plan-session.js";

import type { CreationExecutionSnapshot } from "./creation-execution-snapshot.js";
import { buildCreationStageTaskRequest } from "./creation-stage-request.js";
import {
	type CreationSubmissionHarnessStarter,
	type CreationSubmissionRecord,
	type ExpiredConfirmationSuccessorPreparation,
	type RepricedConfirmationSuccessorPreparation,
	composerCarrierAttemptId,
	composerPreparedAttemptId,
} from "./submission-coordinator.js";

/**
 * The one Composer bridge into the existing Harness admission service. The
 * immutable snapshot carries the server-bound root; Harness owns the five
 * semantic stages without reconstructing browser selections from intent text.
 */
export interface HarnessCreationAdmissionPort {
	preparePendingConfirmation(input: HarnessTaskRequest): Promise<{
		workflowId: string;
		executionConfirmationRequestId?: string;
	}>;
	dispatchPrepared(input: HarnessTaskRequest): Promise<{
		workflowId: string;
		executionConfirmationRequestId?: string;
	}>;
	prepareExpiredConfirmationSuccessorInTransaction?(input: ExpiredConfirmationSuccessorPreparation): Promise<{
		executionConfirmationRequestId: string;
	}>;
	prepareRepricedConfirmationSuccessorInTransaction?(input: RepricedConfirmationSuccessorPreparation): Promise<{
		executionConfirmationRequestId: string;
	}>;
}

export class CreationStagePort implements CreationSubmissionHarnessStarter {
	constructor(private readonly admission: HarnessCreationAdmissionPort) {}

	async start(submission: CreationSubmissionRecord) {
		if (
			submission.snapshot.lens !== "copy" &&
			!submission.executionPlanFreeze
		) {
			throw new HarnessAdmissionError(
				"FROZEN_REQUEST_MISSING",
				"Paid Composer Make requires a durable ExecutionPlanFreeze.",
			);
		}
		if (submission.executionPlanFreeze && !submission.agentBinding) {
			throw new Error(
				"Planned submission is missing its authoritative Agent Thread binding.",
			);
		}
		const freezes = carrierFreezesForSubmission(submission);
		const carrierUnitIds = carrierUnitIdsForSubmission(submission);
		if (new Set(carrierUnitIds).size !== carrierUnitIds.length) {
			throw new HarnessAdmissionError(
				"FROZEN_REQUEST_MISSING",
				"Execution plan freezes must name unique carrier units.",
			);
		}
		if (freezes.length <= 1) {
			const attemptId = composerPreparedAttemptId(submission);
			const command = buildCreationStageTaskRequest({
				taskId: attemptId,
				...(attemptId !== submission.task.id
					? { sourceTaskId: submission.task.id }
					: {}),
				snapshot: submission.snapshot,
				usageReservation: submission.usageReservation,
				frozenDecisionReferences: submission.decisionReferences,
				executionPlanFreeze: submission.executionPlanFreeze,
				executionConfirmationContext: submission.executionConfirmationContext,
				agentThreadId: submission.agentBinding?.threadId,
				agentRunId: submission.agentBinding?.runId,
				artifactLineage: submission.artifactLineage,
				carrierUnitIds,
			});
			const started = await this.admission.dispatchPrepared(command);
			if (started.workflowId !== attemptId) {
				throw new Error(
					"Harness admission must preserve the Coordinator task ID.",
				);
			}
			return {
				...(started.executionConfirmationRequestId
					? {
							executionConfirmationRequestId:
								started.executionConfirmationRequestId,
						}
					: {}),
			};
		}

		// V31-47: one Make per carrier freeze. Primary keeps the prepared
		// confirmation attempt id; secondaries use carrier-suffixed ids and the
		// package confirmation decision (no second reserve).
		let primaryConfirmationRequestId: string | undefined;
		for (const [index, freeze] of freezes.entries()) {
			const carrier = carrierOfExecutionPlanFreeze(freeze);
			const isPrimary = index === 0;
			const attemptId = composerCarrierAttemptId(submission, carrier, {
				isPrimary,
				multiCarrier: true,
			});
			const lens = lensForCarrier(carrier, submission.snapshot.lens);
			const snapshot =
				lens === submission.snapshot.lens
					? submission.snapshot
					: { ...submission.snapshot, lens };
			const packageConfirmationRequestId = !isPrimary
				? submission.confirmationDispatch?.requestId?.trim()
				: undefined;
			const packageConfirmationDecisionRef = !isPrimary
				? submission.packageConfirmationDecisionRef?.trim()
				: undefined;
			if (
				!isPrimary &&
				(!packageConfirmationRequestId || !packageConfirmationDecisionRef)
			) {
				throw new HarnessAdmissionError(
					"FROZEN_REQUEST_MISSING",
					"Secondary carrier Make requires the durable confirmed package authority.",
				);
			}
			const started = await this.admission.dispatchPrepared(
				buildCreationStageTaskRequest({
					taskId: attemptId,
					sourceTaskId: submission.task.id,
					snapshot,
					// Package credits reserve once on primary; secondaries share
					// the reservation identity without re-quoting.
					usageReservation: isPrimary
						? submission.usageReservation
						: {
								...submission.usageReservation,
								credits: undefined,
								units: unitsForCarrier(
									carrier,
									submission.usageReservation.units,
								),
							},
					frozenDecisionReferences: submission.decisionReferences,
					executionPlanFreeze: freeze,
					executionConfirmationContext: submission.executionConfirmationContext,
					agentThreadId: submission.agentBinding?.threadId,
					agentRunId: submission.agentBinding?.runId,
					artifactLineage: submission.artifactLineage,
					packageConfirmationDecisionRef,
					packageConfirmationRequestId,
					carrierUnitIds,
				}),
			);
			if (started.workflowId !== attemptId) {
				throw new Error(
					"Harness admission must preserve the Coordinator task ID.",
				);
			}
			if (isPrimary && started.executionConfirmationRequestId) {
				primaryConfirmationRequestId = started.executionConfirmationRequestId;
			}
		}
		return {
			...(primaryConfirmationRequestId
				? { executionConfirmationRequestId: primaryConfirmationRequestId }
				: {}),
		};
	}

	async preparePendingConfirmation(submission: CreationSubmissionRecord) {
		if (!submission.executionPlanFreeze) {
			throw new HarnessAdmissionError(
				"FROZEN_REQUEST_MISSING",
				"Paid Composer Make requires a durable ExecutionPlanFreeze.",
			);
		}
		// Package confirmation binds only the primary freeze/attempt. Secondary
		// carrier Makes start after the merchant confirms (V31-47).
		const attemptId = composerPreparedAttemptId(submission);
		const primaryFreeze =
			submission.executionPlanFreezes?.[0] ?? submission.executionPlanFreeze;
		const carrierUnitIds = carrierUnitIdsForSubmission(submission);
		const prepared = await this.admission.preparePendingConfirmation(
			buildCreationStageTaskRequest({
				taskId: attemptId,
				sourceTaskId: submission.task.id,
				snapshot: submission.snapshot,
				usageReservation: submission.usageReservation,
				frozenDecisionReferences: submission.decisionReferences,
				executionPlanFreeze: primaryFreeze,
				executionConfirmationContext:
					submission.executionConfirmationContext,
				agentThreadId: submission.agentBinding?.threadId,
				agentRunId: submission.agentBinding?.runId,
				artifactLineage: submission.artifactLineage,
				carrierUnitIds,
			}),
		);
		if (prepared.workflowId !== attemptId) {
			throw new Error("Harness preparation must preserve the Coordinator task ID.");
		}
		return {
			...(prepared.executionConfirmationRequestId
				? {
						executionConfirmationRequestId:
							prepared.executionConfirmationRequestId,
					}
				: {}),
		};
	}

	async prepareExpiredConfirmationSuccessor(
		input: ExpiredConfirmationSuccessorPreparation,
	) {
		if (!this.admission.prepareExpiredConfirmationSuccessorInTransaction) {
			throw new HarnessAdmissionError(
				'FROZEN_REQUEST_MISSING',
				'Expired confirmation successor admission is unavailable.',
			);
		}
		return this.admission.prepareExpiredConfirmationSuccessorInTransaction(input);
	}

	async prepareRepricedConfirmationSuccessor(
		input: RepricedConfirmationSuccessorPreparation,
	) {
		if (!this.admission.prepareRepricedConfirmationSuccessorInTransaction) {
			throw new HarnessAdmissionError(
				'FROZEN_REQUEST_MISSING',
				'Confirmed price-drift successor admission is unavailable.',
			);
		}
		return this.admission.prepareRepricedConfirmationSuccessorInTransaction(input);
	}

	async classifyStartFailure(
		_submission: CreationSubmissionRecord,
		error: unknown,
	) {
		// Ineligible merchant skill selection is a deterministic client error.
		if (error instanceof UserSelectedSkillIneligibleError) {
			return "terminal_rejection" as const;
		}
		// V31-55: fence/stale/idempotency admission codes are terminal — do not
		// release-and-retry into a second admit that can surface as
		// IDEMPOTENCY_CONFLICT and mask the original fence reason.
		if (
			error &&
			typeof error === "object" &&
			"code" in error &&
			typeof error.code === "string" &&
			isAdmissionHttpCode(error.code)
		) {
			return "terminal_rejection" as const;
		}
		if (!(error instanceof HarnessAdmissionError)) return "retry" as const;
		return error.code === "REQUEST_FINGERPRINT_CONFLICT" ||
			error.code === "EXECUTION_SNAPSHOT_MISMATCH"
			? ("terminal_rejection" as const)
			: ("retry" as const);
	}
}

export { toHarnessWorkflowInput } from "./creation-stage-request.js";

/** Freezes to execute for this submission (primary-only when legacy). */
export function carrierFreezesForSubmission(
	submission: CreationSubmissionRecord,
): ExecutionPlanCompileFreeze[] {
	if (submission.executionPlanFreezes && submission.executionPlanFreezes.length > 0) {
		return submission.executionPlanFreezes;
	}
	return submission.executionPlanFreeze ? [submission.executionPlanFreeze] : [];
}

function carrierUnitIdsForSubmission(
	submission: CreationSubmissionRecord,
): string[] {
	const carrierUnitIds = carrierFreezesForSubmission(submission)
		.map((freeze) => freeze.carrierUnitId?.trim() || carrierOfExecutionPlanFreeze(freeze))
		.sort();
	return carrierUnitIds.length > 0 ? carrierUnitIds : ["single"];
}

export function lensForCarrier(
	carrier: string,
	fallback: CreationExecutionSnapshot["lens"],
): CreationExecutionSnapshot["lens"] {
	if (carrier === "copy") return "copy";
	if (carrier === "note") return "image_text_note";
	if (carrier === "media") {
		return fallback === "video" ? "video" : "image";
	}
	return fallback;
}

function unitsForCarrier(
	carrier: string,
	units: CreationSubmissionRecord["usageReservation"]["units"],
): CreationSubmissionRecord["usageReservation"]["units"] {
	if (carrier === "copy") {
		return units.filter((unit) => unit.resource === "copy");
	}
	if (carrier === "note") {
		return units.filter(
			(unit) => unit.resource === "image" || unit.resource === "copy",
		);
	}
	return units.filter(
		(unit) => unit.resource === "image" || unit.resource === "video",
	);
}
