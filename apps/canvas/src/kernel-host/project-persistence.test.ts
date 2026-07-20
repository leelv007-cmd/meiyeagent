import assert from "node:assert/strict";
import test from "node:test";
import type {
	AdvancedCanvasProject,
	AdvancedCanvasRevision,
	CanvasGraph,
} from "@meiye/core/pro-studio";
import { emptyKernelGraph } from "./graph-bridge.js";
import {
	DraftVersionConflictError,
	mapDraftConflict,
	ProjectPersistenceAdapter,
} from "./project-persistence.js";

function projectFixture(
	overrides: Partial<AdvancedCanvasProject> = {},
): AdvancedCanvasProject {
	const graph: CanvasGraph = {
		edges: [],
		nodes: [
			{
				data: { assetId: "asset-1", x: 10, y: 20 },
				id: "n1",
				type: "image",
			},
		],
		schemaVersion: 1,
	};
	return {
		createdAt: "2026-07-19T00:00:00.000Z",
		createdBy: "user-1",
		draftVersion: 3,
		graph,
		id: "proj-1",
		name: "Campaign",
		updatedAt: "2026-07-19T01:00:00.000Z",
		workspaceId: "ws-1",
		...overrides,
	};
}

test("loadProject maps graph to kernel and lists revisions", async () => {
	const project = projectFixture();
	const revisions: AdvancedCanvasRevision[] = [
		{
			createdAt: "2026-07-19T00:30:00.000Z",
			createdBy: "user-1",
			draftVersion: 2,
			graph: project.graph,
			id: "rev-1",
			projectId: "proj-1",
			reason: "checkpoint",
			workspaceId: "ws-1",
		},
	];
	const calls: Array<{ action: string; input?: Record<string, unknown> }> = [];
	const adapter = new ProjectPersistenceAdapter(async (action, input) => {
		calls.push({ action, input });
		if (action === "loadProject") return project as never;
		if (action === "listRevisions") return revisions as never;
		throw new Error(`unexpected ${action}`);
	});

	const loaded = await adapter.loadProject("proj-1");
	assert.equal(loaded.project.id, "proj-1");
	assert.equal(loaded.kernel.nodes[0]?.id, "n1");
	assert.equal(loaded.kernel.nodes[0]?.x, 10);
	assert.equal(loaded.revisions[0]?.id, "rev-1");
	assert.deepEqual(calls.map((call) => call.action).sort(), [
		"listRevisions",
		"loadProject",
	]);
});

test("project CRUD and getRevision use the complete BackendPort contract", async () => {
	const project = projectFixture();
	const revision: AdvancedCanvasRevision = {
		createdAt: "2026-07-19T00:30:00.000Z",
		createdBy: "user-1",
		draftVersion: 3,
		graph: project.graph,
		id: "rev-1",
		projectId: project.id,
		reason: "checkpoint",
		workspaceId: project.workspaceId,
	};
	const calls: Array<{ action: string; input?: Record<string, unknown> }> = [];
	const adapter = new ProjectPersistenceAdapter(async (action, input) => {
		calls.push({ action, input });
		if (action === "listProjects") return [project] as never;
		if (action === "getRevision") return revision as never;
		if (action === "deleteProject") {
			return { projectId: project.id, retentionDays: 30 } as never;
		}
		return project as never;
	});

	await adapter.listProjects();
	await adapter.createProject("Created", emptyKernelGraph());
	await adapter.renameProject(project.id, "Renamed");
	await adapter.duplicateProject(project.id, "Copy");
	await adapter.deleteProject(project.id);
	assert.equal(
		(await adapter.getRevision(project.id, revision.id)).id,
		revision.id,
	);

	assert.deepEqual(
		calls.map(({ action }) => action),
		[
			"listProjects",
			"createProject",
			"renameProject",
			"duplicateProject",
			"deleteProject",
			"getRevision",
		],
	);
});

test("saveDraft maps kernel via fromKernelGraph then saveProjectDraft", async () => {
	const saved = projectFixture({ draftVersion: 4 });
	let observed: Record<string, unknown> | undefined;
	const adapter = new ProjectPersistenceAdapter(async (action, input) => {
		assert.equal(action, "saveProjectDraft");
		observed = input;
		return saved as never;
	});

	const kernel = emptyKernelGraph();
	kernel.nodes.push({
		data: { assetId: "asset-2", prompt: "glow" },
		height: 140,
		id: "img-2",
		type: "image",
		width: 220,
		x: 40,
		y: 60,
	});

	const result = await adapter.saveDraft("proj-1", 3, kernel);
	assert.equal(result.draftVersion, 4);
	assert.equal(observed?.projectId, "proj-1");
	assert.equal(observed?.expectedDraftVersion, 3);
	const graph = observed?.graph as CanvasGraph;
	assert.equal(graph.schemaVersion, 1);
	assert.equal(graph.nodes[0]?.data.assetId, "asset-2");
	assert.equal(graph.nodes[0]?.data.x, 40);
	assert.equal(graph.nodes[0]?.data.y, 60);
	assert.equal(graph.nodes[0]?.data.prompt, "glow");
});

test("saveDraft maps DRAFT_VERSION_CONFLICT", async () => {
	const adapter = new ProjectPersistenceAdapter(async () => {
		const error = new Error("conflict");
		(error as Error & { code: string }).code = "DRAFT_VERSION_CONFLICT";
		throw error;
	});
	await assert.rejects(
		() => adapter.saveDraft("proj-1", 1, emptyKernelGraph()),
		(error: unknown) =>
			error instanceof DraftVersionConflictError &&
			error.code === "DRAFT_VERSION_CONFLICT",
	);
});

test("createCheckpoint, restoreRevision, listRevisions call BackendPort actions", async () => {
	const calls: Array<{ action: string; input?: Record<string, unknown> }> = [];
	const adapter = new ProjectPersistenceAdapter(async (action, input) => {
		calls.push({ action, input });
		if (action === "restoreRevision") {
			return projectFixture({ draftVersion: 5 }) as never;
		}
		if (action === "listRevisions") return [] as never;
		return { ok: true } as never;
	});

	await adapter.createCheckpoint({
		expectedDraftVersion: 3,
		label: "cp",
		projectId: "proj-1",
	});
	const restored = await adapter.restoreRevision({
		expectedDraftVersion: 3,
		projectId: "proj-1",
		revisionId: "rev-1",
	});
	await adapter.listRevisions("proj-1");

	assert.equal(restored.draftVersion, 5);
	assert.deepEqual(
		calls.map((call) => call.action),
		["createCheckpoint", "restoreRevision", "listRevisions"],
	);
});

test("createCheckpoint and restoreRevision map DRAFT_VERSION_CONFLICT", async () => {
	const adapter = new ProjectPersistenceAdapter(async () => {
		throw Object.assign(new Error("stale"), {
			code: "DRAFT_VERSION_CONFLICT",
		});
	});
	await assert.rejects(
		() =>
			adapter.createCheckpoint({
				expectedDraftVersion: 1,
				projectId: "p",
			}),
		DraftVersionConflictError,
	);
	await assert.rejects(
		() =>
			adapter.restoreRevision({
				expectedDraftVersion: 1,
				projectId: "p",
				revisionId: "r",
			}),
		DraftVersionConflictError,
	);
});

test("mapDraftConflict rethrows non-conflict errors", () => {
	assert.throws(
		() => mapDraftConflict(new Error("other")),
		(error: unknown) => error instanceof Error && error.message === "other",
	);
});
