import assert from "node:assert/strict";
import test from "node:test";
import {
	CanvasSessionService,
	LaunchCodeService,
	MemoryLaunchCodeRepository,
} from "@meiye/core/pro-studio";
import { MainSessionAvailabilityError, validateMainSession } from "./runtime";

test("a Main availability failure does not revoke the Canvas session", async () => {
	const originalFetch = globalThis.fetch;
	const originalMainOrigin = process.env.MAIN_APP_ORIGIN;
	const originalServiceToken = process.env.CANVAS_SERVICE_TOKEN;
	process.env.MAIN_APP_ORIGIN = "http://main.test";
	process.env.CANVAS_SERVICE_TOKEN = "service-token";
	const repository = new MemoryLaunchCodeRepository();
	const launch = new LaunchCodeService({
		access: {
			async canAccessProject() {
				return true;
			},
			async canAccessWorkspace() {
				return true;
			},
		},
		repository,
	});
	const issued = await launch.issue({
		audience: { kind: "workspace" },
		browserNonce: "browser-nonce",
		mainSessionId: "main-session-1",
		userId: "user-1",
		workspaceId: "workspace-1",
	});
	const exchanged = await launch.exchange({
		browserNonce: "browser-nonce",
		code: issued.code,
	});
	const sessions = new CanvasSessionService({
		repository,
		upstream: { isActive: validateMainSession },
	});

	try {
		globalThis.fetch = async () => new Response(null, { status: 503 });
		await assert.rejects(
			sessions.authenticate(exchanged.sessionToken),
			(error: unknown) => error instanceof MainSessionAvailabilityError,
		);
		globalThis.fetch = async () => {
			throw new Error("network unavailable");
		};
		await assert.rejects(
			sessions.authenticate(exchanged.sessionToken),
			(error: unknown) => error instanceof MainSessionAvailabilityError,
		);

		globalThis.fetch = async () => new Response(null, { status: 204 });
		assert.equal(
			(await sessions.authenticate(exchanged.sessionToken)).workspaceId,
			"workspace-1",
		);
	} finally {
		globalThis.fetch = originalFetch;
		if (originalMainOrigin === undefined) delete process.env.MAIN_APP_ORIGIN;
		else process.env.MAIN_APP_ORIGIN = originalMainOrigin;
		if (originalServiceToken === undefined)
			delete process.env.CANVAS_SERVICE_TOKEN;
		else process.env.CANVAS_SERVICE_TOKEN = originalServiceToken;
	}
});

test("an explicit Main authorization rejection invalidates the Canvas session", async () => {
	const originalFetch = globalThis.fetch;
	const originalMainOrigin = process.env.MAIN_APP_ORIGIN;
	const originalServiceToken = process.env.CANVAS_SERVICE_TOKEN;
	process.env.MAIN_APP_ORIGIN = "http://main.test";
	process.env.CANVAS_SERVICE_TOKEN = "service-token";
	try {
		for (const status of [401, 403]) {
			globalThis.fetch = async () => new Response(null, { status });
			assert.equal(
				await validateMainSession({
					audience: { kind: "workspace" },
					mainSessionId: "main-session-1",
					userId: "user-1",
					workspaceId: "workspace-1",
				}),
				false,
			);
		}
	} finally {
		globalThis.fetch = originalFetch;
		if (originalMainOrigin === undefined) delete process.env.MAIN_APP_ORIGIN;
		else process.env.MAIN_APP_ORIGIN = originalMainOrigin;
		if (originalServiceToken === undefined)
			delete process.env.CANVAS_SERVICE_TOKEN;
		else process.env.CANVAS_SERVICE_TOKEN = originalServiceToken;
	}
});

test("bounds Main session validation with an abort signal", async () => {
	const originalServiceToken = process.env.CANVAS_SERVICE_TOKEN;
	process.env.CANVAS_SERVICE_TOKEN = "service-token";
	let observedSignal: AbortSignal | null = null;
	try {
		await assert.rejects(
			validateMainSession(
				{
					audience: { kind: "workspace" },
					mainSessionId: "main-session-1",
					userId: "user-1",
					workspaceId: "workspace-1",
				},
				{
					fetcher: async (_input, init) => {
						observedSignal = init?.signal ?? null;
						return await new Promise<Response>((_resolve, reject) => {
							observedSignal?.addEventListener(
								"abort",
								() => reject(observedSignal?.reason),
								{ once: true },
							);
						});
					},
					timeoutMs: 10,
				},
			),
			(error: unknown) => error instanceof MainSessionAvailabilityError,
		);
		assert.equal((observedSignal as AbortSignal | null)?.aborted, true);
	} finally {
		if (originalServiceToken === undefined)
			delete process.env.CANVAS_SERVICE_TOKEN;
		else process.env.CANVAS_SERVICE_TOKEN = originalServiceToken;
	}
});
