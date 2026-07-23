import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { CoreCanvasExportAssetClient } from "./core-canvas-export-asset-client";

const bytes = new TextEncoder().encode("authoritative asset bytes");
const sha256 = createHash("sha256").update(bytes).digest("hex");
const input = {
	assetId: "asset-1",
	userId: "user-1",
	workspaceId: "workspace/a",
};

test("uses the Core-owned export-asset query and accepts only a verified receipt", async () => {
	const requests: Array<{ init?: RequestInit; url: string }> = [];
	const client = new CoreCanvasExportAssetClient({
		coreServiceToken: "service-secret",
		coreServiceUrl: "http://core.internal:4100/root/ignored",
		fetcher: async (url, init) => {
			requests.push({ init, url: String(url) });
			return jsonResponse(200, { data: availableAsset() });
		},
	});

	const result = await client.resolve(input);
	assert.equal(result.kind, "available");
	if (result.kind !== "available")
		throw new Error("Expected an available asset.");
	assert.deepEqual(result.asset.bytes, bytes);
	assert.equal(result.asset.receipt.id, "asset-1");
	assert.equal(
		requests[0]?.url,
		"http://core.internal:4100/v1/workspaces/workspace%2Fa/p1/query",
	);
	assert.deepEqual(JSON.parse(String(requests[0]?.init?.body)), {
		action: "canvas_export_asset",
		module: "operations",
		payload: { assetId: "asset-1" },
	});
	const headers = new Headers(requests[0]?.init?.headers);
	assert.equal(headers.get("x-user-id"), "user-1");
	assert.equal(headers.get("x-workspace-id"), "workspace/a");
});

test("fails closed for revoked, expired, private, and malformed Core export responses", async () => {
	for (const code of [
		"ASSET_REVOKED",
		"ASSET_EXPIRED",
		"ASSET_PRIVATE_RETRIEVAL_DENIED",
	] as const) {
		const client = new CoreCanvasExportAssetClient({
			coreServiceToken: "service-secret",
			coreServiceUrl: "http://core.internal:4100",
			fetcher: async () =>
				jsonResponse(200, { data: { code, kind: "unavailable" } }),
		});
		assert.deepEqual(await client.resolve(input), {
			code,
			kind: "unavailable",
		});
	}

	const malformed = new CoreCanvasExportAssetClient({
		coreServiceToken: "service-secret",
		coreServiceUrl: "http://core.internal:4100",
		fetcher: async () =>
			jsonResponse(200, {
				data: {
					...availableAsset(),
					asset: { ...availableAsset().asset, bytesBase64: "not base64" },
				},
			}),
	});
	assert.deepEqual(await malformed.resolve(input), {
		code: "ASSET_RECEIPT_INVALID",
		kind: "unavailable",
	});
});

function availableAsset() {
	return {
		asset: {
			bytesBase64: Buffer.from(bytes).toString("base64"),
			contentType: "image/png",
			fileName: "asset.png",
			id: "asset-1",
			receipt: { id: "asset-1", storageRevision: "v1" },
			sha256,
			sizeBytes: bytes.byteLength,
			workspaceId: "workspace/a",
		},
		kind: "available",
	};
}

function jsonResponse(status: number, body: unknown) {
	return new Response(JSON.stringify(body), {
		headers: { "content-type": "application/json" },
		status,
	});
}
