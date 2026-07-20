import assert from "node:assert/strict";
import test from "node:test";
import {
	buildCanvasGenerationInput,
	canvasGenerationCancelPayload,
	canvasGenerationJobPresentation,
	canvasGenerationSubmitPayload,
	canvasNodeTypeFromContentType,
	freezeCanvasGenerationInputs,
	generatedCanvasNode,
	generatedResultEdges,
	resolveGenerationJobInputNodeIds,
	selectableCanvasAssets,
} from "./generation-ui-contract";
import {
	agentApplyResultMessage,
	agentPlanIntentFingerprint,
	createLatestActivityCommitGate,
	generationActionState,
	isGenerationJobForProject,
	runtimeActivityProjectId,
	runtimeErrorMessage,
} from "./runtime-panel";

test("activity refresh identity is stable across same-project graph objects", () => {
	const first = runtimeActivityProjectId({ id: "project-1" });
	const changedGraphObject = runtimeActivityProjectId({ id: "project-1" });
	assert.equal(first, "project-1");
	assert.equal(changedGraphObject, first);
	assert.equal(runtimeActivityProjectId({ id: "project-2" }), "project-2");
	assert.equal(runtimeActivityProjectId(null), null);
});

test("latest activity commit gate rejects stale requests and other projects", () => {
	const gate = createLatestActivityCommitGate();
	gate.activate("project-a");
	const first = gate.begin("project-a");
	const second = gate.begin("project-a");
	assert.equal(first(), false);
	assert.equal(second(), true);
	assert.equal(gate.begin("project-b")(), false);
	gate.activate("project-b");
	assert.equal(second(), false);
	assert.equal(gate.begin("project-a")(), false);
});

test("generation results can be inserted only into their current project", () => {
	assert.equal(
		isGenerationJobForProject({ projectId: "project-a" }, "project-a"),
		true,
	);
	assert.equal(
		isGenerationJobForProject({ projectId: "project-a" }, "project-b"),
		false,
	);
	assert.equal(
		isGenerationJobForProject({ projectId: "project-a" }, null),
		false,
	);
});

