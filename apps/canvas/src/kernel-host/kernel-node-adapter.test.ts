import assert from "node:assert/strict";
import test from "node:test";
import { createKernelNode, toVozebNode } from "./kernel-node-adapter.js";

test("K2 maps all five kernel node types to approved defaults and user-safe state", () => {
	const makeNode = (type: string, data: Record<string, unknown> = {}) =>
		toVozebNode(
			{
				data,
				height: 0,
				id: `${type}-1`,
				type,
				width: 0,
				x: 24,
				y: 48,
			},
			(assetId) => `/api/canvas/getAssetDelivery?assetId=${assetId}`,
		);

	assert.deepEqual(
		["image", "text", "config", "video", "audio"].map((type) => {
			const node = makeNode(type);
			return [node.type, node.width, node.height, node.title];
		}),
		[
			["image", 340, 240, "图片"],
			["text", 340, 240, "文字"],
			["config", 340, 240, "生成配置"],
			["video", 420, 236, "视频"],
			["audio", 340, 120, "音频"],
		],
	);

	const media = makeNode("image", {
		assetId: "owned-asset-1",
		bytes: 2048,
		mimeType: "image/png",
		status: "completed",
	});
	assert.equal(
		media.metadata?.content,
		"/api/canvas/getAssetDelivery?assetId=owned-asset-1",
	);
	assert.equal(media.metadata?.status, "success");
	assert.equal(media.metadata?.bytes, 2048);
	assert.equal(media.metadata?.mimeType, "image/png");
	assert.doesNotMatch(JSON.stringify(media), /workspaceId|jobId|seedId/u);
});

test("K2 creates every toolbar node at approved size without provider state", () => {
	assert.deepEqual(
		["image", "text", "config", "video", "audio"].map((type) => {
			const node = createKernelNode(type, { x: 120, y: 80 }, `${type}-new`);
			return [node.type, node.width, node.height, node.x, node.y, node.data];
		}),
		[
			["image", 340, 240, 120, 80, {}],
			["text", 340, 240, 120, 80, { text: "" }],
			["config", 340, 240, 120, 80, {}],
			["video", 420, 236, 120, 80, {}],
			["audio", 340, 120, 120, 80, {}],
		],
	);
});
