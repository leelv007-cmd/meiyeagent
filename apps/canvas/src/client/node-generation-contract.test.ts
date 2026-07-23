import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasGenerationOperation } from "@meiye/core/pro-studio-runtime";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildCanvasGenerationInput } from "./generation-ui-contract.js";
import {
	activeCanvasGenerationModels,
	applyCanvasGenerationBatchJobUpdate,
	type CanvasGenerationBackendRequest,
	type CanvasGenerationCapability,
	cancelCanvasGeneration,
	canvasGenerationAvailability,
	canvasGenerationJobView,
	canvasNodeGenerationActions,
	createCanvasGenerationBatchSnapshot,
	invalidCanvasGenerationParameters,
	quoteCanvasGenerationBatch,
	reconcileCanvasGenerationBatchJobs,
	retryCanvasGeneration,
	selectCanvasGenerationBatchPrimary,
	submitCanvasGenerationBatch,
	visibleCanvasGenerationParameterControls,
} from "./node-generation-contract.js";
import { CanvasNodeGenerationWorkbench } from "./node-generation-workbench.js";
import {
	createResourceDraft,
	nodeMentionCandidates,
} from "./resource-workflow.js";

function capability(
	overrides: Partial<CanvasGenerationCapability> & {
		operation: CanvasGenerationOperation;
	},
): CanvasGenerationCapability {
	return {
		activation: "active",
		allowedInputAssetRoles: ["reference_image"],
		allowedParameters: ["ratio"],
		estimatedDurationSeconds: [5, 10],
		modelId: "internal-model-1",
		output: "image",
		usageAmount: 1,
		usageResource: "image",
		...overrides,
	};
}

test("model choices use only active current-operation models and fail closed for audio without live evidence", () => {
	const loading = canvasGenerationAvailability({
		catalog: null,
		operation: "image.generate",
	});
	assert.equal(loading.available, false);
	assert.match(loading.reason ?? "", /服务端能力目录/u);
	const catalog = {
		operations: [
			capability({
				modelId: "provider-image-internal-7",
				operation: "image.generate",
			}),
			capability({
				activation: "inactive",
				modelId: "inactive-image-model",
				operation: "image.generate",
				unavailableReason: "该模型正在维护",
			}),
			capability({
				allowedInputAssetRoles: ["reference_audio"],
				allowedParameters: ["durationSeconds", "format"],
				modelId: "audio-provider-internal-9",
				operation: "audio.sfx",
				output: "audio",
				usageResource: "audio",
			}),
		],
	};

	assert.deepEqual(activeCanvasGenerationModels(catalog, "image.generate"), [
		{ label: "可用模型 1", modelId: "provider-image-internal-7" },
	]);
	assert.deepEqual(activeCanvasGenerationModels(catalog, "audio.sfx"), []);
	const audio = canvasGenerationAvailability({
		catalog,
		operation: "audio.sfx",
	});
	assert.equal(audio.available, false);
	assert.match(audio.reason ?? "", /音频能力/u);
	assert.doesNotMatch(audio.reason ?? "", /audio-provider-internal/u);
});

test("parameter controls and Canvas DTO retain only strict allowed fields plus modelId", () => {
	const controls = visibleCanvasGenerationParameterControls({
		allowedParameters: ["ratio", "resolution", "quality", "width"],
		operation: "image.generate",
	});
	assert.deepEqual(
		controls.map((control) => control.name),
		["ratio", "quality", "width"],
	);
	assert.deepEqual(
		invalidCanvasGenerationParameters({
			allowedParameters: ["ratio", "quality"],
			operation: "image.generate",
			values: { quality: "ultra", ratio: "not-a-ratio" },
		}),
		["quality", "ratio"],
	);
	const input = buildCanvasGenerationInput({
		allowedInputAssetRoles: ["reference_image"],
		allowedParameters: ["height", "quality", "width"],
		assets: [
			{
				assetId: "asset-private-1",
				nodeId: "node-private-1",
				nodeType: "image",
			},
		],
		maskAssetId: "",
		maskNodeId: "",
		modelId: "provider-image-internal-7",
		operation: "image.generate",
		parameterValues: { quality: "high", ratio: "3:2" },
		projectId: "project-private-1",
		prompt: "生成商品主图",
		ratio: "1:1",
		revisionId: "revision-private-1",
	});
	assert.equal(input.modelId, "provider-image-internal-7");
	assert.deepEqual(input.parameters, {
		height: 683,
		quality: "high",
		width: 1024,
	});
});

