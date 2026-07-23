import assert from "node:assert/strict";
import test from "node:test";
import { buildCanvasGenerationInput } from "./generation-ui-contract";
import {
	acceptCursorListPage,
	assetListRequest,
	clampPlainTextSelection,
	createResourceDraft,
	filterResourceMentionCandidates,
	findResourceMentionRange,
	initialCursorListState,
	insertResourceMention,
	mentionedGenerationInputs,
	mentionKeyboardAction,
	nodeMentionCandidates,
	promptCompatibility,
	promptListRequest,
	rejectCursorListRequest,
	removeResourceMention,
	replaceResourceMention,
	resourceDraftFromGraph,
	resourceDraftWithPlainText,
	restoreResourceDraft,
	safePromptPresentation,
	serializeResourceDraft,
	validateCanvasUpload,
} from "./resource-workflow";

test("resource cursors preserve query/category/kind and handle end and error states", () => {
	assert.deepEqual(
		promptListRequest({
			category: " image ",
			cursor: "prompt-cursor-1",
			query: " nail ",
		}),
		{ category: "image", cursor: "prompt-cursor-1", query: "nail" },
	);
	assert.deepEqual(
		assetListRequest({
			cursor: "asset-cursor-1",
			kind: "video",
			query: " service ",
		}),
		{ cursor: "asset-cursor-1", kind: "video", query: "service" },
	);

	const first = acceptCursorListPage(
		initialCursorListState<{ title: string }>(),
		{ items: [{ title: "第一页" }], nextCursor: "next-page" },
		false,
	);
	assert.deepEqual(first, {
		error: false,
		items: [{ title: "第一页" }],
		nextCursor: "next-page",
		status: "ready",
	});
	const end = acceptCursorListPage(
		first,
		{ items: [{ title: "最后一页" }], nextCursor: null },
		true,
	);
	assert.equal(end.nextCursor, null);
	assert.deepEqual(rejectCursorListRequest(end), {
		error: true,
		items: [{ title: "第一页" }, { title: "最后一页" }],
		nextCursor: null,
		status: "error",
	});
});

test("prompt presentation and compatibility are safe for merchant UI", () => {
	const catalog = [
		{
			activation: "active" as const,
			modelId: "catalog-model",
			operation: "image.generate",
		},
	];
	assert.deepEqual(
		promptCompatibility({ category: "campaign" }, "image.generate", catalog),
		{ compatible: true },
	);
	assert.match(
		promptCompatibility({ category: "video" }, "image.generate", catalog)
			.reason ?? "",
		/不匹配/u,
	);
	assert.match(
		promptCompatibility({ category: undefined }, "image.generate", catalog)
			.reason ?? "",
		/尚未标注/u,
	);
	const presentation = safePromptPresentation({
		category: "campaign",
		title: "seed-A3",
	});
	assert.deepEqual(presentation, {
		category: "营销画面",
		purpose: "用于图片创作",
		title: "营销画面提示词",
	});
});

