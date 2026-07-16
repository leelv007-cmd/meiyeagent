import assert from "node:assert/strict";
import test from "node:test";
import { LaunchCodeError } from "@meiye/core/pro-studio";
import { handleProStudioEntryRequest } from "./pro-studio-entry-handler";

const body = {
	mainSessionId: "main-session-1",
	userId: "user-1",
	workspaceId: "workspace-1",
};

test("internal entry preserves typed access errors and reports unknown failures as unavailable", async () => {
	const originalToken = process.env.CANVAS_SERVICE_TOKEN;
	process.env.CANVAS_SERVICE_TOKEN = "service-token";
	try {
		for (const [error, expectedStatus] of [
			[
				new LaunchCodeError("SESSION_EXPIRED", "Main session is not active."),
				401,
			],
			[
				Object.assign(new Error("Workspace membership is required."), {
					code: "FORBIDDEN",
				}),
				403,
			],
			[new Error("database unavailable"), 503],
		] as const) {
			const response = await handleProStudioEntryRequest(
				new Request("http://canvas.test/api/internal/pro-studio-entry", {
					body: JSON.stringify(body),
					headers: {
						"content-type": "application/json",
						"x-canvas-service-token": "service-token",
					},
					method: "POST",
				}),
				async () => ({
					entry: {
						async get() {
							throw error;
						},
					},
				}),
			);
			assert.equal(response.status, expectedStatus);
			assert.equal(response.headers.get("cache-control"), "no-store");
		}
	} finally {
		if (originalToken === undefined) delete process.env.CANVAS_SERVICE_TOKEN;
		else process.env.CANVAS_SERVICE_TOKEN = originalToken;
	}
});
