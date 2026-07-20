import assert from "node:assert/strict";
import test from "node:test";
import {
	buildSubmitPayload,
	honestAvailability,
	isCatalogOperationActive,
	mapJobToNodeData,
} from "./generation-adapter.js";

test("buildSubmitPayload maps kernel selection to BackendPort input shape", () => {
	const payload = buildSubmitPayload({
		assetIds: ["a1", "a2"],
		maskAssetId: "mask-1",
		operation: "image.edit",
		projectId: "proj-1",
		prompt: "retouch skin",
		revisionId: "rev-1",
	});
	assert.deepEqual(payload, {
		inputAssets: [
			{ assetId: "a1", role: "reference_image" },
			{ assetId: "a2", role: "reference_image" },
			{ assetId: "mask-1", role: "mask" },
		],
		operation: "image.edit",
		parameters: {},
		projectId: "proj-1",
		prompt: "retouch skin",
		revisionId: "rev-1",
	});
});

test("buildSubmitPayload picks media roles from operation prefix", () => {
	const video = buildSubmitPayload({
		assetIds: ["v1"],
		operation: "video.generate",
		projectId: "p",
		prompt: "clip",
		revisionId: "r",
	});
	assert.equal(video.inputAssets[0]?.role, "reference_video");

	const audio = buildSubmitPayload({
		assetIds: ["s1"],
		operation: "audio.speech",
		projectId: "p",
		prompt: "hello",
		revisionId: "r",
	});
	assert.equal(audio.inputAssets[0]?.role, "reference_audio");
});

test("mapJobToNodeData projects asset, text, and pending jobs", () => {
	assert.deepEqual(
		mapJobToNodeData({
			deliverable: { asset: { id: "asset-1" }, kind: "asset" },
			jobId: "job-1",
			status: "completed",
		}),
		{ assetId: "asset-1", jobId: "job-1", status: "completed" },
	);
	assert.deepEqual(
		mapJobToNodeData({
			deliverable: { kind: "text", text: "copy" },
			jobId: "job-2",
			status: "completed",
		}),
		{ jobId: "job-2", status: "completed", text: "copy" },
	);
	assert.deepEqual(
		mapJobToNodeData({ jobId: "job-3", status: "running" }),
		{ jobId: "job-3", status: "running" },
	);
});

test("isCatalogOperationActive requires active/modelId", () => {
	assert.equal(isCatalogOperationActive(undefined), false);
	assert.equal(
		isCatalogOperationActive({
			activation: "inactive",
			modelId: "m1",
			operation: "audio.sfx",
		}),
		false,
	);
	assert.equal(
		isCatalogOperationActive({
			activation: "active",
			modelId: null,
			operation: "image.generate",
		}),
		false,
	);
	assert.equal(
		isCatalogOperationActive({
			activation: "active",
			modelId: "seedream",
			operation: "image.generate",
		}),
		true,
	);
	assert.equal(
		isCatalogOperationActive({
			active: true,
			modelId: "m",
			operation: "text.respond",
		}),
		true,
	);
	assert.equal(
		isCatalogOperationActive({ active: false, modelId: "m", operation: "x" }),
		false,
	);
});

test("honestAvailability reports unavailable reasons without fake active UX", () => {
	const catalog = [
		{
			activation: "inactive" as const,
			modelId: null,
			operation: "audio.sfx",
			unavailableReason: "SFX 供应商未激活",
		},
		{
			activation: "active" as const,
			modelId: "seedream",
			operation: "image.generate",
		},
	];
	assert.deepEqual(honestAvailability("audio.sfx", catalog), {
		available: false,
		reason: "SFX 供应商未激活",
	});
	assert.deepEqual(honestAvailability("image.generate", catalog), {
		available: true,
	});
	assert.deepEqual(honestAvailability("video.generate", catalog), {
		available: false,
		reason: "目录未声明该能力",
	});
});
