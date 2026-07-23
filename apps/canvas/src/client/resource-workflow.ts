import type { CanvasGenerationOperation } from "@meiye/core/pro-studio-runtime";
import {
	type CatalogEntry,
	isCatalogOperationActive,
} from "../kernel-host/generation-adapter";
import type {
	CanvasAssetInput,
	CanvasGenerationInputAssetRole,
} from "./generation-ui-contract";

export type CanvasResourceKind = "audio" | "image" | "video";

export type CanvasAssetListItem = {
	id: string;
	kind: CanvasResourceKind;
	title: string;
};

export type CanvasPromptListItem = {
	category?: string;
	id: string;
	prompt: string;
	title: string;
};

export type CanvasCursorPage<T> = {
	items: T[];
	nextCursor: string | null;
};

export type CanvasCursorListState<T> = {
	error: boolean;
	items: T[];
	nextCursor: string | null;
	status: "error" | "idle" | "loading" | "ready";
};

export type ResourceMention = {
	assetId: string;
	kind: "asset" | "node";
	label: string;
	mediaKind: CanvasResourceKind;
	nodeId?: string;
};

export type ResourceDraft = {
	mentions: ResourceMention[];
	operation: CanvasGenerationOperation;
	prompt: string;
	schemaVersion: 1;
};

export type ResourceMentionCandidate = ResourceMention;

export type ResourceMentionRange = {
	end: number;
	query: string;
	start: number;
};

export type MentionKeyboardAction =
	| { kind: "close" }
	| { index: number; kind: "move" | "select" }
	| { kind: "none" };

type ResourceGraphNode = {
	data: Record<string, unknown>;
	id: string;
	type: string;
};

type ResourceGraphEdge = {
	source: string;
	target: string;
};

const MAX_PROMPT_LENGTH = 20_000;
const MAX_REFERENCE_ID_LENGTH = 200;
const SUPPORTED_OPERATIONS = new Set<CanvasGenerationOperation>([
	"audio.sfx",
	"audio.speech",
	"image.edit",
	"image.generate",
	"text.respond",
	"video.generate",
]);

const CLIENT_UPLOAD_LIMIT_BYTES = 25 * 1024 * 1024;
const ALLOWED_UPLOAD_CONTENT_TYPES = new Set([
	"audio/mpeg",
	"audio/wav",
	"image/jpeg",
	"image/png",
	"image/webp",
	"video/mp4",
]);

export function promptListRequest(input: {
	category?: string;
	cursor?: string;
	query?: string;
}) {
	return {
		...(input.category?.trim() ? { category: input.category.trim() } : {}),
		...(input.cursor ? { cursor: input.cursor } : {}),
		...(input.query?.trim() ? { query: input.query.trim() } : {}),
	};
}

export function assetListRequest(input: {
	cursor?: string;
	kind?: CanvasResourceKind;
	query?: string;
}) {
	return {
		...(input.cursor ? { cursor: input.cursor } : {}),
		...(input.kind ? { kind: input.kind } : {}),
		...(input.query?.trim() ? { query: input.query.trim() } : {}),
	};
}

export function initialCursorListState<T>(): CanvasCursorListState<T> {
	return { error: false, items: [], nextCursor: null, status: "idle" };
}

export function beginCursorListRequest<T>(
	state: CanvasCursorListState<T>,
	append: boolean,
): CanvasCursorListState<T> {
	return {
		error: false,
		items: append ? state.items : [],
		nextCursor: append ? state.nextCursor : null,
		status: "loading",
	};
}

export function acceptCursorListPage<T>(
	state: CanvasCursorListState<T>,
	page: CanvasCursorPage<T>,
	append: boolean,
): CanvasCursorListState<T> {
	return {
		error: false,
		items: append ? [...state.items, ...page.items] : page.items,
		nextCursor: page.nextCursor,
		status: "ready",
	};
}

export function rejectCursorListRequest<T>(
	state: CanvasCursorListState<T>,
): CanvasCursorListState<T> {
	return { ...state, error: true, status: "error" };
}

export function createResourceDraft(
	operation: CanvasGenerationOperation = "image.generate",
): ResourceDraft {
	return { mentions: [], operation, prompt: "", schemaVersion: 1 };
}

