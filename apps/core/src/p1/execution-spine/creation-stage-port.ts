import type {
	HarnessTaskRequest,
	HarnessWorkflowInput,
} from "../harness/task-admission.js";

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
		const started = await this.admission.submit({
			taskId: submission.task.id,
			...toHarnessWorkflowInput(submission.snapshot),
		});
		if (started.workflowId !== submission.task.id) {
			throw new Error("Harness admission must preserve the Coordinator task ID.");
		}
	}
}

export function toHarnessWorkflowInput(
	snapshot: CreationExecutionSnapshot,
): HarnessWorkflowInput {
	return {
		actorId: snapshot.actorId,
		workspaceId: snapshot.workspaceId,
		packageId: snapshot.contentPackage.id,
		expectedRevision: snapshot.contentPackage.expectedRevision,
		workflowRevision: snapshot.revision,
		rawInput: snapshot.intent.text,
		intent: {
			context: {
				workId: snapshot.work.id,
				intent: snapshot.intent.text,
				sourceSummaries: [],
			},
			assetReferences: snapshot.sources.assets.map((asset) => asset.id),
		},
		executionSnapshot: snapshot,
	};
}