test("node context actions and #167 mention candidates stay merchant-safe", () => {
	assert.deepEqual(
		Object.fromEntries(
			(["image", "text", "video", "audio", "config"] as const).map((kind) => [
				kind,
				canvasNodeGenerationActions(kind).length,
			]),
		),
		{ audio: 2, config: 6, image: 2, text: 2, video: 1 },
	);
	assert.deepEqual(
		canvasNodeGenerationActions("audio").map((action) => action.operation),
		["audio.speech", "audio.sfx"],
	);
	assert.equal(canvasNodeGenerationActions("config").length, 6);
	const candidates = nodeMentionCandidates({
		edges: [{ source: "node-private-17", target: "node-private-18" }],
		nodes: [
			{
				data: { assetId: "asset-private-17" },
				id: "node-private-17",
				type: "image",
			},
			{
				data: { assetId: "asset-private-18" },
				id: "node-private-18",
				type: "video",
			},
		],
		selectedNodeIds: ["node-private-17"],
	});
	assert.deepEqual(
		candidates.map((candidate) => ({
			label: candidate.label,
			mediaKind: candidate.mediaKind,
		})),
		[
			{ label: "已连接的图片节点 1", mediaKind: "image" },
			{ label: "已连接的视频节点 1", mediaKind: "video" },
		],
	);
	assert.doesNotMatch(
		JSON.stringify(candidates.map((candidate) => candidate.label)),
		/asset-private|node-private/u,
	);
});

test("batch wrapper quotes every item before explicit confirmation and leaves no batch endpoint surface", async () => {
	const calls: Array<{ action: string; input: Record<string, unknown> }> = [];
	const request: CanvasGenerationBackendRequest = async (action, input) => {
		calls.push({ action, input });
		if (action === "quoteGeneration") {
			return {
				estimatedProviderCost: {
					amountMicros: 10_000,
					currency: "CNY" as const,
					unit: "request",
				},
				quoteId: `quote-${String(input.itemId)}`,
			} as never;
		}
		if (action === "submitGeneration") {
			return {
				deliverable: null,
				jobId: `job-${calls.length}`,
				modelId: "internal-model",
				projectId: "project-1",
				revisionId: "revision-1",
				status: "queued",
			} as never;
		}
		throw new Error("unexpected action");
	};
	const quotes = await quoteCanvasGenerationBatch(request, {
		batchKey: "canvas-ui-test-1",
		count: 2,
		input: {
			inputAssets: [],
			inputNodeBindings: [],
			modelId: "internal-model",
			operation: "image.generate",
			parameters: { ratio: "1:1" },
			projectId: "project-1",
			prompt: "生成视觉",
			revisionId: "revision-1",
		},
	});
	assert.deepEqual(
		calls.map((call) => call.action),
		["quoteGeneration", "quoteGeneration"],
	);
	for (const call of calls) {
		assert.equal(call.input.count, 1);
		assert.equal(typeof call.input.itemId, "string");
		assert.equal("batchKey" in call.input, false);
		assert.equal(call.input.modelId, "internal-model");
	}
	assert.equal(quotes.canConfirm, true);
	await submitCanvasGenerationBatch(request, quotes);
	assert.deepEqual(
		calls.map((call) => call.action),
		[
			"quoteGeneration",
			"quoteGeneration",
			"submitGeneration",
			"submitGeneration",
		],
	);
	for (const call of calls.slice(2)) {
		const submittedInput = call.input.input as Record<string, unknown>;
		assert.equal(submittedInput.modelId, "internal-model");
	}
});