/** Converts a graph-safe record back into the only resource-draft shape. */
export function restoreResourceDraft(value: unknown): ResourceDraft | null {
	if (!isRecord(value) || value.schemaVersion !== 1) return null;
	if (
		typeof value.prompt !== "string" ||
		value.prompt.length > MAX_PROMPT_LENGTH ||
		typeof value.operation !== "string" ||
		!SUPPORTED_OPERATIONS.has(value.operation as CanvasGenerationOperation) ||
		!Array.isArray(value.mentions)
	) {
		return null;
	}
	const mentions = value.mentions
		.map(restoreResourceMention)
		.filter((mention): mention is ResourceMention => mention !== null);
	return {
		mentions: uniqueMentions(mentions),
		operation: value.operation as CanvasGenerationOperation,
		prompt: value.prompt,
		schemaVersion: 1,
	};
}

/** Returns a JSON-safe copy suitable for the existing server-owned graph draft. */
export function serializeResourceDraft(draft: ResourceDraft): ResourceDraft {
	return {
		mentions: draft.mentions.map((mention) => ({ ...mention })),
		operation: draft.operation,
		prompt: draft.prompt.slice(0, MAX_PROMPT_LENGTH),
		schemaVersion: 1,
	};
}

export function resourceDraftFromGraph(
	graph: { nodes: readonly ResourceGraphNode[] } | null | undefined,
	selectedNodeIds: readonly string[],
): ResourceDraft | null {
	if (!graph) return null;
	const selected = new Set(selectedNodeIds);
	const ordered = [
		...graph.nodes.filter(
			(node) => node.type === "config" && selected.has(node.id),
		),
		...graph.nodes.filter(
			(node) => node.type === "config" && !selected.has(node.id),
		),
	];
	for (const node of ordered) {
		const draft = restoreResourceDraft(node.data.resourceDraft);
		if (draft) return draft;
	}
	return null;
}

export function promptCompatibility(
	prompt: Pick<CanvasPromptListItem, "category">,
	operation: CanvasGenerationOperation,
	catalog: readonly CatalogEntry[],
): { compatible: boolean; reason?: string } {
	const catalogEntry = catalog.find((entry) => entry.operation === operation);
	if (!catalogEntry || !isCatalogOperationActive(catalogEntry)) {
		return {
			compatible: false,
			reason: "当前创作能力暂不可用，暂不能使用这条提示词。",
		};
	}
	const capabilities = promptCapabilities(prompt.category);
	if (capabilities.length === 0) {
		return {
			compatible: false,
			reason: "这条提示词尚未标注适用创作能力，暂不能使用。",
		};
	}
	if (!capabilities.includes(operation)) {
		return {
			compatible: false,
			reason: `这条提示词适用于${operationLabel(capabilities[0])}，与当前创作能力不匹配。`,
		};
	}
	return { compatible: true };
}

export function safePromptPresentation(
	prompt: Pick<CanvasPromptListItem, "category" | "title">,
): { category: string; purpose: string; title: string } {
	const category = promptCategoryPresentation(prompt.category);
	return {
		category: category.label,
		purpose: category.purpose,
		title: safeMerchantLabel(prompt.title, `${category.label}提示词`),
	};
}

export function promptCategoryPresentation(category: string | undefined): {
	label: string;
	purpose: string;
} {
	const normalized = normalizeCategory(category);
	if (matchesCategory(normalized, ["retouch", "edit", "修图", "编辑"])) {
		return { label: "图片编辑", purpose: "用于图片编辑与修图" };
	}
	if (matchesCategory(normalized, ["video", "视频"])) {
		return { label: "视频创作", purpose: "用于视频创作" };
	}
	if (matchesCategory(normalized, ["speech", "语音"])) {
		return { label: "语音创作", purpose: "用于语音合成" };
	}
	if (matchesCategory(normalized, ["audio", "sfx", "音频", "音效"])) {
		return { label: "音频创作", purpose: "用于音频或音效创作" };
	}
	if (matchesCategory(normalized, ["text", "copy", "文案", "文本"])) {
		return { label: "文案创作", purpose: "用于文本与文案创作" };
	}
	if (
		matchesCategory(normalized, [
			"campaign",
			"image",
			"visual",
			"营销",
			"图片",
			"视觉",
		])
	) {
		return { label: "营销画面", purpose: "用于图片创作" };
	}
	return { label: "创作提示词", purpose: "按可用创作能力使用" };
}