test("adoption selection errors are presented in user language", () => {
	assert.equal(
		runtimeErrorMessage(new Error("ADOPTION_SELECTION_MEDIA_MIXED")),
		"一次只能采用同一种媒体：请选择纯图片组或纯视频组。",
	);
	assert.equal(
		runtimeErrorMessage(new Error("ADOPTION_SELECTION_TEXT_REQUIRED")),
		"采用图片时还需要在画布中选择一个非空文本节点。",
	);
	assert.equal(
		runtimeErrorMessage(new Error("ADOPTION_SELECTION_VIDEO_TEXT_UNSUPPORTED")),
		"采用视频时请只选择视频节点，不要同时选择文本节点。",
	);
});

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
			{ assetId: "asset-image-1", nodeId: "image-1", nodeType: "image" },
			{ assetId: "asset-video-1", nodeId: "video-1", nodeType: "video" },
			{ assetId: "asset-audio-1", nodeId: "audio-1", nodeType: "audio" },
		],
		allowedInputAssetRoles: ["reference_image", "reference_video"],
		allowedParameters: ["durationSeconds"],
		maskAssetId: "asset-mask-1",
		maskNodeId: "",
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
		],
		inputNodeBindings: [
			{
				assetId: "asset-image-1",
				nodeId: "image-1",
				role: "reference_image",
			},
			{
				assetId: "asset-video-1",
				nodeId: "video-1",
				role: "reference_video",
			},
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

test("generation inputs freeze ordered selection and connected canvas assets", () => {
	const frozen = freezeCanvasGenerationInputs({
		allowedInputAssetRoles: ["reference_image"],
		edges: [
			{ source: "text-1", target: "image-2" },
			{ source: "image-1", target: "text-1" },
			{ source: "text-1", target: "video-1" },
		],
		nodes: [
			{ data: { text: "prompt" }, id: "text-1", type: "text" },
			{ data: { assetId: "asset-image-1" }, id: "image-1", type: "image" },
			{ data: { assetId: "asset-image-2" }, id: "image-2", type: "image" },
			{ data: { assetId: "asset-video-1" }, id: "video-1", type: "video" },
		],
		selectedNodeIds: ["image-1", "text-1"],
	});

	assert.deepEqual(frozen, [
		{ assetId: "asset-image-1", nodeId: "image-1", nodeType: "image" },
		{ assetId: "asset-image-2", nodeId: "image-2", nodeType: "image" },
	]);
	assert.deepEqual(
		buildCanvasGenerationInput({
			allowedInputAssetRoles: ["reference_image"],
			allowedParameters: [],
			assets: frozen,
			maskAssetId: "",
			maskNodeId: "",
			operation: "image.generate",
			projectId: "project-1",
			prompt: "Generate from connected references",
			ratio: "1:1",
			revisionId: "revision-1",
		}).inputAssets,
		[
			{ assetId: "asset-image-1", role: "reference_image" },
			{ assetId: "asset-image-2", role: "reference_image" },
		],
	);
});

test("generation job projection recovers node inputs before local fallback", () => {
	const nodes = [
		{ data: { assetId: "asset-1" }, id: "image-1", type: "image" },
		{ data: { assetId: "asset-2" }, id: "image-2", type: "image" },
	];
	assert.deepEqual(
		resolveGenerationJobInputNodeIds(
			{
				inputAssetIds: ["asset-2"],
				maskAssetId: "asset-1",
			},
			nodes,
			["fallback"],
		),
		["image-2", "image-1"],
	);
	assert.deepEqual(
		resolveGenerationJobInputNodeIds({}, nodes, ["image-1", "image-1"]),
		["image-1"],
	);
});

test("generation job projection preserves the selected node when one asset appears more than once", () => {
	const nodes = [
		{ data: { assetId: "asset-shared" }, id: "image-older", type: "image" },
		{ data: { assetId: "asset-shared" }, id: "image-selected", type: "image" },
	];
	assert.deepEqual(
		resolveGenerationJobInputNodeIds(
			{
				inputAssetIds: ["asset-shared"],
				inputNodeIds: ["image-selected"],
			},
			nodes,
			[],
		),
		["image-selected"],
	);
});

test("generated result edges preserve real input lineage without duplicates", () => {
	assert.deepEqual(
		generatedResultEdges({
			existingEdges: [{ source: "image-1", target: "generated-1" }],
			inputNodeIds: ["image-1", "image-1", "image-2"],
			resultNodeId: "generated-1",
		}),
		[
			{
				id: "generation-image-2-generated-1",
				source: "image-2",
				target: "generated-1",
				type: "generation",
			},
		],
	);
	assert.deepEqual(
		generatedResultEdges({
			existingEdges: [],
			inputNodeIds: [],
			resultNodeId: "generated-1",
		}),
		[],
	);
});

test("Canvas UI assigns image edit masks as an independent role", () => {
	assert.deepEqual(
		buildCanvasGenerationInput({
			assets: [
				{ assetId: "asset-image-1", nodeId: "image-1", nodeType: "image" },
				{ assetId: "asset-video-1", nodeId: "video-1", nodeType: "video" },
			],
			allowedInputAssetRoles: ["reference_image", "mask"],
			allowedParameters: ["width", "height"],
			maskAssetId: "asset-mask-1",
			maskNodeId: "mask-1",
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
			inputNodeBindings: [
				{
					assetId: "asset-image-1",
					nodeId: "image-1",
					role: "reference_image",
				},
				{ assetId: "asset-mask-1", nodeId: "mask-1", role: "mask" },
			],
			operation: "image.edit",
			parameters: { height: 1024, width: 1024 },
			projectId: "project-1",
			prompt: "Retouch this image",
			revisionId: "revision-1",
		},
	);
});

test("Canvas UI exposes and submits only input assets allowed by the active Core capability", () => {
	const assets = [
		{ assetId: "asset-image-1", nodeId: "image-1", nodeType: "image" },
		{ assetId: "asset-video-1", nodeId: "video-1", nodeType: "video" },
		{ assetId: "asset-audio-1", nodeId: "audio-1", nodeType: "audio" },
	];
	assert.deepEqual(
		selectableCanvasAssets(assets, ["reference_image", "reference_audio"]),
		[
			{ assetId: "asset-image-1", nodeId: "image-1", nodeType: "image" },
			{ assetId: "asset-audio-1", nodeId: "audio-1", nodeType: "audio" },
		],
	);
	assert.deepEqual(
		buildCanvasGenerationInput({
			assets,
			allowedInputAssetRoles: ["reference_image"],
			allowedParameters: [],
			maskAssetId: "asset-image-1",
			maskNodeId: "image-1",
			operation: "video.generate",
			projectId: "project-1",
			prompt: "Generate video",
			ratio: "9:16",
			revisionId: "revision-1",
		}).inputAssets,
		[{ assetId: "asset-image-1", role: "reference_image" }],
	);
	assert.deepEqual(
		buildCanvasGenerationInput({
			assets,
			allowedInputAssetRoles: ["reference_image"],
			allowedParameters: [],
			maskAssetId: "asset-image-1",
			maskNodeId: "image-1",
			operation: "image.edit",
			projectId: "project-1",
			prompt: "Edit image",
			ratio: "1:1",
			revisionId: "revision-1",
		}).inputAssets,
		[{ assetId: "asset-image-1", role: "reference_image" }],
	);
});

test("inactive capability reports the honest reason and keeps quote and submit disabled", () => {
	assert.deepEqual(
		generationActionState({
			busy: false,
			catalog: [
				{
					activation: "inactive",
					modelId: null,
					operation: "video.generate",
					unavailableReason: "尚未通过 live 验证",
				},
			],
			hasGenerationInput: true,
			hasPrompt: true,
			hasQuote: true,
			operation: "video.generate",
		}),
		{
			availability: { available: false, reason: "尚未通过 live 验证" },
			quoteDisabled: true,
			submitDisabled: true,
		},
	);
});

test("generated failure and billing states are presented in user language", () => {
	const presentation = canvasGenerationJobPresentation({
		deliverable: null,
		failureCode: "PROVIDER_TIMEOUT",
		jobId: "job-failed-1",
		modelId: "video-1",
		operation: "video.generate",
		projectId: "project-1",
		revisionId: "revision-1",
		status: "failed",
		usage: { quantity: 1, status: "refunded" },
	});
	assert.deepEqual(presentation, {
		billingLabel: "本次额度已退回",
		detail: "生成服务响应超时，本次未交付，请稍后重试。",
		statusLabel: "生成失败",
	});
	assert.doesNotMatch(
		Object.values(presentation).join(" "),
		/PROVIDER_TIMEOUT/u,
	);
});

test("asset content type maps to the correct canvas media node", () => {
	assert.equal(canvasNodeTypeFromContentType("image/webp"), "image");
	assert.equal(
		canvasNodeTypeFromContentType("video/mp4; codecs=avc1"),
		"video",
	);
	assert.equal(canvasNodeTypeFromContentType("audio/mpeg"), "audio");
	assert.equal(canvasNodeTypeFromContentType("application/pdf"), null);
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
