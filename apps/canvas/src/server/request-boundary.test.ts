import assert from "node:assert/strict";
import test from "node:test";
import {
	CanvasRouteBoundaryError,
	readBoundedFormData,
	readBoundedJson,
} from "./request-boundary";

test("rejects oversized chunked internal JSON before buffering it all", async () => {
	const request = new Request("http://canvas.test/api/internal/test", {
		body: new ReadableStream({
			start(controller) {
				controller.enqueue(new Uint8Array(700_000));
				controller.enqueue(new Uint8Array(400_000));
				controller.close();
			},
		}),
		duplex: "half",
		headers: { "content-type": "application/json" },
		method: "POST",
	} as RequestInit & { duplex: "half" });

	await assert.rejects(
		readBoundedJson(request),
		(error: unknown) =>
			error instanceof CanvasRouteBoundaryError &&
			error.status === 413 &&
			error.code === "REQUEST_BODY_TOO_LARGE",
	);
});

test("rejects deeply nested internal JSON iteratively", async () => {
	const body = `${'{"child":'.repeat(100)}null${"}".repeat(100)}`;
	await assert.rejects(
		readBoundedJson(
			new Request("http://canvas.test/api/internal/test", {
				body,
				headers: { "content-type": "application/json" },
				method: "POST",
			}),
		),
		(error: unknown) =>
			error instanceof CanvasRouteBoundaryError &&
			error.status === 400 &&
			error.code === "JSON_TOO_COMPLEX",
	);
});

test("bounds launch exchange form bodies and requires a form content type", async () => {
	await assert.rejects(
		readBoundedFormData(
			new Request("http://canvas.test/exchange", {
				body: "code=value",
				headers: { "content-type": "text/plain" },
				method: "POST",
			}),
		),
		(error: unknown) =>
			error instanceof CanvasRouteBoundaryError && error.status === 415,
	);
	await assert.rejects(
		readBoundedFormData(
			new Request("http://canvas.test/exchange", {
				body: `code=${"x".repeat(70_000)}`,
				headers: {
					"content-type": "application/x-www-form-urlencoded",
				},
				method: "POST",
			}),
		),
		(error: unknown) =>
			error instanceof CanvasRouteBoundaryError && error.status === 413,
	);
});
