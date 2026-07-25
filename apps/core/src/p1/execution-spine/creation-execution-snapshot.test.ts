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