test("@ candidates, keyboard selection, chip deletion, and recovery use controlled plain text", () => {
	const nodes = [
		{ data: {}, id: "selected-text", type: "text" },
		{
			data: { assetId: "asset-connected" },
			id: "connected-image",
			type: "image",
		},
	];
	const nodeCandidates = nodeMentionCandidates({
		edges: [{ source: "selected-text", target: "connected-image" }],
		nodes,
		selectedNodeIds: ["selected-text"],
	});
	assert.deepEqual(
		nodeCandidates.map((candidate) => candidate.label),
		["已连接的图片节点 1"],
	);
	const candidates = filterResourceMentionCandidates({
		assets: [
			{ id: "asset-private-777", kind: "image", title: "asset-private-777" },
		],
		nodes: nodeCandidates,
		query: "图片",
	});
	assert.equal(candidates.length, 2);
	assert.ok(
		candidates.every((candidate) => !candidate.label.includes("asset-")),
	);
	assert.deepEqual(mentionKeyboardAction("ArrowDown", 0, candidates.length), {
		index: 1,
		kind: "move",
	});
	assert.deepEqual(mentionKeyboardAction("ArrowUp", 0, candidates.length), {
		index: 1,
		kind: "move",
	});
	assert.deepEqual(mentionKeyboardAction("Enter", 1, candidates.length), {
		index: 1,
		kind: "select",
	});
	assert.deepEqual(mentionKeyboardAction("Escape", 1, candidates.length), {
		kind: "close",
	});

	const prompt = "请使用 @图";
	const range = findResourceMentionRange(prompt, prompt.length);
	assert.deepEqual(range, { end: prompt.length, query: "图", start: 4 });
	assert.equal(clampPlainTextSelection(prompt, 99), prompt.length);
	const inserted = insertResourceMention(
		{ ...createResourceDraft(), prompt },
		range ?? { end: prompt.length, start: prompt.length },
		nodeCandidates[0] as NonNullable<(typeof nodeCandidates)[number]>,
	);
	assert.equal(inserted.draft.mentions.length, 1);
	assert.match(inserted.draft.prompt, /@已连接的图片节点 1/u);
	const insertedMention = inserted.draft.mentions[0];
	if (!insertedMention) throw new Error("expected selected mention");
	const restored = resourceDraftFromGraph(
		{
			nodes: [
				{
					data: { resourceDraft: serializeResourceDraft(inserted.draft) },
					id: "config-1",
					type: "config",
				},
			],
		},
		[],
	);
	assert.deepEqual(restored, inserted.draft);
	const replacement = replaceResourceMention(inserted.draft, insertedMention);
	assert.equal(replacement.draft.mentions.length, 0);
	assert.deepEqual(
		findResourceMentionRange(replacement.draft.prompt, replacement.cursor),
		{ end: replacement.cursor, query: "", start: replacement.cursor - 1 },
	);
	const removed = removeResourceMention(inserted.draft, insertedMention);
	assert.equal(removed.mentions.length, 0);
	assert.ok(!removed.prompt.includes("已连接的图片节点 1"));
	assert.equal(
		resourceDraftWithPlainText(inserted.draft, "仅保留文字").mentions.length,
		0,
	);
	const sanitized = restoreResourceDraft({
		...inserted.draft,
		mentions: [
			{
				...inserted.draft.mentions[0],
				label: "asset-object-key-123",
			},
		],
	});
	assert.equal(sanitized?.mentions[0]?.label, "已连接的图片节点");
});

test("only valid explicit mentions reach the generation DTO", () => {
	const nodes = [
		{ data: {}, id: "selected-text", type: "text" },
		{
			data: { assetId: "asset-mentioned" },
			id: "connected-image",
			type: "image",
		},
		{
			data: { assetId: "asset-unmentioned" },
			id: "other-image",
			type: "image",
		},
	];
	const [mentioned] = nodeMentionCandidates({
		edges: [{ source: "selected-text", target: "connected-image" }],
		nodes,
		selectedNodeIds: ["selected-text"],
	});
	if (!mentioned) throw new Error("expected connected image mention candidate");
	const inputs = mentionedGenerationInputs({
		allowedInputAssetRoles: ["reference_image"],
		mentions: [
			mentioned,
			{ ...mentioned, assetId: "asset-replaced-after-mention" },
		],
		nodes,
	});
	assert.deepEqual(inputs, [
		{
			assetId: "asset-mentioned",
			nodeId: "connected-image",
			nodeType: "image",
		},
	]);
	const request = buildCanvasGenerationInput({
		allowedInputAssetRoles: ["reference_image"],
		allowedParameters: [],
		assets: inputs,
		maskAssetId: "",
		maskNodeId: "",
		operation: "image.generate",
		projectId: "project-1",
		prompt: "只使用明确引用的图片",
		ratio: "1:1",
		revisionId: "revision-1",
	});
	assert.deepEqual(request.inputAssets, [
		{ assetId: "asset-mentioned", role: "reference_image" },
	]);
	assert.deepEqual(request.inputNodeBindings, [
		{
			assetId: "asset-mentioned",
			nodeId: "connected-image",
			role: "reference_image",
		},
	]);
	assert.ok(
		!JSON.stringify(request).includes("asset-unmentioned"),
		"a graph resource must not reach the DTO unless it was explicitly mentioned",
	);
});

test("client upload validation accepts image, video, and audio without exposing internals", () => {
	for (const type of ["image/png", "video/mp4", "audio/mpeg"]) {
		assert.equal(validateCanvasUpload({ size: 1024, type }), null);
	}
	assert.equal(
		validateCanvasUpload({ size: 1024, type: "image/gif" }),
		"仅支持 PNG、JPG、WebP、MP4、MP3 或 WAV 素材。",
	);
	const sizeError = validateCanvasUpload({
		size: 25 * 1024 * 1024 + 1,
		type: "video/mp4",
	});
	assert.equal(sizeError, "素材不能超过 25 MB。");
	assert.doesNotMatch(sizeError ?? "", /asset|id|object|provider/iu);
});