export function nodeMentionCandidates(input: {
	edges: readonly ResourceGraphEdge[];
	nodes: readonly ResourceGraphNode[];
	selectedNodeIds: readonly string[];
}): ResourceMentionCandidate[] {
	const selected = new Set(input.selectedNodeIds);
	if (selected.size === 0) return [];
	const connected = new Set(selected);
	for (const edge of input.edges) {
		if (selected.has(edge.source)) connected.add(edge.target);
		if (selected.has(edge.target)) connected.add(edge.source);
	}
	const counts: Record<CanvasResourceKind, number> = {
		audio: 0,
		image: 0,
		video: 0,
	};
	return input.nodes.flatMap((node) => {
		if (!connected.has(node.id)) return [];
		const assetId = stringId(node.data.assetId);
		const mediaKind = nodeMediaKind(node.type);
		if (!assetId || !mediaKind) return [];
		counts[mediaKind] += 1;
		return [
			{
				assetId,
				kind: "node" as const,
				label: `已连接的${resourceKindLabel(mediaKind)}节点 ${counts[mediaKind]}`,
				mediaKind,
				nodeId: node.id,
			},
		];
	});
}

export function assetMentionCandidate(
	asset: CanvasAssetListItem,
): ResourceMentionCandidate {
	return {
		assetId: asset.id,
		kind: "asset",
		label: `${resourceKindLabel(asset.kind)}素材：${safeAssetTitle(asset)}`,
		mediaKind: asset.kind,
	};
}

export function safeAssetTitle(
	asset: Pick<CanvasAssetListItem, "kind" | "title">,
) {
	return safeMerchantLabel(asset.title, `${resourceKindLabel(asset.kind)}素材`);
}

