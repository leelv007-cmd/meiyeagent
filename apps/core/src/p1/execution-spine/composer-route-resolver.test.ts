import assert from "node:assert/strict";
import test from "node:test";

import type { RouteSnapshot as FoundationRouteSnapshot } from "../foundation/domain.js";
import type { RouteSnapshot as ModelSupplyRouteSnapshot } from "../model-supply/index.js";
import { ModelSupplyComposerRouteResolver } from "./composer-route-resolver.js";

test("Composer route resolver freezes and replays the quote-selected model", async () => {
	const stored = new Map<string, FoundationRouteSnapshot>();
	let freezes = 0;
	let inserts = 0;
	let frozenDataClass: string[] = [];
	const resolver = new ModelSupplyComposerRouteResolver(
		{
			async freezeFixedRouteForExecution(input) {
				freezes += 1;
				frozenDataClass = [...input.dataClass];
				return frozenRoute(input.dataClass);
			},
		},
		{
			async getRouteSnapshot(workspaceId, snapshotId) {
				const route = stored.get(snapshotId);
				return route?.workspaceId === workspaceId
					? structuredClone(route)
					: null;
			},
			async insertRouteSnapshot(route) {
				inserts += 1;
				stored.set(route.id, structuredClone(route));
			},
		},
	);

	const first = await resolver.resolve({
		catalogModel: { id: "catalog-image-1", revision: "catalog-r4" },
		dataClass: ["pii", "contains_face"],
		operation: "image.generate",
		workspaceId: "workspace-1",
	});
	const replay = await resolver.resolve({
		catalogModel: { id: "catalog-image-1", revision: "catalog-r4" },
		dataClass: ["contains_face", "pii"],
		operation: "image.generate",
		workspaceId: "workspace-1",
	});

	assert.equal(first?.selectionMode, "fixed");
	assert.equal(first?.requestedCatalogModelId, "catalog-image-1");
	assert.equal(first?.workspaceId, "workspace-1");
	assert.deepEqual(first?.dataClasses, ["contains_face", "pii"]);
	assert.deepEqual(frozenDataClass, ["contains_face", "pii"]);
	assert.deepEqual(replay, first);
	assert.equal(freezes, 2);
	assert.equal(inserts, 1);
});

test("Composer route resolver rejects a route from a different catalog revision", async () => {
	const resolver = new ModelSupplyComposerRouteResolver(
		{
			async freezeFixedRouteForExecution() {
				return frozenRoute();
			},
		},
		{
			async getRouteSnapshot() {
				return null;
			},
			async insertRouteSnapshot() {
				assert.fail("a stale route must not be inserted");
			},
		},
	);

	await assert.rejects(
		resolver.resolve({
			catalogModel: { id: "catalog-image-1", revision: "catalog-r5" },
			dataClass: [],
			operation: "image.generate",
			workspaceId: "workspace-1",
		}),
		/The current model route no longer matches the confirmed ProductQuote/u,
	);
});

function frozenRoute(dataClass: ModelSupplyRouteSnapshot["dataClass"] = []): ModelSupplyRouteSnapshot {
	return {
		actualCatalogModelId: "catalog-image-1",
		candidateCatalogModelIds: ["catalog-image-1"],
		catalogRevisionId: "catalog-r4",
		createdAt: "2026-07-24T08:00:00.000Z",
		credentialMode: "platform",
		credentialVersion: "credential-r1",
		dataClass,
		deploymentId: "deployment-image-1",
		id: "model-route-image-1",
		policyRevision: "policy-r1",
		priceRevision: "price-r1",
		reason: "fixed_selection",
		requestedSelection: {
			catalogModelId: "catalog-image-1",
			mode: "fixed",
		},
	};
}
