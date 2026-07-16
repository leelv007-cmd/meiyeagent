import assert from "node:assert/strict";
import test from "node:test";

import type { CanvasAgentGraph } from "@meiye/core/pro-studio-runtime";
import { CoreCanvasAgentPlanner } from "./core-planner";

const graph: CanvasAgentGraph = {
	assetVersions: {},
	edges: [],
	nodes: [],
	projectId: "project-1",
	revision: 3,
	workspaceId: "workspace-1",
};

test("plans only through the fixed Core text.respond facade", async () => {
	const calls: string[] = [];
	const planner = new CoreCanvasAgentPlanner({
		async getCatalog() {
			calls.push("catalog");
			return {
				revisionId: "catalog-v4",
				operations: [{ activation: "active", operation: "text.respond" }],
			};
		},
		async respondText(input) {
			calls.push("respond");
			assert.equal(input.workspaceId, graph.workspaceId);
			assert.equal(input.userId, "owner-1");
			assert.match(input.idempotencyKey, /^canvas-agent-plan-/u);
			assert.match(input.prompt, /fixed seven Canvas tools/u);
			return {
				jobId: "core-plan-job-1",
				status: "completed",
				text: JSON.stringify({
					operations: [
						{
							node: { data: { text: "new" }, id: "text-2", kind: "text" },
							tool: "create_node",
						},
					],
				}),
			};
		},
	});

	assert.equal(await planner.isAvailable("workspace-1"), true);
	assert.deepEqual(
		await planner.plan({
			context: {
				correlationId: "corr-1",
				userId: "owner-1",
				workspaceId: "workspace-1",
			},
			graph,
			intent: "Create a text node",
		}),
		[
			{
				node: { data: { text: "new" }, id: "text-2", kind: "text" },
				tool: "create_node",
			},
		],
	);
	assert.deepEqual(calls, ["catalog", "respond"]);
});

test("rejects arbitrary tools returned by Core text generation", async () => {
	const planner = new CoreCanvasAgentPlanner({
		async getCatalog() {
			return {
				operations: [{ activation: "active", operation: "text.respond" }],
			};
		},
		async respondText() {
			return {
				jobId: "core-plan-job-1",
				status: "completed",
				text: '{"operations":[{"tool":"run_shell","command":"env"}]}',
			};
		},
	});

	await assert.rejects(
		planner.plan({
			context: {
				correlationId: "corr-1",
				userId: "owner-1",
				workspaceId: "workspace-1",
			},
			graph,
			intent: "Run anything",
		}),
		(error: unknown) =>
			error instanceof Error &&
			"code" in error &&
			error.code === "AGENT_PLAN_INVALID",
	);
});