/** Keeps the visible candidate list independent from internal IDs. */
export function filterResourceMentionCandidates(input: {
	assets: readonly CanvasAssetListItem[];
	nodes: readonly ResourceMentionCandidate[];
	query: string;
}): ResourceMentionCandidate[] {
	const query = input.query.trim().toLocaleLowerCase();
	const candidates = [
		...input.nodes,
		...input.assets.map(assetMentionCandidate),
	];
	const seen = new Set<string>();
	return candidates.filter((candidate) => {
		if (query && !candidate.label.toLocaleLowerCase().includes(query)) {
			return false;
		}
		const key = mentionKey(candidate);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

/** Finds the active @ token in the editor's controlled plain text. */
export function findResourceMentionRange(
	value: string,
	cursor: number,
): ResourceMentionRange | null {
	const end = clampPlainTextSelection(value, cursor);
	const prefix = value.slice(0, end);
	const match = /(^|\s)@([^\s@]*)$/u.exec(prefix);
	if (!match) return null;
	return {
		end,
		query: match[2] ?? "",
		start: end - (match[2]?.length ?? 0) - 1,
	};
}

/** Normalizes an editor selection before it is restored after a render. */
export function clampPlainTextSelection(value: string, offset: number): number {
	if (!Number.isFinite(offset)) return value.length;
	return Math.max(0, Math.min(value.length, Math.trunc(offset)));
}

export function mentionKeyboardAction(
	key: string,
	activeIndex: number,
	candidateCount: number,
): MentionKeyboardAction {
	if (key === "Escape") return { kind: "close" };
	if (candidateCount <= 0) return { kind: "none" };
	const current = Math.max(0, Math.min(activeIndex, candidateCount - 1));
	if (key === "ArrowDown") {
		return { index: (current + 1) % candidateCount, kind: "move" };
	}
	if (key === "ArrowUp") {
		return {
			index: (current - 1 + candidateCount) % candidateCount,
			kind: "move",
		};
	}
	if (key === "Enter") return { index: current, kind: "select" };
	return { kind: "none" };
}

export function resourceDraftWithPlainText(
	draft: ResourceDraft,
	prompt: string,
): ResourceDraft {
	return reconcileResourceMentions({
		...draft,
		prompt: prompt.slice(0, MAX_PROMPT_LENGTH),
	});
}

export function insertResourceMention(
	draft: ResourceDraft,
	range: { end: number; start: number },
	mention: ResourceMentionCandidate,
): { cursor: number; draft: ResourceDraft } {
	const token = `@${mention.label}`;
	const nextPrompt = `${draft.prompt.slice(0, range.start)}${token} ${draft.prompt.slice(range.end)}`;
	return {
		cursor: range.start + token.length + 1,
		draft: {
			...draft,
			mentions: uniqueMentions([...draft.mentions, { ...mention }]),
			prompt: nextPrompt.slice(0, MAX_PROMPT_LENGTH),
		},
	};
}

export function reconcileResourceMentions(draft: ResourceDraft): ResourceDraft {
	return {
		...draft,
		mentions: draft.mentions.filter((mention) =>
			draft.prompt.includes(`@${mention.label}`),
		),
	};
}

export function removeResourceMention(
	draft: ResourceDraft,
	mention: ResourceMention,
): ResourceDraft {
	const token = `@${mention.label}`;
	return {
		...draft,
		mentions: draft.mentions.filter(
			(candidate) => mentionKey(candidate) !== mentionKey(mention),
		),
		prompt: draft.prompt.replace(token, "").replace(/ {2,}/gu, " "),
	};
}

export function replaceResourceMention(
	draft: ResourceDraft,
	mention: ResourceMention,
): { cursor: number; draft: ResourceDraft } {
	const token = `@${mention.label}`;
	const index = draft.prompt.indexOf(token);
	if (index < 0) return { cursor: draft.prompt.length, draft };
	const nextDraft = removeResourceMention(draft, mention);
	return {
		cursor: index + 1,
		draft: {
			...nextDraft,
			prompt: `${draft.prompt.slice(0, index)}@${draft.prompt.slice(index + token.length)}`,
		},
	};
}

/**
 * Converts only explicit mentions into Core generation inputs. A graph node or
 * an asset that was not mentioned never reaches the request DTO.
 */
export function mentionedGenerationInputs(input: {
	allowedInputAssetRoles: readonly CanvasGenerationInputAssetRole[];
	mentions: readonly ResourceMention[];
	nodes: readonly ResourceGraphNode[];
}): CanvasAssetInput[] {
	const allowed = new Set(input.allowedInputAssetRoles);
	const nodesById = new Map(input.nodes.map((node) => [node.id, node]));
	const seen = new Set<string>();
	const references: CanvasAssetInput[] = [];
	for (const mention of input.mentions) {
		const role = roleForResourceKind(mention.mediaKind);
		if (!allowed.has(role)) continue;
		if (mention.kind === "node") {
			const node = mention.nodeId ? nodesById.get(mention.nodeId) : undefined;
			if (
				!node ||
				nodeMediaKind(node.type) !== mention.mediaKind ||
				stringId(node.data.assetId) !== mention.assetId
			) {
				continue;
			}
			const key = `${role}:${mention.assetId}`;
			if (seen.has(key)) continue;
			seen.add(key);
			references.push({
				assetId: mention.assetId,
				nodeId: node.id,
				nodeType: node.type,
			});
			continue;
		}
		const key = `${role}:${mention.assetId}`;
		if (seen.has(key)) continue;
		seen.add(key);
		references.push({
			assetId: mention.assetId,
			nodeType: mention.mediaKind,
		});
	}
	return references;
}

export function mentionedNodeIds(
	mentions: readonly ResourceMention[],
	nodes: readonly ResourceGraphNode[],
): string[] {
	const nodesById = new Map(nodes.map((node) => [node.id, node]));
	const seen = new Set<string>();
	return mentions.flatMap((mention) => {
		if (
			mention.kind !== "node" ||
			!mention.nodeId ||
			seen.has(mention.nodeId)
		) {
			return [];
		}
		const node = nodesById.get(mention.nodeId);
		if (
			!node ||
			stringId(node.data.assetId) !== mention.assetId ||
			nodeMediaKind(node.type) !== mention.mediaKind
		) {
			return [];
		}
		seen.add(node.id);
		return [node.id];
	});
}

export function validateCanvasUpload(input: {
	size: number;
	type: string;
}): string | null {
	const type = input.type.toLowerCase().trim();
	if (!ALLOWED_UPLOAD_CONTENT_TYPES.has(type)) {
		return "仅支持 PNG、JPG、WebP、MP4、MP3 或 WAV 素材。";
	}
	if (!Number.isFinite(input.size) || input.size <= 0) {
		return "请选择一个非空素材文件。";
	}
	if (input.size > CLIENT_UPLOAD_LIMIT_BYTES) {
		return "素材不能超过 25 MB。";
	}
	return null;
}

export function resourceKindFromContentType(
	contentType: string,
): CanvasResourceKind | null {
	const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
	if (normalized.startsWith("image/")) return "image";
	if (normalized.startsWith("video/")) return "video";
	if (normalized.startsWith("audio/")) return "audio";
	return null;
}

export function resourceKindLabel(kind: CanvasResourceKind): string {
	switch (kind) {
		case "audio":
			return "音频";
		case "image":
			return "图片";
		case "video":
			return "视频";
	}
}

function restoreResourceMention(value: unknown): ResourceMention | null {
	if (!isRecord(value)) return null;
	const assetId = stringId(value.assetId);
	const rawLabel = typeof value.label === "string" ? value.label.trim() : "";
	const mediaKind = value.mediaKind;
	if (
		!assetId ||
		!rawLabel ||
		rawLabel.length > 200 ||
		(value.kind !== "asset" && value.kind !== "node") ||
		(mediaKind !== "audio" && mediaKind !== "image" && mediaKind !== "video")
	) {
		return null;
	}
	const label = safeMerchantLabel(
		rawLabel,
		value.kind === "node"
			? `已连接的${resourceKindLabel(mediaKind)}节点`
			: `${resourceKindLabel(mediaKind)}素材`,
	);
	const nodeId = stringId(value.nodeId);
	if (value.kind === "node" && !nodeId) return null;
	return {
		assetId,
		kind: value.kind,
		label,
		mediaKind,
		...(nodeId ? { nodeId } : {}),
	};
}

function uniqueMentions(
	mentions: readonly ResourceMention[],
): ResourceMention[] {
	const seen = new Set<string>();
	return mentions.filter((mention) => {
		const key = mentionKey(mention);
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
}

function mentionKey(mention: ResourceMention) {
	return mention.kind === "node"
		? `node:${mention.nodeId}:${mention.assetId}`
		: `asset:${mention.assetId}`;
}

function promptCapabilities(
	category: string | undefined,
): CanvasGenerationOperation[] {
	const normalized = normalizeCategory(category);
	if (matchesCategory(normalized, ["retouch", "edit", "修图", "编辑"])) {
		return ["image.edit"];
	}
	if (matchesCategory(normalized, ["video", "视频"])) {
		return ["video.generate"];
	}
	if (matchesCategory(normalized, ["speech", "语音"])) {
		return ["audio.speech"];
	}
	if (matchesCategory(normalized, ["audio", "sfx", "音频", "音效"])) {
		return ["audio.sfx"];
	}
	if (matchesCategory(normalized, ["text", "copy", "文案", "文本"])) {
		return ["text.respond"];
	}
	if (
		matchesCategory(normalized, [
			"campaign",
			"image",
			"visual",
			"营销",
			"图片",
			"视觉",
		])
	) {
		return ["image.generate"];
	}
	return [];
}

function operationLabel(operation: CanvasGenerationOperation): string {
	switch (operation) {
		case "audio.sfx":
			return "音效生成";
		case "audio.speech":
			return "语音合成";
		case "image.edit":
			return "图片编辑";
		case "image.generate":
			return "图片生成";
		case "text.respond":
			return "文案创作";
		case "video.generate":
			return "视频生成";
	}
}

function safeMerchantLabel(value: string, fallback: string): string {
	const normalized = value.replace(/\s+/gu, " ").trim();
	if (!normalized || normalized.length > 200 || looksInternal(normalized)) {
		return fallback;
	}
	return normalized;
}

function looksInternal(value: string): boolean {
	return /(?:^|[\s._:-])(asset|deployment|group|id|object(?:[ _-]?key)?|prompt|provider|seed)(?:[\s._:-]|\d|$)/iu.test(
		value,
	);
}

function normalizeCategory(category: string | undefined) {
	return category?.trim().toLocaleLowerCase() ?? "";
}

function matchesCategory(value: string, markers: readonly string[]) {
	return markers.some((marker) => value.includes(marker));
}

function nodeMediaKind(value: string): CanvasResourceKind | null {
	if (value === "audio" || value === "image" || value === "video") return value;
	return null;
}

function roleForResourceKind(
	kind: CanvasResourceKind,
): CanvasGenerationInputAssetRole {
	switch (kind) {
		case "audio":
			return "reference_audio";
		case "image":
			return "reference_image";
		case "video":
			return "reference_video";
	}
}

function stringId(value: unknown): string | null {
	return typeof value === "string" &&
		value.length > 0 &&
		value.length <= MAX_REFERENCE_ID_LENGTH
		? value
		: null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
