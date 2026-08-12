import type {
	HarnessTaskRequest,
	HarnessWorkflowInput,
} from "../harness/task-admission.js";

import type { CreationExecutionSnapshot } from "./creation-execution-snapshot.js";
import type { CreationSubmissionRecord } from "./submission-coordinator.js";

export type CreationStageTaskRequestInput = {
	taskId: string;
	sourceTaskId?: string;
	snapshot: CreationExecutionSnapshot;
	usageReservation?: CreationSubmissionRecord["usageReservation"];
	frozenDecisionReferences?: CreationSubmissionRecord["decisionReferences"];
	executionPlanFreeze?: CreationSubmissionRecord["executionPlanFreeze"];
	executionConfirmationContext?: CreationSubmissionRecord["executionConfirmationContext"];
	agentThreadId?: NonNullable<CreationSubmissionRecord["agentBinding"]>["threadId"];
	agentRunId?: NonNullable<CreationSubmissionRecord["agentBinding"]>["runId"];
	artifactLineage?: CreationSubmissionRecord["artifactLineage"];
	packageConfirmationDecisionRef?: string;
	packageConfirmationRequestId?: string;
	carrierUnitIds?: readonly string[];
};

/** Canonical pre-admission request emitted by every CreationStage dispatch. */
export function buildCreationStageTaskRequest(
	input: CreationStageTaskRequestInput,
): HarnessTaskRequest {
	return {
		taskId: input.taskId,
		...(input.sourceTaskId ? { sourceTaskId: input.sourceTaskId } : {}),
		...(input.packageConfirmationRequestId
			? { packageConfirmationRequestId: input.packageConfirmationRequestId }
			: {}),
		...toHarnessWorkflowInput(
			input.snapshot,
			input.usageReservation,
			input.frozenDecisionReferences,
			input.executionPlanFreeze,
			input.executionConfirmationContext,
			input.agentThreadId,
			input.agentRunId,
			input.artifactLineage,
			input.packageConfirmationDecisionRef,
			input.carrierUnitIds,
		),
	};
}

export function toHarnessWorkflowInput(
	snapshot: CreationExecutionSnapshot,
	usageReservation?: CreationSubmissionRecord["usageReservation"],
	frozenDecisionReferences?: CreationSubmissionRecord["decisionReferences"],
	executionPlanFreeze?: CreationSubmissionRecord["executionPlanFreeze"],
	executionConfirmationContext?: CreationSubmissionRecord["executionConfirmationContext"],
	agentThreadId?: NonNullable<CreationSubmissionRecord["agentBinding"]>["threadId"],
	agentRunId?: NonNullable<CreationSubmissionRecord["agentBinding"]>["runId"],
	artifactLineage?: CreationSubmissionRecord["artifactLineage"],
	/**
	 * V31-47: when set, admission assembles the snapshot with this decision
	 * and skips a second confirmation reserve (secondary carrier Makes).
	 */
	packageConfirmationDecisionRef?: string,
	carrierUnitIds?: readonly string[],
): HarnessWorkflowInput {
	const semanticDecision = snapshot.semanticDecision;
	const decisionReferences = canonicalDecisionReferences(
		snapshot,
		frozenDecisionReferences,
	);
	return {
		...(agentThreadId ? { agentThreadId } : {}),
		...(agentRunId ? { agentRunId } : {}),
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
		...(executionPlanFreeze ? { executionPlanFreeze } : {}),
		...(executionConfirmationContext
			? { executionConfirmationContext }
			: {}),
		...(packageConfirmationDecisionRef
			? { packageConfirmationDecisionRef }
			: {}),
		...(carrierUnitIds ? { carrierUnitIds } : {}),
	};
}

/**
 * One stable decision id appears once in every pre-admission request. Semantic
 * resumptions already persist their reference on the source request, while the
 * successor snapshot carries that same reference as its semantic decision.
 */
export function canonicalDecisionReferences(
	snapshot: CreationExecutionSnapshot,
	frozenDecisionReferences?: CreationSubmissionRecord["decisionReferences"],
): NonNullable<HarnessWorkflowInput["decisionReferences"]> {
	const references = [
		...(snapshot.semanticDecision ? [snapshot.semanticDecision.reference] : []),
		...(frozenDecisionReferences ?? []),
	];
	const seen = new Set<string>();
	return references.filter((reference) => {
		if (seen.has(reference.id)) return false;
		seen.add(reference.id);
		return true;
	});
}
