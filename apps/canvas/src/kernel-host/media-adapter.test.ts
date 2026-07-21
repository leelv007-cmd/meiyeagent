import assert from "node:assert/strict";
import test from "node:test";
import {
	buildImageNodeFromAsset,
	deliveryUrl,
	fileToBase64,
	persistBlobAsOwnedAsset,
} from "./media-adapter.js";

test("fileToBase64 encodes blob bytes", async () => {
	const blob = new Blob([Uint8Array.from([72, 105])], { type: "text/plain" });
	assert.equal(await fileToBase64(blob), btoa("Hi"));
});

test("persistBlobAsOwnedAsset posts bytesBase64 via callCanvas", async () => {
	let observed: { action: string; input?: Record<string, unknown> } | undefined;
	const asset = await persistBlobAsOwnedAsset(
		(async (action, input) => {
			observed = { action, input };
			return { contentType: "image/png", id: "asset-1", name: "a.png" };
		}) as import("./project-persistence").CanvasCaller,
		{
			bytesBase64: "aGVsbG8=",
			contentType: "image/png",
			derivation: "crop",
			fileName: "a.png",
		},
	);
	assert.equal(asset.id, "asset-1");
	assert.equal(observed?.action, "persistLocalCanvasArtifact");
	assert.deepEqual(observed?.input, {
		bytesBase64: "aGVsbG8=",
		contentType: "image/png",
		derivation: "crop",
		fileName: "a.png",
	});
});

test("persistBlobAsOwnedAsset defaults derivation to retouch", async () => {
	let derivation: unknown;
	await persistBlobAsOwnedAsset(
		(async (_action, input) => {
			derivation = input?.derivation;
			return { contentType: "image/jpeg", id: "asset-2" };
		}) as import("./project-persistence").CanvasCaller,
		{
			bytesBase64: "x",
			contentType: "image/jpeg",
			fileName: "b.jpg",
		},
	);
	assert.equal(derivation, "retouch");
});

test("buildImageNodeFromAsset embeds assetId and layout", () => {
	const node = buildImageNodeFromAsset("asset-9", {
		id: "image-fixed",
		x: 15,
		y: 25,
	});
	assert.equal(node.id, "image-fixed");
	assert.equal(node.type, "image");
	assert.equal(node.data.assetId, "asset-9");
	assert.equal(node.x, 15);
	assert.equal(node.y, 25);
	assert.equal(node.data.x, 15);
	assert.equal(node.data.y, 25);
});

test("deliveryUrl uses getAssetDelivery pattern", () => {
	assert.equal(
		deliveryUrl("asset/1"),
		"/api/canvas/getAssetDelivery?assetId=asset%2F1",
	);
	assert.equal(
		deliveryUrl("asset-1", { download: true }),
		"/api/canvas/getAssetDelivery?assetId=asset-1&download=1",
	);
});
