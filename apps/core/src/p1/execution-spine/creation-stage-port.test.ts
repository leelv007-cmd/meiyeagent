import assert from "node:assert/strict";
import test from "node:test";

import { createCreationExecutionSnapshot } from "./creation-execution-snapshot.js";
import { CreationStagePort } from "./creation-stage-port.js";

test("the Coordinator starts the existing Harness from one frozen Composer snapshot", async () => {
	const calls: unknown[] = [];
	const stage = new CreationStagePort({
		async submit(input) {
			calls.push(structuredClone(input));
			return { workflowId: input.taskId };
		},
	});
	const snapshot = createCreationExecutionSnapshot(
		command(),
		"2026-07-22T09:00:00.000Z",
	);
	assert.deepEqual(snapshot.identityDecision, {
		id: "default-decision-1",
		revision: 7,
	});

	await stage.start({
		snapshot,
		work: { id: "work-1" },
		task: { id: "task-1" },
		contentPackage: { id: "package-1", expectedRevision: 0 },
		usageReservation: {
			id: "usage-reservation-task-1",
			units: [{ resource: "copy", quantity: 1 }],
		},
	});

	assert.deepEqual(calls, [
		{
			taskId: "task-1",
			actorId: "owner-1",
			workspaceId: "workspace-1",
			packageId: "package-1",
			expectedRevision: 0,
			workflowRevision: 1,
			creationMode: "customized",
			rawInput: "为夏日护理项目写一条预约文案",
			intent: {
				context: {
					workId: "work-1",
					intent: "为夏日护理项目写一条预约文案",
					sourceSummaries: [],
				},
				assetReferences: ["asset-1"],
			},
			executionSnapshot: snapshot,
			usageReservation: {
				id: "usage-reservation-task-1",
				units: [{ resource: "copy", quantity: 1 }],
			},
		},
	]);
});

test("a terminal successor carries the late answer into Harness context and decision references", async () => {
	const calls: Array<Record<string, unknown>> = [];
	const stage = new CreationStagePort({
		async submit(input) {
			calls.push(structuredClone(input) as unknown as Record<string, unknown>);
			return { workflowId: input.taskId };
		},
	});
	const source = createCreationExecutionSnapshot(
		command(),
		"2026-07-22T09:00:00.000Z",
	);
	const snapshot = {
		...source,
		id: "snapshot-task-successor",
		task: { id: "task-successor" },
		work: { id: "work-successor" },
		contentPackage: { id: "package-successor", expectedRevision: 0 },
		quote: { id: "quote-successor", revision: "quote-successor-r1" },
		semanticDecision: {
			sourceSnapshotId: source.id,
			reference: {
				id: "decision-late-1",
				field: "offer_price",
				value: "398 元",
				revision: 1,
			},
		},
	};

	await stage.start({
		snapshot,
		work: snapshot.work,
		task: snapshot.task,
		contentPackage: snapshot.contentPackage,
		usageReservation: {
			id: "usage-reservation-task-successor",
			units: [{ resource: "copy", quantity: 1 }],
		},
	});

	const request = calls[0] as {
		decisionReferences?: unknown;
		intent?: { context?: Record<string, unknown> };
	};
	assert.equal(request.intent?.context?.offer_price, "398 元");
	assert.deepEqual(request.intent?.context?.sourceSummaries, [
		"Merchant decision (offer_price): 398 元",
	]);
	assert.deepEqual(request.decisionReferences, [
		snapshot.semanticDecision.reference,
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
		creationMode: "customized" as const,
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
		identityDecision: { id: "default-decision-1", revision: 7 },
		modelPolicy: {
			id: "policy-1",
			revision: "policy-r1",
			mode: "fixed" as const,
		},
		catalogModel: { id: "model-1", revision: "model-r1" },
		quote: { id: "quote-1", revision: "quote-r1" },
		route: { id: "route-1", revision: "route-r1" },
		briefConfirmation: { id: "brief-1", revision: "brief-r1" },
		briefContext: { id: "brief-context-1", revision: 1 },
		contentModules: ["social_cover" as const],
	};
}
