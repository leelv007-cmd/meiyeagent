import assert from "node:assert/strict";
import test from "node:test";
import {
	merchantSafeWorkspaceDisplayName,
	projectCardMetadata,
	selectedProjectsForDeletion,
	toggleProjectSelection,
	WORKSPACE_DISPLAY_FALLBACK,
} from "./project-journey.js";

test("project card metadata exposes merchant-facing counts and update time only", () => {
	const metadata = projectCardMetadata({
		graph: {
			edges: [{ source: "image-internal", target: "text-internal" }],
			nodes: [
				{
					data: { promptSeedId: "provider-seed" },
					id: "image-internal",
					type: "image",
				},
				{ data: {}, id: "text-internal", type: "text" },
			],
			schemaVersion: 1,
		},
		updatedAt: "2026-07-23T10:30:00.000Z",
	});

	assert.deepEqual(Object.keys(metadata).sort(), [
		"edgeCount",
		"nodeCount",
		"updatedAt",
	]);
	assert.equal(metadata.nodeCount, 2);
	assert.equal(metadata.edgeCount, 1);
	assert.notEqual(metadata.updatedAt, "更新时间未知");
});

test("project selection supports a single card and multi-select deletion", () => {
	const selected = toggleProjectSelection([], "project-a", true);
	const multiSelected = toggleProjectSelection(selected, "project-b", true);
	assert.deepEqual(multiSelected, ["project-a", "project-b"]);
	assert.deepEqual(toggleProjectSelection(multiSelected, "project-a", false), [
		"project-b",
	]);
	assert.deepEqual(
		selectedProjectsForDeletion(
			[
				{ id: "project-a", name: "夏日门店海报" },
				{ id: "project-b", name: "秋季套餐" },
			],
			multiSelected,
		),
		[
			{ id: "project-a", name: "夏日门店海报" },
			{ id: "project-b", name: "秋季套餐" },
		],
	);
});

test("workspace display uses only a merchant-safe server name or a non-identifying fallback", () => {
	assert.equal(
		merchantSafeWorkspaceDisplayName("星河美业工作室"),
		"星河美业工作室",
	);
	assert.equal(
		merchantSafeWorkspaceDisplayName("workspace_01HZXNED4R5ZP4"),
		WORKSPACE_DISPLAY_FALLBACK,
	);
	assert.equal(
		merchantSafeWorkspaceDisplayName("workspace-1"),
		WORKSPACE_DISPLAY_FALLBACK,
	);
	assert.equal(
		merchantSafeWorkspaceDisplayName("2d318636-d6cb-4a38-9c36-c964245e6e5c"),
		WORKSPACE_DISPLAY_FALLBACK,
	);
	assert.equal(
		merchantSafeWorkspaceDisplayName(
			"opaque-workspace-id",
			"opaque-workspace-id",
		),
		WORKSPACE_DISPLAY_FALLBACK,
	);
	assert.equal(
		merchantSafeWorkspaceDisplayName(undefined),
		WORKSPACE_DISPLAY_FALLBACK,
	);
	assert.equal(
		merchantSafeWorkspaceDisplayName("Workspace"),
		WORKSPACE_DISPLAY_FALLBACK,
	);
});
