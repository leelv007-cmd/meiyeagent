import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasCaller } from "./project-persistence";
import { cropOwnedImageAsset } from "./retouch-adapter.js";

test("crop reads the source through BackendPort and persists an owned child with lineage", async () => {
	const requests: Array<{ init?: RequestInit; url: string }> = [];
	const calls: Array<{ action: string; input?: Record<string, unknown> }> = [];
	let cropInput:
		| {
				crop?: { height: number; width: number; x: number; y: number };
				dataUrl: string;
		  }
		| undefined;
	const crop = { height: 0.5, width: 0.5, x: 0.25, y: 0.25 };
	const result = await cropOwnedImageAsset(
		(async (action, input) => {
			calls.push({ action, input });
			return { contentType: "image/png", id: "asset-derived" };
		}) as CanvasCaller,
		{
			crop,
			cropper: async (dataUrl, receivedCrop) => {
				cropInput = { crop: receivedCrop, dataUrl };
				return "data:image/png;base64,Y3JvcHBlZA==";
			},
			fetcher: async (input, init) => {
				requests.push({ init, url: String(input) });
				return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]), {
					headers: { "content-type": "image/jpeg" },
				});
			},
			nextEdgeId: () => "edge-source-derived",
			nextNodeId: () => "image-derived",
			sourceNode: {
				data: { assetId: "asset-source" },
				height: 160,
				id: "image-source",
				type: "image",
				width: 200,
				x: 20,
				y: 30,
			},
		},
	);

	assert.equal(
		requests[0]?.url,
		"/api/canvas/getAssetDelivery?assetId=asset-source",
	);
	assert.equal(requests[0]?.init?.credentials, "same-origin");
	assert.equal(requests[0]?.init?.cache, "no-store");
	assert.equal(cropInput?.crop, crop);
	assert.equal(cropInput?.dataUrl, "data:image/jpeg;base64,/9j/AA==");
	assert.deepEqual(calls, [
		{
			action: "persistLocalCanvasArtifact",
			input: {
				bytesBase64: "Y3JvcHBlZA==",
				contentType: "image/png",
				derivation: "crop",
				fileName: "asset-source-crop.png",
				parentAssetId: "asset-source",
			},
		},
	]);
	assert.equal(result.asset.id, "asset-derived");
	assert.deepEqual(result.node, {
		data: {
			assetId: "asset-derived",
			height: 160,
			width: 200,
			x: 268,
			y: 30,
		},
		height: 160,
		id: "image-derived",
		type: "image",
		width: 200,
		x: 268,
		y: 30,
	});
	assert.deepEqual(result.edge, {
		id: "edge-source-derived",
		source: "image-source",
		target: "image-derived",
		type: "derive",
	});
});

test("crop rejects an empty source asset before delivery, crop, or persistence", async () => {
	let sideEffects = 0;
	await assert.rejects(
		cropOwnedImageAsset(
			(async () => {
				sideEffects += 1;
				return {};
			}) as CanvasCaller,
			{
				cropper: async () => {
					sideEffects += 1;
					return "data:image/png;base64,eA==";
				},
				fetcher: async () => {
					sideEffects += 1;
					return new Response();
				},
				sourceNode: {
					data: { assetId: "  " },
					height: 160,
					id: "image-source",
					type: "image",
					width: 200,
					x: 20,
					y: 30,
				},
			},
		),
		/SOURCE_ASSET_REQUIRED/,
	);
	assert.equal(sideEffects, 0);
});
