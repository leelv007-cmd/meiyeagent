import assert from "node:assert/strict";
import test from "node:test";
import { callCanvas } from "./backend-client.js";

test("reuses a caller-owned idempotency key when the same intent is retried", async () => {
	const originalFetch = globalThis.fetch;
	const originalDocument = globalThis.document;
	const observed: string[] = [];
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: { cookie: "__Host-canvas-csrf=csrf" },
	});
	globalThis.fetch = async (_input, init) => {
		observed.push(new Headers(init?.headers).get("idempotency-key") ?? "");
		return Response.json(
			{ error: { code: "UNKNOWN", message: "Retry safely" } },
			{ status: 503 },
		);
	};
	try {
		for (let attempt = 0; attempt < 2; attempt += 1) {
			await assert.rejects(
				callCanvas("submitGeneration", {}, { idempotencyKey: "intent-1" }),
			);
		}
		assert.deepEqual(observed, ["intent-1", "intent-1"]);
	} finally {
		globalThis.fetch = originalFetch;
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: originalDocument,
		});
	}
});

test("forwards a caller-owned abort signal to the Canvas request", async () => {
	const originalFetch = globalThis.fetch;
	const originalDocument = globalThis.document;
	const controller = new AbortController();
	let observedSignal: AbortSignal | undefined;
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: { cookie: "__Host-canvas-csrf=csrf" },
	});
	globalThis.fetch = async (_input, init) => {
		observedSignal = init?.signal ?? undefined;
		return Response.json({ data: { ok: true } });
	};
	try {
		await callCanvas("listProjects", {}, { signal: controller.signal });
		assert.equal(observedSignal, controller.signal);
	} finally {
		globalThis.fetch = originalFetch;
		Object.defineProperty(globalThis, "document", {
			configurable: true,
			value: originalDocument,
		});
	}
});
