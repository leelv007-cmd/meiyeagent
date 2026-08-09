import {
	HarnessAdmissionError,
	type HarnessTaskRequest,
	type HarnessWorkflowInput,
} from "../harness/task-admission.js";
import { UserSelectedSkillIneligibleError } from "../skills/service.js";

import type { CreationExecutionSnapshot } from "./creation-execution-snapshot.js";
import type {
	CreationSubmissionHarnessStarter,
	CreationSubmissionRecord,
} from "./submission-coordinator.js";

/**
 * The one Composer bridge into the existing Harness admission service. The
 * immutable snapshot carries the server-bound root; Harness owns the five
 * semantic stages without reconstructing browser selections from intent text.
 */
export interface HarnessCreationAdmissionPort {
	submit(input: HarnessTaskRequest): Promise<{ workflowId: string }>;
}

export class CreationStagePort implements CreationSubmissionHarnessStarter {
	constructor(private readonly admission: HarnessCreationAdmissionPort) {}

	async start(submission: CreationSubmissionRecord) {
		if (submission.executionPlanFreeze && !submission.agentBinding) {
			throw new Error(
				"Planned submission is missing its authoritative Agent Thread binding.",
			);
		}
		const started = await this.admission.submit({
			taskId: submission.task.id,
			...toHarnessWorkflowInput(
				submission.snapshot,
				submission.usageReservation,
				submission.decisionReferences,
				submission.executionPlanFreeze,
				submission.agentBinding?.threadId,
				submission.artifactLineage,
			),
		});
		if (started.workflowId !== submission.task.id) {
			throw new Error("Harness admission must preserve the Coordinator task ID.");
		}
	}

	async classifyStartFailure(
		_submission: CreationSubmissionRecord,
		error: unknown,
	) {
		// Ineligible merchant skill selection is a deterministic client error.
		if (error instanceof UserSelectedSkillIneligibleError) {
			return "terminal_rejection" as const;
		}
		if (!(error instanceof HarnessAdmissionError)) return "retry" as const;
		return error.code === "REQUEST_FINGERPRINT_CONFLICT" ||
			error.code === "EXECUTION_SNAPSHOT_MISMATCH"
			? ("terminal_rejection" as const)
			: ("retry" as const);
	}
}

export function toHarnessWorkflowInput(
	snapshot: CreationExecutionSnapshot,
	usageReservation?: CreationSubmissionRecord["usageReservation"],
	frozenDecisionReferences?: CreationSubmissionRecord["decisionReferences"],
	executionPlanFreeze?: CreationSubmissionRecord["executionPlanFreeze"],
	agentThreadId?: NonNullable<CreationSubmissionRecord["agentBinding"]>["threadId"],
	artifactLineage?: CreationSubmissionRecord["artifactLineage"],
): HarnessWorkflowInput {
	const semanticDecision = snapshot.semanticDecision;
	const decisionReferences = [
		...(semanticDecision ? [semanticDecision.reference] : []),
		...(frozenDecisionReferences ?? []),
	];
	return {
		...(agentThreadId ? { agentThreadId } : {}),
		...(artifactLineage ? { artifactLineage } : {}),
		actorId: snapshot.actorId,
		workspaceId: snapshot.workspaceId,
		packageId: snapshot.contentPackage.id,
		expectedRevision: snapshot.contentPackage.expectedRevision,
		workflowRevision: snapshot.revision,
		creationMode: snapshot.creationMode,
		rawInput: snapshot.intent.text,
		intent: {
			context: {
				workId: snapshot.work.id,
				intent: snapshot.intent.text,
				sourceSummaries: semanticDecision
					? [
							`Merchant decision (${semanticDecision.reference.field}): ${semanticDecision.reference.value}`,
						]
					: [],
				...(semanticDecision
					? {
							[semanticDecision.reference.field]:
								semanticDecision.reference.value,
						}
					: {}),
			},
			assetReferences: snapshot.sources.assets.map((asset) => asset.id),
		},
		userSelectedSkillRefs: snapshot.userSelectedSkillRefs,
		executionSnapshot: snapshot,
		...(decisionReferences.length > 0 ? { decisionReferences } : {}),
		...(usageReservation ? { usageReservation } : {}),
		...(executionPlanFreeze
			? { executionPlanFreeze }
			: {}),
	};
}
