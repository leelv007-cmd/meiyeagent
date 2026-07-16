import assert from "node:assert/strict";
import test from "node:test";

import {
	CoreAdvancedCanvasAdoptionClient,
	CoreAdvancedCanvasAdoptionError,
} from "./core-adoption-client";

const context = {
	correlationId: "corr-adoption-1",
	userId: "user-a",
	workspaceId: "workspace/a",
};
const command = {
	idempotencyKey: "adoption-key-1",
	projectId: "project-1",
	revisionRef: { kind: "frozen" as const, revisionId: "revision-1" },
	selection: {
		orderedMediaNodeIds: ["image-1"],
		textNodeId: "text-1",
	},
	target: { kind: "new_package" as const },
};

test("forwards adoption and list one-to-one to Product Core module actions", async () => {
	const requests: Array<{ init?: RequestInit; url: string }> = [];
	const client = new CoreAdvancedCanvasAdoptionClient({
		coreServiceToken: "service-secret",
		coreServiceUrl: "http://core.internal:4100/root/ignored",
		fetcher: async (input, init) => {
			requests.push({ init, url: input.toString() });
			return jsonResponse(200, {
				data:
					requests.length === 1
						? {
								orderedMediaNodeIds: ["image-1"],
								packageId: "package-1",
								projectId: "project-1",
								revisionId: "revision-1",
								selectedNodeIds: ["text-1", "image-1"],
								versionId: "version-1",
							}
						: [],
			});
		},
	});

	const adopted = await client.adopt(context, command);
	const listed = await client.listAdoptions(context, "project-1");

	assert.equal(adopted.packageId, "package-1");
	assert.deepEqual(listed, []);
	assert.equal(
		requests[0]?.url,
		"http://core.internal:4100/v1/workspaces/workspace%2Fa/p1/commands",
	);
	assert.equal(requests[1]?.url.endsWith("/p1/query"), true);
	const commandHeaders = new Headers(requests[0]?.init?.headers);
	assert.equal(commandHeaders.get("x-service-token"), "service-secret");
	assert.equal(commandHeaders.get("x-core-actor"), "worker");
	assert.equal(commandHeaders.get("x-user-id"), context.userId);
	assert.equal(commandHeaders.get("x-workspace-id"), context.workspaceId);
	assert.equal(commandHeaders.get("x-correlation-id"), context.correlationId);
	assert.equal(commandHeaders.get("idempotency-key"), command.idempotencyKey);
	assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
		action: "adopt_advanced_canvas_output",
		module: "advanced-canvas",
		payload: {
			projectId: command.projectId,
			revisionRef: command.revisionRef,
			selection: command.selection,
			target: command.target,
		},
	});
	assert.deepEqual(JSON.parse(String(requests[1]?.init?.body)), {
		action: "list_adoptions",
		module: "advanced-canvas",
		payload: { projectId: "project-1" },
	});
});

test("preserves a rejected Core adoption code without leaking its internals", async () => {
	const client = new CoreAdvancedCanvasAdoptionClient({
		coreServiceToken: "service-secret",
		coreServiceUrl: "http://core.internal:4100",
		fetcher: async () =>
			jsonResponse(409, {
				error: {
					code: "CONTENT_VERSION_CONFLICT",
					message: "The P1 command could not be processed.",
				},
			}),
	});

	await assert.rejects(
		client.adopt(context, command),
		(error: unknown) =>
			error instanceof CoreAdvancedCanvasAdoptionError &&
			error.code === "CONTENT_VERSION_CONFLICT" &&
			error.status === 409,
	);
});

function jsonResponse(status: number, body: unknown) {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status,
	});
}
