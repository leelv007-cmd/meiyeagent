import assert from "node:assert/strict";
import test from "node:test";

import { createCreationExecutionSnapshot } from "./creation-execution-snapshot.js";
import { HarnessCopyStagePort } from "./harness-copy-stage-port.js";

test("the Coordinator starts the existing Harness from one frozen Copy snapshot", async () => {
	const calls: unknown[] = [];
	const stage = new HarnessCopyStagePort({
		async submit(input) {
			calls.push(structuredClone(input));
			return { workflowId: input.taskId };
		},
	});
	const snapshot = createCreationExecutionSnapshot(
		command(),
		"2026-07-22T09:00:00.000Z",
	);

	await stage.start({
		snapshot,
		work: { id: "work-1" },
		task: { id: "task-1" },
		contentPackage: { id: "package-1", expectedRevision: 0 },
		usageReservation: { id: "usage-reservation-task-1" },
	});

	assert.deepEqual(calls, [
		{
			taskId: "task-1",
			actorId: "owner-1",
			workspaceId: "workspace-1",
			packageId: "package-1",
			expectedRevision: 0,
			workflowRevision: 1,
			rawInput: "为夏日护理项目写一条预约文案",
			intent: {
				context: {
					workId: "work-1",
					intent: "为夏日护理项目写一条预约文案",
					sourceSummaries: [
						"ContentPackage content-source-1 revision content-r3",
					],
				},
				assetReferences: ["asset-1"],
			},
			executionSnapshot: snapshot,
		},
	]);
});

function command() {
	return {
		actorId: "owner-1",
		workspaceId: "workspace-1",
		idempotencyKey: "key-1",
		taskId: "task-1",
		workId: "work-1",
		contentPackageId: "package-1",
		expectedContentPackageRevision: 0,
		intent: "为夏日护理项目写一条预约文案",
		surface: { id: "surface-1", revision: "surface-r1" },
		recipe: { id: "recipe-1", revision: "recipe-r1" },
		lens: "copy" as const,
		platform: { id: "douyin" as const },
		deliverables: [
			{
				id: "deliverable-1",
				kind: "copy" as const,
				quantity: 1,
				order: 1,
			},
		],
		sources: {
			assets: [
				{ id: "asset-1", revision: "asset-r1", role: "reference" as const },
			],
			contentPackage: { id: "content-source-1", revision: "content-r3" },
		},
		rights: { revision: "rights-r1", summary: "authorized" },
		identity: { id: "identity-1", revision: "identity-r1" },
		modelPolicy: {
			id: "policy-1",
			revision: "policy-r1",
			mode: "fixed" as const,
		},
		catalogModel: { id: "model-1", revision: "model-r1" },
		quote: { id: "quote-1", revision: "quote-r1" },
		route: { id: "route-1", revision: "route-r1" },
		briefConfirmation: { id: "brief-1", revision: "brief-r1" },
		contentModules: ["social_cover" as const],
	};
}