test("quality, K1 video/audio fields, and normalized custom ratios stay frozen through quote and submit", async () => {
	const calls: Array<{ action: string; input: Record<string, unknown> }> = [];
	const request: CanvasGenerationBackendRequest = async (action, input) => {
		calls.push({ action, input });
		if (action === "quoteGeneration") {
			return {
				estimatedProviderCost: {
					amountMicros: 10_000,
					currency: "CNY" as const,
					unit: "request",
				},
				quoteId: `quote-${String(input.itemId)}`,
			} as never;
		}
		return {
			deliverable: null,
			jobId: `job-${calls.length}`,
			modelId: "internal-model",
			projectId: "project-1",
			revisionId: "revision-1",
			status: "queued",
		} as never;
	};
	const inputs = [
		buildCanvasGenerationInput({
			allowedInputAssetRoles: [],
			allowedParameters: [
				"durationSeconds",
				"generateAudio",
				"ratio",
				"resolution",
				"watermark",
			],
			assets: [],
			maskAssetId: "",
			maskNodeId: "",
			modelId: "video-model-1",
			operation: "video.generate",
			parameterValues: {
				durationSeconds: 12,
				generateAudio: true,
				ratio: " 6 : 4 ",
				resolution: "high",
				watermark: true,
			},
			projectId: "project-1",
			prompt: "生成短视频",
			ratio: "1:1",
			revisionId: "revision-1",
		}),
		buildCanvasGenerationInput({
			allowedInputAssetRoles: [],
			allowedParameters: [
				"format",
				"language",
				"maxDurationSeconds",
				"speed",
				"tone",
				"voice",
			],
			assets: [],
			maskAssetId: "",
			maskNodeId: "",
			modelId: "speech-model-1",
			operation: "audio.speech",
			parameterValues: {
				format: "wav",
				language: "zh-CN",
				maxDurationSeconds: 45,
				speed: 1.2,
				tone: "warm",
				voice: "soft",
			},
			projectId: "project-1",
			prompt: "播报活动提醒",
			ratio: "1:1",
			revisionId: "revision-1",
		}),
		buildCanvasGenerationInput({
			allowedInputAssetRoles: [],
			allowedParameters: ["durationSeconds", "format"],
			assets: [],
			maskAssetId: "",
			maskNodeId: "",
			modelId: "sfx-model-1",
			operation: "audio.sfx",
			parameterValues: { durationSeconds: 9, format: "mp3" },
			projectId: "project-1",
			prompt: "轻快提示音",
			ratio: "1:1",
			revisionId: "revision-1",
		}),
	];

	for (const [index, input] of inputs.entries()) {
		const quotes = await quoteCanvasGenerationBatch(request, {
			batchKey: `frozen-${index + 1}`,
			count: 1,
			input,
		});
		await submitCanvasGenerationBatch(request, quotes);
		const quoteCall = calls.at(-2)?.input;
		const submitCall = calls.at(-1)?.input.input as Record<string, unknown>;
		assert.deepEqual(quoteCall?.parameters, input.parameters);
		assert.deepEqual(submitCall.parameters, input.parameters);
		assert.equal(quoteCall?.modelId, input.modelId);
		assert.equal(submitCall.modelId, input.modelId);
	}
	assert.deepEqual(inputs[0]?.parameters, {
		durationSeconds: 12,
		generateAudio: true,
		ratio: "3:2",
		resolution: "high",
		watermark: true,
	});
});

test("host-owned batch snapshots retain quote input and apply primary, retry, cancel, and refresh updates", async () => {
	const request: CanvasGenerationBackendRequest = async (action, input) => {
		if (action === "quoteGeneration") {
			return {
				estimatedProviderCost: {
					amountMicros: 10_000,
					currency: "CNY" as const,
					unit: "request",
				},
				quoteId: `quote-${String(input.itemId)}`,
			} as never;
		}
		return {
			deliverable: null,
			jobId: "job-original",
			modelId: "internal-model",
			projectId: "project-1",
			revisionId: "revision-1",
			status: "failed",
		} as never;
	};
	const quotes = await quoteCanvasGenerationBatch(request, {
		batchKey: "durable-batch-1",
		count: 1,
		input: {
			inputAssets: [],
			inputNodeBindings: [],
			modelId: "internal-model",
			operation: "image.generate",
			parameters: { quality: "high", ratio: "3:2" },
			projectId: "project-1",
			prompt: "生成活动主图",
			revisionId: "revision-1",
		},
	});
	const submission = await submitCanvasGenerationBatch(request, quotes);
	const snapshot = createCanvasGenerationBatchSnapshot({ quotes, submission });
	const serialized = JSON.parse(JSON.stringify(snapshot)) as typeof snapshot;
	assert.deepEqual(serialized.items[0]?.input.parameters, {
		quality: "high",
		ratio: "3:2",
	});
	assert.equal(serialized.items[0]?.input.modelId, "internal-model");
	const primary = selectCanvasGenerationBatchPrimary(
		serialized,
		"job-original",
	);
	assert.equal(primary.primaryJobId, "job-original");
	const retried = applyCanvasGenerationBatchJobUpdate({
		job: {
			deliverable: null,
			jobId: "job-retry",
			modelId: "internal-model",
			projectId: "project-1",
			revisionId: "revision-1",
			status: "queued",
		},
		previousJobId: "job-original",
		snapshot: primary,
	});
	assert.equal(retried.primaryJobId, "job-retry");
	assert.equal(retried.items[0]?.job?.status, "queued");
	const retryJob = retried.items[0]?.job;
	assert.ok(retryJob);
	const cancelled = applyCanvasGenerationBatchJobUpdate({
		job: {
			...retryJob,
			status: "cancel_requested",
		},
		previousJobId: "job-retry",
		snapshot: retried,
	});
	assert.equal(cancelled.items[0]?.job?.status, "cancel_requested");
	const cancelledJob = cancelled.items[0]?.job;
	assert.ok(cancelledJob);
	const refreshed = reconcileCanvasGenerationBatchJobs(cancelled, [
		{
			...cancelledJob,
			status: "cancelled",
		},
	]);
	assert.equal(refreshed.items[0]?.job?.status, "cancelled");
});

