import assert from "node:assert/strict";
import test from "node:test";
import { resolveUpscaleSize } from "../vendor/vozeb/app/(user)/canvas/utils/canvas-image-data.js";
import type { CanvasCaller } from "./project-persistence";
import {
	cropOwnedImageAsset,
	layoutSplitChildren,
	normalizeSplitParams,
	normalizeUpscaleParams,
	splitOwnedImageAsset,
	upscaleOwnedImageAsset,
} from "./retouch-adapter.js";

const sourceNode = {
	data: { assetId: "asset-source" },
	height: 160,
	id: "image-source",
	type: "image" as const,
	width: 200,
	x: 20,
	y: 30,
};

function jpegFetcher() {
	return async (input: RequestInfo | URL, init?: RequestInit) => {
		assert.equal(
			String(input),
			"/api/canvas/getAssetDelivery?assetId=asset-source",
		);
		assert.equal(init?.credentials, "same-origin");
		assert.equal(init?.cache, "no-store");
		return new Response(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]), {
			headers: { "content-type": "image/jpeg" },
		});
	};
}

test("crop reads the source through BackendPort and persists an owned child with lineage", async () => {
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
			fetcher: jpegFetcher(),
			nextEdgeId: () => "edge-source-derived",
			nextNodeId: () => "image-derived",
			sourceNode,
		},
	);

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
					...sourceNode,
					data: { assetId: "  " },
				},
			},
		),
		/SOURCE_ASSET_REQUIRED/,
	);
	assert.equal(sideEffects, 0);
});

test("normalizeUpscaleParams clamps long-edge and defaults algorithm", () => {
	assert.deepEqual(normalizeUpscaleParams(), {
		algorithm: "high",
		targetLongEdge: 2048,
	});
	assert.deepEqual(normalizeUpscaleParams({ targetLongEdge: 99999 }), {
		algorithm: "high",
		targetLongEdge: 4096,
	});
	assert.deepEqual(
		normalizeUpscaleParams({ algorithm: "nearest", targetLongEdge: 1024 }),
		{ algorithm: "nearest", targetLongEdge: 1024 },
	);
});

test("resolveUpscaleSize is pure and preserves aspect for 1K/2K/4K targets", () => {
	assert.deepEqual(resolveUpscaleSize(800, 600, 1024), {
		width: 1024,
		height: 768,
	});
	assert.deepEqual(resolveUpscaleSize(1000, 500, 2048), {
		width: 2048,
		height: 1024,
	});
	assert.deepEqual(resolveUpscaleSize(2000, 1000, 4096), {
		width: 4096,
		height: 2048,
	});
	assert.deepEqual(resolveUpscaleSize(5000, 2500, 4096), {
		width: 4096,
		height: 2048,
	});
});

test("upscale persists an owned child with upscale derivation and lineage edge", async () => {
	const calls: Array<{ action: string; input?: Record<string, unknown> }> = [];
	let upscaleInput:
		| { dataUrl: string; params: { algorithm: string; targetLongEdge: number } }
		| undefined;
	const result = await upscaleOwnedImageAsset(
		(async (action, input) => {
			calls.push({ action, input });
			return { contentType: "image/png", id: "asset-upscaled" };
		}) as CanvasCaller,
		{
			fetcher: jpegFetcher(),
			nextEdgeId: () => "edge-upscale",
			nextNodeId: () => "image-upscaled",
			params: { algorithm: "bilinear", targetLongEdge: 1024 },
			sourceNode,
			upscaler: async (dataUrl, params) => {
				upscaleInput = { dataUrl, params };
				return "data:image/png;base64,dXBzY2FsZWQ=";
			},
		},
	);

	assert.deepEqual(upscaleInput, {
		dataUrl: "data:image/jpeg;base64,/9j/AA==",
		params: { algorithm: "bilinear", targetLongEdge: 1024 },
	});
	assert.deepEqual(calls, [
		{
			action: "persistLocalCanvasArtifact",
			input: {
				bytesBase64: "dXBzY2FsZWQ=",
				contentType: "image/png",
				derivation: "upscale",
				fileName: "asset-source-upscale-1024.png",
				parentAssetId: "asset-source",
			},
		},
	]);
	assert.equal(result.asset.id, "asset-upscaled");
	assert.equal(result.node.id, "image-upscaled");
	assert.equal(result.node.data.assetId, "asset-upscaled");
	assert.deepEqual(result.edge, {
		id: "edge-upscale",
		source: "image-source",
		target: "image-upscaled",
		type: "derive",
	});
	assert.deepEqual(result.params, {
		algorithm: "bilinear",
		targetLongEdge: 1024,
	});
});

