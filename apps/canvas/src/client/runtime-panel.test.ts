import assert from "node:assert/strict";
import test from "node:test";
import {
	buildCanvasGenerationInput,
	canvasGenerationCancelPayload,
	canvasGenerationSubmitPayload,
	generatedCanvasNode,
} from "./generation-ui-contract";
import {
	agentApplyResultMessage,
	agentPlanIntentFingerprint,
} from "./runtime-panel";

test("Agent plan intent changes when any server-bound planning field changes", () => {
	const intent = {
		intent: "更新画布文案",
		maxCostMicros: 1_000_000,
		maxGenerationCount: 1,
		projectId: "project-1",
	};
	const fingerprint = agentPlanIntentFingerprint(intent);
	for (const changed of [
		{ ...intent, projectId: "project-2" },
		{ ...intent, intent: "更新画布图片" },
		{ ...intent, maxCostMicros: 2_000_000 },
		{ ...intent, maxGenerationCount: 2 },
	]) {
		assert.notEqual(agentPlanIntentFingerprint(changed), fingerprint);
	}
});

test("Canvas UI sends the strict Core generation DTO and consumes its deliverable", () => {
	const input = buildCanvasGenerationInput({
		assets: [
			{ assetId: "asset-image-1", nodeType: "image" },
			{ assetId: "asset-video-1", nodeType: "video" },
			{ assetId: "asset-audio-1", nodeType: "audio" },
		],
		allowedParameters: ["durationSeconds"],
		maskAssetId: "asset-mask-1",
		operation: "video.generate",
		projectId: "project-1",
		prompt: "Create a campaign video",
		ratio: "9:16",
		revisionId: "revision-1",
	});

	assert.deepEqual(input, {
		inputAssets: [
			{ assetId: "asset-image-1", role: "reference_image" },
			{ assetId: "asset-video-1", role: "reference_video" },
			{ assetId: "asset-audio-1", role: "reference_audio" },
		],
		operation: "video.generate",
		parameters: {},
		projectId: "project-1",
		prompt: "Create a campaign video",
		revisionId: "revision-1",
	});
	assert.deepEqual(
		canvasGenerationSubmitPayload(input, { quoteId: "canvas-quote-1" }),
		{ input, quoteId: "canvas-quote-1" },
	);
	assert.deepEqual(canvasGenerationCancelPayload("project-1", "model-job-1"), {
		jobId: "model-job-1",
		projectId: "project-1",
	});
	assert.deepEqual(
		generatedCanvasNode({
			deliverable: { kind: "text", text: "A concise campaign direction." },
			jobId: "model-job-1",
			modelId: "llm-openai",
			operation: "text.respond",
			projectId: "project-1",
			revisionId: "revision-1",
			status: "completed",
		}),
		{
			data: { jobId: "model-job-1", text: "A concise campaign direction." },
			type: "text",
		},
	);
});

test("Canvas UI assigns image edit masks as an independent role", () => {
	assert.deepEqual(
		buildCanvasGenerationInput({
			assets: [
				{ assetId: "asset-image-1", nodeType: "image" },
				{ assetId: "asset-video-1", nodeType: "video" },
			],
			allowedParameters: ["width", "height"],
			maskAssetId: "asset-mask-1",
			operation: "image.edit",
			projectId: "project-1",
			prompt: "Retouch this image",
			ratio: "1:1",
			revisionId: "revision-1",
		}),
		{
			inputAssets: [
				{ assetId: "asset-image-1", role: "reference_image" },
				{ assetId: "asset-mask-1", role: "mask" },
			],
			operation: "image.edit",
			parameters: { height: 1024, width: 1024 },
			projectId: "project-1",
			prompt: "Retouch this image",
			revisionId: "revision-1",
		},
	);
});

test("Agent apply reports executed, changed, and error as distinct outcomes", () => {
	assert.equal(
		agentApplyResultMessage({ status: "executed" }),
		"Agent 已执行；画布内容未发生变更。",
	);
	assert.equal(
		agentApplyResultMessage({ status: "changed" }),
		"Agent 已应用变更并更新画布 revision。",
	);
	assert.equal(
		agentApplyResultMessage({ status: "error" }),
		"Agent 操作未应用，请检查后重试。",
	);
});
