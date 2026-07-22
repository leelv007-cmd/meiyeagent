import assert from "node:assert/strict";
import test from "node:test";
import {
	CANVAS_BACKEND_PORT_VNEXT,
	canvasGenerationItemBindingSchema,
	canvasGenerationLineageSchema,
} from "./backend-port-vnext.js";

test("K1 freezes every vNext BackendPort record with owner, compatibility, errors and test seam", () => {
	for (const contract of Object.values(CANVAS_BACKEND_PORT_VNEXT)) {
		assert.equal(contract.compatibility, "additive-v1", contract.action);
		assert.equal(contract.owner, "Core model-supply", contract.action);
		assert.equal(
			contract.test,
			"apps/canvas/src/server/backend-port-vnext.test.ts",
		);
		assert.ok(contract.errors.length > 0, contract.action);
		assert.ok(["header", "none"].includes(contract.idempotency));
	}
	assert.deepEqual(
		CANVAS_BACKEND_PORT_VNEXT.getCatalog.response.parse({
			defaultModelIdByOperation: { "image.generate": "image-v1" },
			unavailableReasonCodeByOperation: { "audio.sfx": "MODEL_NOT_CONFIGURED" },
		}),
		{
			defaultModelIdByOperation: { "image.generate": "image-v1" },
			unavailableReasonCodeByOperation: { "audio.sfx": "MODEL_NOT_CONFIGURED" },
		},
	);
	assert.throws(() =>
		CANVAS_BACKEND_PORT_VNEXT.listAssets.request.parse({ unknown: true }),
	);
});

test("reserved generation items retain revision lineage and require an item binding", () => {
	assert.deepEqual(
		canvasGenerationLineageSchema.parse({
			originRef: "advanced_canvas_project_revision",
			projectId: "project-1",
			revisionId: "revision-1",
		}),
		{
			originRef: "advanced_canvas_project_revision",
			projectId: "project-1",
			revisionId: "revision-1",
		},
	);
	assert.throws(() =>
		canvasGenerationItemBindingSchema.parse({
			projectId: "project-1",
			revisionId: "revision-1",
		}),
	);
	assert.equal(
		canvasGenerationItemBindingSchema.parse({
			nodeId: "node-1",
			projectId: "project-1",
			revisionId: "revision-1",
		}).nodeId,
		"node-1",
	);
});
