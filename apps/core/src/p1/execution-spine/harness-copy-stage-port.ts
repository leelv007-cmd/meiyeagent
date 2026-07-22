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
 * The only bridge from a new Composer Copy submission into the existing Harness
 * admission service. It carries the frozen root through the stages rather than
 * rebuilding semantic selections from the free-text intent.
 */
export interface HarnessCopyAdmissionPort {
	submit(input: HarnessTaskRequest): Promise<{ workflowId: string }>;
}

export class HarnessCopyStagePort implements CreationSubmissionHarnessStarter {
	constructor(private readonly admission: HarnessCopyAdmissionPort) {}

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
				sourceSummaries: sourceSummaries(snapshot),
			},
			assetReferences: snapshot.sources.assets.map((asset) => asset.id),
		},
		executionSnapshot: snapshot,
	};
}

function sourceSummaries(snapshot: CreationExecutionSnapshot) {
	return snapshot.sources.contentPackage
		? [
				`ContentPackage ${snapshot.sources.contentPackage.id} revision ${snapshot.sources.contentPackage.revision}`,
			]
		: [];
}
