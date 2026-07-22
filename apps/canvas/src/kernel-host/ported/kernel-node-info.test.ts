import assert from "node:assert/strict";
import test from "node:test";
import {
	buildDesensitizedNodeInfo,
	desensitizeNodeJson,
	formatByteSize,
	NODE_INFO_REDACT_KEYS,
	nodeStatusLabel,
	nodeTypeLabel,
} from "./kernel-node-info.js";

test("buildDesensitizedNodeInfo exposes merchant fields without raw ids", () => {
	const info = buildDesensitizedNodeInfo({
		bytes: 2048,
		errorDetails: "生成失败，请重试",
		freeResize: true,
		height: 160.4,
		prompt: "会员日海报",
		status: "error",
		type: "image",
		width: 200.6,
		x: 12.2,
		y: 40.8,
	});

	assert.deepEqual(
		info.rows.map((row) => row.label),
		["类型", "尺寸", "位置", "状态", "比例", "提示词", "文件大小", "错误"],
	);
	assert.equal(info.rows[0]?.value, "图片");
	assert.equal(info.rows[1]?.value, "201 × 160");
	assert.equal(info.rows[3]?.value, "失败");
	assert.equal(info.rows[4]?.value, "自由比例");
	assert.doesNotMatch(info.json, /assetId|workspaceId|jobId|"id"/u);
	assert.match(info.json, /"type": "image"/u);
	assert.match(info.json, /会员日海报/u);
});

test("text nodes omit image-only ratio row", () => {
	const info = buildDesensitizedNodeInfo({
		height: 120,
		status: "idle",
		type: "text",
		width: 240,
		x: 0,
		y: 0,
	});
	assert.equal(
		info.rows.some((row) => row.label === "比例"),
		false,
	);
	assert.equal(info.rows.find((row) => row.label === "类型")?.value, "文本");
});

test("desensitizeNodeJson redacts delivery urls, base64, and sensitive keys", () => {
	const json = desensitizeNodeJson({
		assetId: "asset-secret",
		id: "node-secret",
		metadata: {
			content: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg",
			delivery: "/api/canvas/getAssetDelivery?assetId=asset-secret",
			prompt: "可见提示词",
			storageKey: "s3://bucket/key",
		},
		type: "image",
		workspaceId: "ws-secret",
	});

	assert.doesNotMatch(json, /asset-secret|node-secret|ws-secret|s3:\/\//u);
	assert.doesNotMatch(json, /data:image\/png/u);
	assert.match(json, /\[redacted\]/u);
	assert.match(json, /\[redacted delivery\]/u);
	assert.match(json, /可见提示词/u);
	for (const key of ["assetId", "id", "workspaceId"]) {
		assert.equal(NODE_INFO_REDACT_KEYS.has(key), true);
		assert.doesNotMatch(json, new RegExp(`"${key}"`, "u"));
	}
	// Media handles remain as keys but values are placeholders only.
	assert.match(json, /"content": "\[redacted\]"/u);
	assert.match(json, /"storageKey": "\[redacted\]"/u);
});

test("status and type labels stay Chinese for known enums", () => {
	assert.equal(nodeTypeLabel("video"), "视频");
	assert.equal(nodeStatusLabel("loading"), "生成中");
	assert.equal(nodeStatusLabel(undefined), "待命");
	assert.equal(formatByteSize(0), null);
	assert.equal(formatByteSize(1536), "1.5 KB");
});