test("normalizeSplitParams clamps 1–12 axes", () => {
	assert.deepEqual(normalizeSplitParams(), { columns: 2, rows: 2 });
	assert.deepEqual(normalizeSplitParams({ columns: 0, rows: 99 }), {
		columns: 1,
		rows: 12,
	});
	assert.deepEqual(normalizeSplitParams({ columns: 3.7, rows: 1.2 }), {
		columns: 4,
		rows: 1,
	});
});

test("layoutSplitChildren places a right-side grid without mutating the source", () => {
	const layouts = layoutSplitChildren(
		{ height: 160, width: 200, x: 20, y: 30 },
		{ columns: 2, rows: 2 },
	);
	assert.equal(layouts.length, 4);
	assert.deepEqual(
		layouts.map((item) => ({
			column: item.column,
			row: item.row,
			x: item.x,
			y: item.y,
		})),
		[
			{ column: 0, row: 0, x: 268, y: 30 },
			{ column: 1, row: 0, x: 384, y: 30 },
			{ column: 0, row: 1, x: 268, y: 126 },
			{ column: 1, row: 1, x: 384, y: 126 },
		],
	);
});

test("split persists each piece as owned child with split derivation and derive edges", async () => {
	const calls: Array<{ action: string; input?: Record<string, unknown> }> = [];
	const result = await splitOwnedImageAsset(
		(async (action, input) => {
			calls.push({ action, input });
			const fileName =
				typeof input?.fileName === "string" ? input.fileName : "piece";
			return {
				contentType: "image/png",
				id: `asset-${fileName}`,
			};
		}) as CanvasCaller,
		{
			fetcher: jpegFetcher(),
			nextEdgeId: (index) => `edge-split-${index}`,
			nextNodeId: (index) => `image-split-${index}`,
			params: { columns: 2, rows: 1 },
			sourceNode,
			splitter: async () => [
				{ column: 0, dataUrl: "data:image/png;base64,cGllY2Uw", row: 0 },
				{ column: 1, dataUrl: "data:image/png;base64,cGllY2Ux", row: 0 },
			],
		},
	);

	assert.equal(result.pieces.length, 2);
	assert.deepEqual(
		calls.map((call) => call.input),
		[
			{
				bytesBase64: "cGllY2Uw",
				contentType: "image/png",
				derivation: "split",
				fileName: "asset-source-split-r0-c0.png",
				parentAssetId: "asset-source",
			},
			{
				bytesBase64: "cGllY2Ux",
				contentType: "image/png",
				derivation: "split",
				fileName: "asset-source-split-r0-c1.png",
				parentAssetId: "asset-source",
			},
		],
	);
	assert.deepEqual(
		result.pieces.map((piece) => ({
			edge: piece.edge,
			nodeId: piece.node.id,
			parent: piece.node.data.assetId,
			piece: piece.piece,
		})),
		[
			{
				edge: {
					id: "edge-split-0",
					source: "image-source",
					target: "image-split-0",
					type: "derive",
				},
				nodeId: "image-split-0",
				parent: "asset-asset-source-split-r0-c0.png",
				piece: { column: 0, row: 0 },
			},
			{
				edge: {
					id: "edge-split-1",
					source: "image-source",
					target: "image-split-1",
					type: "derive",
				},
				nodeId: "image-split-1",
				parent: "asset-asset-source-split-r0-c1.png",
				piece: { column: 1, row: 0 },
			},
		],
	);
	// Source coordinates unchanged — children only.
	assert.equal(sourceNode.x, 20);
	assert.equal(sourceNode.y, 30);
});

test("split rejects a 1x1 grid before delivery", async () => {
	let sideEffects = 0;
	await assert.rejects(
		splitOwnedImageAsset(
			(async () => {
				sideEffects += 1;
				return {};
			}) as CanvasCaller,
			{
				fetcher: async () => {
					sideEffects += 1;
					return new Response();
				},
				params: { columns: 1, rows: 1 },
				sourceNode,
				splitter: async () => {
					sideEffects += 1;
					return [];
				},
			},
		),
		/SPLIT_REQUIRES_MULTIPLE_PIECES/,
	);
	assert.equal(sideEffects, 0);
});
