import assert from "node:assert/strict";
import test from "node:test";
import {
	CoreRemoteCall,
	CoreRemoteCallConfigurationError,
} from "./core-remote-call";

test("executes an authenticated Product Core P1 call through injected fetch", async () => {
	const requests: Array<{ init?: RequestInit; url: string }> = [];
	const remoteCall = new CoreRemoteCall({
		coreServiceToken: "service-secret",
		coreServiceUrl: "http://core.internal:4100/root/ignored",
		fetcher: async (input, init) => {
			requests.push({ init, url: String(input) });
			return jsonResponse(200, { data: { accepted: true } });
		},
	});

	const result = await remoteCall.request({
		body: { action: "example", module: "example", payload: {} },
		identity: {
			correlationId: "corr-1",
			userId: "user-1",
			workspaceId: "workspace/a",
		},
		idempotencyKey: "request-1",
		kind: "commands",
	});

	assert.deepEqual(result, {
		data: { accepted: true },
		kind: "success",
		status: 200,
	});
	assert.equal(
		requests[0]?.url,
		"http://core.internal:4100/v1/workspaces/workspace%2Fa/p1/commands",
	);
	const headers = new Headers(requests[0]?.init?.headers);
	assert.equal(headers.get("x-service-token"), "service-secret");
	assert.equal(headers.get("x-core-actor"), "worker");
	assert.equal(headers.get("x-correlation-id"), "corr-1");
	assert.equal(headers.get("x-user-id"), "user-1");
	assert.equal(headers.get("x-workspace-id"), "workspace/a");
	assert.equal(headers.get("idempotency-key"), "request-1");
});

test("reports transport outcomes without replacing domain error contracts", async () => {
	assert.throws(
		() =>
			new CoreRemoteCall({
				coreServiceToken: " ",
				coreServiceUrl: "http://core.internal:4100",
			}),
		(error: unknown) =>
			error instanceof CoreRemoteCallConfigurationError &&
			error.reason === "service-token",
	);

	const outcomes = [
		await requestWith(async () => {
			throw new Error("offline");
		}),
		await requestWith(async () => new Response("not-json", { status: 502 })),
		await requestWith(async () =>
			jsonResponse(409, { error: { code: "CONFLICT" } }),
		),
		await requestWith(async () => jsonResponse(200, { meta: {} })),
	];

	assert.deepEqual(
		outcomes.map((outcome) => outcome.kind),
		["unreachable", "non-json", "rejected", "invalid-envelope"],
	);
});

test("bounds ordinary Core calls with an abort signal", async () => {
	let observedSignal: AbortSignal | null = null;
	const result = await new CoreRemoteCall({
		coreServiceToken: "service-secret",
		coreServiceUrl: "http://core.internal:4100",
		fetcher: async (_input, init) => {
			observedSignal = init?.signal ?? null;
			return await rejectWhenAborted(observedSignal);
		},
		timeoutMs: 50,
	}).request({
		body: {},
		identity: {
			correlationId: "corr-1",
			userId: "user-1",
			workspaceId: "workspace-1",
		},
		kind: "query",
	});

	assert.equal(result.kind, "unreachable");
	assert.equal((observedSignal as AbortSignal | null)?.aborted, true);
});

/** Wait for AbortSignal including the already-aborted race (no hang in CI). */
function rejectWhenAborted(signal: AbortSignal | null): Promise<Response> {
	return new Promise((_resolve, reject) => {
		if (!signal) {
			reject(new Error("Core call missing AbortSignal"));
			return;
		}
		const fail = (reason: unknown) => {
			clearTimeout(safety);
			reject(reason ?? new Error("aborted"));
		};
		// Keep the event loop alive even if AbortSignal.timeout is delayed.
		const safety = setTimeout(
			() => fail(new Error("abort safety timeout")),
			500,
		);
		if (signal.aborted) {
			fail(signal.reason);
			return;
		}
		signal.addEventListener("abort", () => fail(signal.reason), { once: true });
	});
}

function requestWith(fetcher: typeof fetch) {
	return new CoreRemoteCall({
		coreServiceToken: "service-secret",
		coreServiceUrl: "http://core.internal:4100",
		fetcher,
	}).request({
		body: {},
		identity: {
			correlationId: "corr-1",
			userId: "user-1",
			workspaceId: "workspace-1",
		},
		kind: "query",
	});
}

function jsonResponse(status: number, body: unknown) {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status,
	});
}
