import assert from "node:assert/strict";
import test from "node:test";
import { handleProStudioPurchaseRequest } from "./pro-studio-purchase-handler";

const body = {
	offerId: "pro-studio-v1",
	paymentEventId: "payment-1",
	userId: "owner-1",
	workspaceId: "workspace-1",
};

test("internal purchase endpoint requires the service token and strict server facts", async () => {
	const original = process.env.CANVAS_SERVICE_TOKEN;
	process.env.CANVAS_SERVICE_TOKEN = "service-token";
	try {
		const runtime = async () => ({
			purchases: {
				async activate() {
					throw new Error("must not activate");
				},
			},
		});
		const unauthorized = await handleProStudioPurchaseRequest(
			new Request("http://canvas.test/api/internal/pro-studio-purchases", {
				body: JSON.stringify(body),
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
			runtime,
		);
		assert.equal(unauthorized.status, 401);

		const invalid = await handleProStudioPurchaseRequest(
			new Request("http://canvas.test/api/internal/pro-studio-purchases", {
				body: JSON.stringify({ ...body, priceId: "browser-fact" }),
				headers: {
					"content-type": "application/json",
					"x-canvas-service-token": "service-token",
				},
				method: "POST",
			}),
			runtime,
		);
		assert.equal(invalid.status, 400);
	} finally {
		if (original === undefined) delete process.env.CANVAS_SERVICE_TOKEN;
		else process.env.CANVAS_SERVICE_TOKEN = original;
	}
});

test("internal purchase endpoint idempotently activates the trusted claim", async () => {
	const original = process.env.CANVAS_SERVICE_TOKEN;
	process.env.CANVAS_SERVICE_TOKEN = "service-token";
	let received: unknown;
	try {
		const response = await handleProStudioPurchaseRequest(
			new Request("http://canvas.test/api/internal/pro-studio-purchases", {
				body: JSON.stringify(body),
				headers: {
					"content-type": "application/json",
					"x-canvas-service-token": "service-token",
				},
				method: "POST",
			}),
			async () => ({
				purchases: {
					async activate(input) {
						received = input;
						return {
							activatedAt: "2026-07-16T00:00:00.000Z",
							offerId: "pro-studio-v1",
							status: "active" as const,
						};
					},
				},
			}),
		);
		assert.equal(response.status, 200);
		assert.deepEqual(received, body);
		assert.deepEqual(await response.json(), {
			activatedAt: "2026-07-16T00:00:00.000Z",
			offerId: "pro-studio-v1",
			status: "active",
		});
	} finally {
		if (original === undefined) delete process.env.CANVAS_SERVICE_TOKEN;
		else process.env.CANVAS_SERVICE_TOKEN = original;
	}
});
