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
	assert.deepEqual(
		CANVAS_BACKEND_PORT_VNEXT.listAssets.response.parse({
			items: [{ id: "asset-1", kind: "image", title: "夏日门店图" }],
			nextCursor: null,
		}),
		{
			items: [{ id: "asset-1", kind: "image", title: "夏日门店图" }],
			nextCursor: null,
		},
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

test("adoption target response carries a server-derived current version and OCC handle", () => {
	assert.deepEqual(
		CANVAS_BACKEND_PORT_VNEXT.listAdoptionTargets.response.parse({
			items: [
				{
					handle: {
						baseVersionId: "version-1",
						expectedRevision: 3,
						packageId: "package-1",
					},
					id: "package-1",
					title: "Merchant package",
				},
			],
			nextCursor: null,
		}),
		{
			items: [
				{
					handle: {
						baseVersionId: "version-1",
						expectedRevision: 3,
						packageId: "package-1",
					},
					id: "package-1",
					title: "Merchant package",
				},
			],
			nextCursor: null,
		},
	);
	assert.throws(() =>
		CANVAS_BACKEND_PORT_VNEXT.listAdoptionTargets.response.parse({
			items: [
				{
					handle: {
						expectedRevision: 3,
						packageId: "package-1",
					},
					id: "package-1",
					title: "Merchant package",
				},
			],
			nextCursor: null,
		}),
	);
});

test("export contract keeps asset failures private and supports explicit available-only option", () => {
	assert.deepEqual(CANVAS_BACKEND_PORT_VNEXT.exportCanvas.errors, [
		"EXPORT_NOT_AVAILABLE",
		"REVISION_NOT_FOUND",
	]);
	assert.deepEqual(
		CANVAS_BACKEND_PORT_VNEXT.exportCanvas.request.parse({
			format: "zip",
			includeAvailableOnly: true,
			projectId: "project-1",
			revisionId: "revision-1",
		}),
		{
			format: "zip",
			includeAvailableOnly: true,
			projectId: "project-1",
			revisionId: "revision-1",
		},
	);
});
