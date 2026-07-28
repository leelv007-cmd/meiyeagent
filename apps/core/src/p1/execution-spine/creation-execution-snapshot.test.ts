import assert from "node:assert/strict";
import test from "node:test";

import {
	createCreationExecutionSnapshot,
	creationExecutionSnapshotSchema,
} from "./creation-execution-snapshot.js";

test("persisted v1 snapshots with the original three lenses remain readable", () => {
	for (const lens of ["copy", "image", "video"] as const) {
		const snapshot = createCreationExecutionSnapshot(
			{
				actorId: "owner-1",
				workspaceId: "workspace-1",
				idempotencyKey: `legacy-${lens}`,
				taskId: `task-${lens}`,
				workId: `work-${lens}`,
				contentPackageId: `package-${lens}`,
				expectedContentPackageRevision: 0,
				creationMode: "customized",
				intent: "legacy snapshot replay",
				surface: { id: "surface-1", revision: "surface-r1" },
				recipe: { id: "recipe-1", revision: "recipe-r1" },
				lens,
				platform: { id: "xiaohongshu" },
				deliverables: [{
					id: `${lens}-main`,
					kind: lens,
					order: 0,
					quantity: 1,
					...(lens === "copy" ? {} : { aspectRatio: "3:4" as const }),
					...(lens === "video" ? { durationSeconds: 8 } : {}),
				}],
				sources: { assets: [] },
				rights: { revision: "rights-r1", summary: "authorized" },
				identity: { id: "identity-1", revision: "identity-r1" },
				modelPolicy: { id: "policy-1", revision: "policy-r1", mode: "fixed" },
				catalogModel: { id: "model-1", revision: "model-r1" },
				quote: { id: "quote-1", revision: "quote-r1" },
				route: { id: "route-1", revision: "route-r1" },
				briefContext: { id: "context-1", revision: 1 },
				briefConfirmation: { id: "brief-1", revision: "brief-r1" },
				contentModules: ["social_cover"],
			},
			"2026-07-25T00:00:00.000Z",
		);
		const persistedBeforeFourthLens = JSON.parse(JSON.stringify(snapshot));

		const replayed = creationExecutionSnapshotSchema.parse(
			persistedBeforeFourthLens,
		);

		assert.equal(replayed.lens, lens);
		assert.equal(replayed.deliverables[0]?.kind, lens);
	}
});

test("image-text note freezes its signed Recipe page bound inside the deliverable", () => {
	const base = {
		actorId: "owner-1",
		workspaceId: "workspace-1",
		idempotencyKey: "note-bound",
		taskId: "task-note",
		workId: "work-note",
		contentPackageId: "package-note",
		expectedContentPackageRevision: 0,
		creationMode: "customized" as const,
		intent: "三页促销图文",
		surface: { id: "surface-1", revision: "surface-r1" },
		recipe: { id: "recipe-note", revision: "recipe-note@1" },
		lens: "image_text_note" as const,
		platform: { id: "xiaohongshu" as const },
		contentPackagePlatform: "xiaohongshu" as const,
		distributionTarget: "export" as const,
		deliverable: {
			kind: "note" as const,
			quantity: 1,
			aspectRatio: "3:4" as const,
			notePageBound: 3,
		},
		deliverables: [{
			id: "note-main",
			kind: "image_text_note" as const,
			order: 0,
			quantity: 1,
			aspectRatio: "3:4" as const,
			notePageBound: 3,
		}],
		sources: { assets: [] },
		rights: { revision: "rights-r1", summary: "authorized" },
		identity: { id: "identity-1", revision: "identity-r1" },
		modelPolicy: { id: "policy-1", revision: "policy-r1", mode: "fixed" as const },
		catalogModel: { id: "model-1", revision: "model-r1" },
		modelSelection: {
			source: "platform_default" as const,
			catalogModelId: "model-1",
			platformConfigRevision: "admin-config:12",
		},
		quote: { id: "quote-1", revision: "quote-r1" },
		route: { id: "route-1", revision: "route-r1" },
		briefContext: { id: "context-1", revision: 1 },
		contentModules: ["social_cover" as const],
	};

	const snapshot = createCreationExecutionSnapshot(
		base,
		"2026-07-26T00:00:00.000Z",
	);
	assert.equal(snapshot.deliverable.notePageBound, 3);
	assert.equal(snapshot.deliverables[0]?.notePageBound, 3);
	assert.deepEqual(snapshot.modelSelection, {
		source: "platform_default",
		catalogModelId: "model-1",
		platformConfigRevision: "admin-config:12",
	});
	assert.throws(
		() =>
			creationExecutionSnapshotSchema.parse({
				...snapshot,
				modelSelection: {
					source: "platform_default",
					catalogModelId: "model-1",
					platformConfigRevision: null,
				},
			}),
		/requires its platform config revision/u,
	);
	assert.throws(
		() =>
			createCreationExecutionSnapshot(
				{
					...base,
					deliverables: [{ ...base.deliverables[0]!, notePageBound: 4 }],
				},
				"2026-07-26T00:00:00.000Z",
			),
		/Execution deliverable must preserve/u,
	);
});
