import assert from "node:assert/strict";
import test from "node:test";
import { GET } from "../../app/api/internal/health/route";

test("private health route requires the Canvas service token and returns minimal status", async () => {
	const originalToken = process.env.CANVAS_SERVICE_TOKEN;
	process.env.CANVAS_SERVICE_TOKEN = "test-canvas-service-token";

	try {
		for (const headers of [
			undefined,
			{ "x-canvas-service-token": "wrong-service-token" },
		]) {
			const response = await GET(
				new Request("http://canvas.test/api/internal/health", { headers }),
			);
			assert.equal(response.status, 401);
			assert.equal(response.headers.get("cache-control"), "no-store");
			assert.deepEqual(await response.json(), { error: "Unauthorized" });
		}

		const response = await GET(
			new Request("http://canvas.test/api/internal/health", {
				headers: {
					"x-canvas-service-token": "test-canvas-service-token",
				},
			}),
		);

		assert.equal(response.status, 200);
		assert.equal(response.headers.get("cache-control"), "no-store");
		assert.deepEqual(await response.json(), {
			service: "meiye-canvas",
			status: "ok",
		});
	} finally {
		if (originalToken === undefined) delete process.env.CANVAS_SERVICE_TOKEN;
		else process.env.CANVAS_SERVICE_TOKEN = originalToken;
	}
});
