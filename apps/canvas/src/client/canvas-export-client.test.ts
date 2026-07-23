import assert from "node:assert/strict";
import test from "node:test";
import { CanvasBackendError } from "./backend-client.js";
import {
	buildCanvasExportRequest,
	parseCanvasExportHeaders,
	requestCanvasExport,
	resolveCanvasExportIntent,
} from "./canvas-export-client.js";

test("export request always targets a frozen revision and opts into available-only explicitly", () => {
	assert.deepEqual(
		buildCanvasExportRequest({
			projectId: "project-1",
			revisionId: "revision-1",
		}),
		{
			format: "zip",
			projectId: "project-1",
			revisionId: "revision-1",
		},
	);
	assert.deepEqual(
		buildCanvasExportRequest({
			includeAvailableOnly: true,
			projectId: "project-1",
			revisionId: "revision-1",
		}),
		{
			format: "zip",
			includeAvailableOnly: true,
			projectId: "project-1",
			revisionId: "revision-1",
		},
	);
});

test("binary export preserves download and manifest receipt headers", async () => {
	let receivedBody = "";
	let receivedIdempotencyKey = "";
	const result = await requestCanvasExport(
		{
			idempotencyKey: "export-intent-1",
			projectId: "project-1",
			revisionId: "revision-1",
		},
		{
			fetcher: async (_url, init) => {
				receivedBody = String(init?.body);
				receivedIdempotencyKey =
					new Headers(init?.headers).get("idempotency-key") ?? "";
				return new Response(new Uint8Array([0x50, 0x4b, 0x03, 0x04]), {
					headers: {
						"content-disposition": 'attachment; filename="summer-campaign.zip"',
						"content-type": "application/zip",
						"x-canvas-export-manifest-sha256": "manifest-hash",
						"x-canvas-export-zip-sha256": "zip-hash",
					},
					status: 200,
				});
			},
		},
	);

	assert.deepEqual(JSON.parse(receivedBody), {
		format: "zip",
		projectId: "project-1",
		revisionId: "revision-1",
	});
	assert.equal(receivedIdempotencyKey, "export-intent-1");
	assert.equal(result.fileName, "canvas-export.zip");
	assert.equal(result.manifestSha256, "manifest-hash");
	assert.equal(result.zipSha256, "zip-hash");
	assert.equal(result.blob.size, 4);
});

test("export failure consumes generic unavailability rather than treating an error as ZIP", async () => {
	await assert.rejects(
		requestCanvasExport(
			{
				idempotencyKey: "export-intent-1",
				projectId: "project-1",
				revisionId: "revision-1",
			},
			{
				fetcher: async () =>
					new Response(
						JSON.stringify({
							error: {
								code: "EXPORT_NOT_AVAILABLE",
								message: "Canvas export is not currently available.",
							},
						}),
						{ headers: { "content-type": "application/json" }, status: 503 },
					),
			},
		),
		(error: unknown) =>
			error instanceof CanvasBackendError &&
			error.code === "EXPORT_NOT_AVAILABLE" &&
			error.status === 503 &&
			error.message === "Canvas export is not currently available.",
	);
});

test("the dialog export intent reuses its key only for a retry of the same frozen revision", () => {
	const initial = resolveCanvasExportIntent(
		null,
		{ projectId: "project-1", revisionId: "revision-1" },
		() => "export-intent-1",
	);
	const retry = resolveCanvasExportIntent(
		initial,
		{ projectId: "project-1", revisionId: "revision-1" },
		() => "export-intent-2",
	);
	assert.equal(retry.idempotencyKey, "export-intent-1");
	assert.equal(retry, initial);

	const changedRevision = resolveCanvasExportIntent(
		retry,
		{ projectId: "project-1", revisionId: "revision-2" },
		() => "export-intent-2",
	);
	assert.equal(changedRevision.idempotencyKey, "export-intent-2");
});

test("download feedback keeps a safe generic filename even when the service header has identifiers", () => {
	assert.deepEqual(
		parseCanvasExportHeaders(
			new Headers({
				"content-disposition":
					'attachment; filename="canvas-project-internal-revision-internal.zip"',
			}),
		),
		{
			fileName: "canvas-export.zip",
			manifestSha256: null,
			zipSha256: null,
		},
	);
});
