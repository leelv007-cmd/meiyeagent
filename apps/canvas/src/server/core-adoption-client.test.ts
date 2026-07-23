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

test("lists only Core-authorized ContentPackage adoption targets", async () => {
	const requests: RequestInit[] = [];
	const client = new CoreAdvancedCanvasAdoptionClient({
		coreServiceToken: "service-secret",
		coreServiceUrl: "http://core.internal:4100",
		fetcher: async (_input, init) => {
			requests.push(init ?? {});
			return jsonResponse(200, {
				data: [
					{
						currentVersionId: "version-1",
						id: "package-1",
						revision: 4,
						rights: { state: "authorized" },
						versions: [{ id: "version-1", title: "Current package" }],
					},
					{
						currentVersionId: "version-2",
						id: "package-2",
						revision: 9,
						rights: { state: "revoked" },
						versions: [{ id: "version-2", title: "Revoked package" }],
					},
				],
			});
		},
	});

	assert.deepEqual(await client.listAdoptionTargets(context), [
		{
			handle: {
				baseVersionId: "version-1",
				expectedRevision: 4,
				packageId: "package-1",
			},
			id: "package-1",
			title: "Current package",
		},
	]);
	assert.deepEqual(JSON.parse(String(requests[0]?.body)), {
		action: "content_packages",
		module: "operations",
		payload: {},
	});
});

test("fails closed for authorized packages without a current version or OCC revision", async () => {
	const client = new CoreAdvancedCanvasAdoptionClient({
		coreServiceToken: "service-secret",
		coreServiceUrl: "http://core.internal:4100",
		fetcher: async () =>
			jsonResponse(200, {
				data: [
					{
						id: "package-without-current-version",
						revision: 2,
						rights: { state: "authorized" },
						versions: [],
					},
					{
						currentVersionId: "version-2",
						id: "package-without-occ",
						rights: { state: "authorized" },
						versions: [{ id: "version-2", title: "Incomplete target" }],
					},
				],
			}),
	});

	assert.deepEqual(await client.listAdoptionTargets(context), []);
});

test("fails closed when Core omits the public authorization fact", async () => {
	const client = new CoreAdvancedCanvasAdoptionClient({
		coreServiceToken: "service-secret",
		coreServiceUrl: "http://core.internal:4100",
		fetcher: async () =>
			jsonResponse(200, {
				data: [
					{
						currentVersionId: "version-1",
						id: "package-1",
						revision: 1,
						versions: [{ id: "version-1", title: "Unverified package" }],
					},
				],
			}),
	});

	assert.deepEqual(await client.listAdoptionTargets(context), []);
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

test("preserves adoption configuration and unavailable error contracts", async () => {
	assert.throws(
		() =>
			new CoreAdvancedCanvasAdoptionClient({
				coreServiceToken: " ",
				coreServiceUrl: "http://core.internal:4100",
			}),
		(error: unknown) =>
			error instanceof CoreAdvancedCanvasAdoptionError &&
			error.code === "CORE_SERVICE_TOKEN_REQUIRED" &&
			error.status === 503,
	);
	assert.throws(
		() =>
			new CoreAdvancedCanvasAdoptionClient({
				coreServiceToken: "service-secret",
				coreServiceUrl: "://invalid",
			}),
		(error: unknown) =>
			error instanceof CoreAdvancedCanvasAdoptionError &&
			error.code === "CORE_SERVICE_URL_INVALID" &&
			error.status === 503,
	);

	const client = new CoreAdvancedCanvasAdoptionClient({
		coreServiceToken: "service-secret",
		coreServiceUrl: "http://core.internal:4100",
		fetcher: async () => {
			throw new Error("offline");
		},
	});
	await assert.rejects(
		client.listAdoptions(context, "project-1"),
		(error: unknown) =>
			error instanceof CoreAdvancedCanvasAdoptionError &&
			error.code === "CORE_UNREACHABLE" &&
			error.status === 503 &&
			/Core adoption is unavailable/.test(error.message),
	);
});

function jsonResponse(status: number, body: unknown) {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status,
	});
}
