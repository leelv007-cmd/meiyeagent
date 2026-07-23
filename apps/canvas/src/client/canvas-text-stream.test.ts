import assert from "node:assert/strict";
import test from "node:test";
import { CanvasBackendError } from "./backend-client.js";
import { streamCanvasTextGeneration } from "./canvas-text-stream.js";

test("Canvas text stream adapter sends one authenticated SSE request and resumes by Last-Event-ID", async (t) => {
	const originalFetch = globalThis.fetch;
	const originalDocument = Object.getOwnPropertyDescriptor(
		globalThis,
		"document",
	);
	const requests: Array<{ headers: Headers; method?: string; url: string }> =
		[];
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: { cookie: "__Host-canvas-csrf=csrf-token" },
	});
	globalThis.fetch = (async (input, init) => {
		requests.push({
			headers: new Headers(init?.headers),
			method: init?.method,
			url: String(input),
		});
		return new Response(
			new ReadableStream({
				start(controller) {
					controller.enqueue(
						new TextEncoder().encode(
							'id: 8\nevent: canvas.text.delta\ndata: {"jobId":"job-1","sequence":8,"delta":"真实"}\n\nid: 9\nevent: canvas.text.terminal\ndata: {"jobId":"job-1","sequence":9,"status":"completed"}\n\n',
						),
					);
					controller.close();
				},
			}),
			{
				headers: {
					"content-type": "text/event-stream; charset=utf-8",
				},
			},
		);
	}) as typeof fetch;
	t.after(() => {
		globalThis.fetch = originalFetch;
		if (originalDocument)
			Object.defineProperty(globalThis, "document", originalDocument);
		else Reflect.deleteProperty(globalThis, "document");
	});

	const events: Array<{ cursor?: string; type: string; sequence: number }> = [];
	const result = await streamCanvasTextGeneration(
		{ jobId: "job-1", lastEventId: "7", projectId: "project-1" },
		{
			onEvent(event) {
				events.push({
					...(event.cursor ? { cursor: event.cursor } : {}),
					sequence: event.sequence,
					type: event.type,
				});
			},
		},
	);

	assert.equal(requests.length, 1);
	assert.deepEqual(requests[0], {
		headers: new Headers({
			"content-type": "application/json",
			"last-event-id": "7",
			"x-csrf-token": "csrf-token",
		}),
		method: "POST",
		url: "/api/canvas/streamTextGeneration",
	});
	assert.equal(requests[0]?.headers.get("x-service-token"), null);
	assert.deepEqual(events, [
		{ cursor: "8", sequence: 8, type: "delta" },
		{ cursor: "9", sequence: 9, type: "terminal" },
	]);
	assert.equal(result.lastEventId, "9");
});

test("Canvas text stream adapter exposes server SSE errors without retrying", async (t) => {
	const originalFetch = globalThis.fetch;
	const originalDocument = Object.getOwnPropertyDescriptor(
		globalThis,
		"document",
	);
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: { cookie: "__Host-canvas-csrf=csrf-token" },
	});
	globalThis.fetch = (async () =>
		new Response(
			'event: canvas.text.error\ndata: {"code":"CANVAS_TEXT_STREAM_UNAVAILABLE","message":"Native stream unavailable."}\n\n',
			{ headers: { "content-type": "text/event-stream" } },
		)) as typeof fetch;
	t.after(() => {
		globalThis.fetch = originalFetch;
		if (originalDocument)
			Object.defineProperty(globalThis, "document", originalDocument);
		else Reflect.deleteProperty(globalThis, "document");
	});

	await assert.rejects(
		streamCanvasTextGeneration(
			{ jobId: "job-1", projectId: "project-1" },
			{ onEvent() {} },
		),
		(error: unknown) =>
			error instanceof CanvasBackendError &&
			error.code === "CANVAS_TEXT_STREAM_UNAVAILABLE",
	);
});

test("Canvas text stream adapter exposes a durable recoverable cursor without retrying", async (t) => {
	const originalFetch = globalThis.fetch;
	const originalDocument = Object.getOwnPropertyDescriptor(
		globalThis,
		"document",
	);
	let requests = 0;
	Object.defineProperty(globalThis, "document", {
		configurable: true,
		value: { cookie: "__Host-canvas-csrf=csrf-token" },
	});
	globalThis.fetch = (async () => {
		requests += 1;
		return new Response(
			'id: 10\nevent: canvas.text.recoverable\ndata: {"code":"CANVAS_TEXT_PRODUCER_INTERRUPTED","jobId":"job-1","message":"Reconnect with Last-Event-ID.","retryable":true,"sequence":10}\n\n',
			{ headers: { "content-type": "text/event-stream" } },
		);
	}) as typeof fetch;
	t.after(() => {
		globalThis.fetch = originalFetch;
		if (originalDocument)
			Object.defineProperty(globalThis, "document", originalDocument);
		else Reflect.deleteProperty(globalThis, "document");
	});

	const events: Array<{ sequence: number; type: string }> = [];
	await assert.rejects(
		streamCanvasTextGeneration(
			{ jobId: "job-1", projectId: "project-1" },
			{
				onEvent(event) {
					events.push({ sequence: event.sequence, type: event.type });
				},
			},
		),
		(error: unknown) =>
			error instanceof CanvasBackendError &&
			error.code === "CANVAS_TEXT_PRODUCER_INTERRUPTED",
	);
	assert.equal(requests, 1);
	assert.deepEqual(events, [{ sequence: 10, type: "recoverable" }]);
});