test("retry and cancel use only fixed BackendPort actions and job presentation hides identifiers", async () => {
	const calls: Array<{ action: string; input: Record<string, unknown> }> = [];
	const job = {
		deliverable: null,
		failureCode: "PROVIDER_TIMEOUT",
		jobId: "job-private-1",
		modelId: "provider-private-1",
		projectId: "project-private-1",
		revisionId: "revision-private-1",
		status: "failed",
		usage: { quantity: 1, status: "refunded" as const },
	};
	const request: CanvasGenerationBackendRequest = async (action, input) => {
		calls.push({ action, input });
		return job as never;
	};
	await retryCanvasGeneration(request, {
		idempotencyKey: "retry-key",
		jobId: job.jobId,
		projectId: job.projectId,
	});
	await cancelCanvasGeneration(request, {
		idempotencyKey: "cancel-key",
		jobId: job.jobId,
		projectId: job.projectId,
	});
	assert.deepEqual(calls, [
		{
			action: "retryGeneration",
			input: { jobId: "job-private-1", projectId: "project-private-1" },
		},
		{
			action: "cancelGeneration",
			input: { jobId: "job-private-1", projectId: "project-private-1" },
		},
	]);
	assert.equal("modelId" in (calls[0]?.input ?? {}), false);
	assert.equal("modelId" in (calls[1]?.input ?? {}), false);
	const view = canvasGenerationJobView(job);
	assert.equal(view.retryable, true);
	assert.match(view.detail, /超时/u);
	assert.doesNotMatch(JSON.stringify(view), /job-private|provider-private/u);
});

test("standalone workbench renders node context without raw asset, node, or model identifiers", () => {
	const markup = renderToStaticMarkup(
		createElement(CanvasNodeGenerationWorkbench, {
			batchSnapshot: null,
			catalog: {
				operations: [
					capability({
						modelId: "provider-private-edit-9",
						operation: "image.edit",
					}),
					capability({
						modelId: "provider-private-9",
						operation: "image.generate",
					}),
				],
			},
			context: {
				kind: "image",
			},
			loadAssets: async () => ({ items: [], nextCursor: null }),
			onBatchSnapshotChange() {},
			onResourceDraftChange() {},
			prepareQuoteCheckpoint: async () => ({
				projectId: "project-private-9",
				revisionId: "revision-private-9",
			}),
			request: (async () => {
				throw new Error("not called while rendering");
			}) as CanvasGenerationBackendRequest,
			resourceDraft: {
				...createResourceDraft("image.generate"),
				prompt: "生成活动主图",
			},
			resourceNodeCandidates: [
				{
					assetId: "asset-private-9",
					kind: "node",
					label: "已连接的图片节点 1",
					mediaKind: "image",
					nodeId: "node-private-9",
				},
			],
			resourceNodes: [
				{
					data: { assetId: "asset-private-9" },
					id: "node-private-9",
					type: "image",
				},
			],
		}),
	);
	assert.match(markup, /可用模型 1/u);
	assert.match(markup, /contentEditable="true"/u);
	assert.match(markup, /@ 引用资源/u);
	assert.doesNotMatch(markup, /<textarea/u);
	assert.doesNotMatch(
		markup,
		/(?:asset-private|node-private|provider-private|project-private|revision-private)/u,
	);
});
