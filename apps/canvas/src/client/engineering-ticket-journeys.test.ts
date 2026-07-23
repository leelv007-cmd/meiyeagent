/**
 * Canvas client journeys for tickets 08 / 10 / 16.
 */
import assert from "node:assert/strict";
import test from "node:test";
import { CANVAS_PROMPT_SEEDS } from "../shared/prompt-seeds.js";
import { assetDeliveryUrl } from "./backend-client.js";
import {
	buildCanvasGenerationInput,
	generatedCanvasNode,
} from "./generation-ui-contract.js";
import { applyCanvasPromptSeed } from "./prompt-seed-actions.js";

test("ticket 07: image ratio is translated to the active Core width/height capability", () => {
	const input = buildCanvasGenerationInput({
		assets: [],
		allowedInputAssetRoles: ["reference_image"],
		allowedParameters: ["width", "height"],
		maskAssetId: "",
		maskNodeId: "",
		operation: "image.generate",
		projectId: "project-1",
		prompt: "门店主视觉",
		ratio: "16:10",
		revisionId: "revision-1",
	});
	assert.deepEqual(input.parameters, { height: 640, width: 1024 });
});

test("ticket 08: reverse-prompt UI sends text.respond with reference image only", () => {
	const input = buildCanvasGenerationInput({
		assets: [
			{ assetId: "asset-image-1", nodeId: "image-1", nodeType: "image" },
			{ assetId: "asset-video-1", nodeId: "video-1", nodeType: "video" },
		],
		allowedInputAssetRoles: ["reference_image"],
		allowedParameters: ["maxOutputTokens", "temperature"],
		maskAssetId: "",
		maskNodeId: "",
		operation: "text.respond",
		projectId: "project-1",
		prompt: "根据图片反推可复用提示词",
		ratio: "3:4",
		revisionId: "revision-1",
	});
	assert.deepEqual(input, {
		inputAssets: [{ assetId: "asset-image-1", role: "reference_image" }],
		inputNodeBindings: [
			{
				assetId: "asset-image-1",
				nodeId: "image-1",
				role: "reference_image",
			},
		],
		operation: "text.respond",
		parameters: { maxOutputTokens: 1200, temperature: 0.4 },
		projectId: "project-1",
		prompt: "根据图片反推可复用提示词",
		revisionId: "revision-1",
	});
	const node = generatedCanvasNode({
		deliverable: {
			kind: "text",
			text: "奶油白猫眼，柔和窗光，浅景深",
		},
		jobId: "job-text-1",
		modelId: "llm-1",
		operation: "text.respond",
		projectId: "project-1",
		revisionId: "revision-1",
		status: "completed",
	});
	assert.deepEqual(node, {
		data: {
			jobId: "job-text-1",
			text: "奶油白猫眼，柔和窗光，浅景深",
		},
		type: "text",
	});
});

test("ticket 10: video UI keeps capability parameters and produces a video node", () => {
	const input = buildCanvasGenerationInput({
		assets: [
			{ assetId: "asset-image-1", nodeId: "image-1", nodeType: "image" },
			{ assetId: "asset-video-1", nodeId: "video-1", nodeType: "video" },
			{ assetId: "asset-audio-1", nodeId: "audio-1", nodeType: "audio" },
		],
		allowedInputAssetRoles: ["reference_image", "reference_video"],
		allowedParameters: ["durationSeconds"],
		maskAssetId: "",
		maskNodeId: "",
		operation: "video.generate",
		projectId: "project-1",
		prompt: "门店慢推镜头",
		ratio: "9:16",
		revisionId: "revision-1",
	});
	assert.equal(input.operation, "video.generate");
	assert.deepEqual(input.parameters, {});
	assert.deepEqual(input.inputAssets, [
		{ assetId: "asset-image-1", role: "reference_image" },
		{ assetId: "asset-video-1", role: "reference_video" },
	]);
	const node = generatedCanvasNode({
		deliverable: {
			kind: "asset",
			asset: { contentType: "video/mp4", id: "owned-video-1" },
		},
		jobId: "job-video-1",
		modelId: "video-1",
		operation: "video.generate",
		projectId: "project-1",
		revisionId: "revision-1",
		status: "completed",
	});
	assert.deepEqual(node, {
		data: { assetId: "owned-video-1", jobId: "job-video-1" },
		type: "video",
	});
});

test("ticket 11/12: audio download requests server-controlled attachment delivery", () => {
	assert.equal(
		assetDeliveryUrl("audio-asset-1", { download: true }),
		"/api/canvas/getAssetDelivery?assetId=audio-asset-1&download=1",
	);
});

test("ticket 16: selecting a seed fills prompt and operation without remote CRUD", () => {
	assert.equal(CANVAS_PROMPT_SEEDS.length, 40);
	const seed = CANVAS_PROMPT_SEEDS.find((item) => item.id === "A1");
	assert.ok(seed);
	const applied = applyCanvasPromptSeed(seed);
	assert.equal(applied.operation, "image.generate");
	assert.equal(applied.prompt, seed.prompt);
	assert.equal(applied.seedId, "A1");
	assert.match(applied.prompt, /./u);
	// Scope lock: static module only — no remote inventory fields.
	assert.equal("remoteId" in seed, false);
	assert.equal("communityId" in seed, false);
});
