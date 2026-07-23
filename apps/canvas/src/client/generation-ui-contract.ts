import type { CanvasGenerationOperation } from "@meiye/core/pro-studio-runtime";

export type CanvasGenerationInputAssetRole =
	| "mask"
	| "reference_audio"
	| "reference_image"
	| "reference_video";

export type CanvasGenerationRequest = {
	inputAssets: Array<{
		assetId: string;
		role: CanvasGenerationInputAssetRole;
	}>;
	inputNodeBindings: CanvasGenerationInputNodeBinding[];
	modelId?: string;
	operation: CanvasGenerationOperation;
	parameters: Record<string, CanvasGenerationParameterValue>;
	projectId: string;
	prompt: string;
	revisionId: string;
};

export type CanvasGenerationParameterValue = boolean | number | string;

export interface CoreCanvasGenerationQuote {
	catalogRevisionId: string;
	createdAt: string;
	estimatedProviderCost?: {
		amountMicros: number;
		currency: "CNY" | "USD";
		unit: string;
	} | null;
	operation: CanvasGenerationOperation;
	payloadHash: string;
	priceRevision: string;
	quoteId: string;
	workspaceId: string;
}

export interface CoreCanvasGenerationJob {
	deliverable:
		| { kind: "asset"; asset: { contentType: string; id: string } }
		| { kind: "text"; text: string }
		| null;
	failureCode?: string;
	inputAssetIds?: string[];
	inputNodeIds?: string[];
	jobId: string;
	maskAssetId?: string;
	maskNodeId?: string;
	modelId: string;
	operation?: CanvasGenerationOperation;
	projectId: string;
	revisionId: string;
	status: string;
	usage?: {
		quantity: number;
		status: "committed" | "refunded" | "reserved";
	};
}

export type CanvasAssetInput = {
	assetId: string;
	nodeId?: string;
	nodeType: string;
};

export type CanvasGenerationInputNodeBinding = {
	assetId: string;
	nodeId: string;
	role: CanvasGenerationInputAssetRole;
};

export type CanvasGenerationInputBinding = CanvasAssetInput & {
	nodeId: string;
};

type CanvasGraphNodeLike = {
	data: Record<string, unknown>;
	id: string;
	type: string;
};

type CanvasGraphEdgeLike = {
	id?: string;
	source: string;
	target: string;
	type?: string;
};

export function freezeCanvasGenerationInputs(input: {
	allowedInputAssetRoles: readonly CanvasGenerationInputAssetRole[];
	edges: readonly CanvasGraphEdgeLike[];
	nodes: readonly CanvasGraphNodeLike[];
	selectedNodeIds: readonly string[];
}): CanvasGenerationInputBinding[] {
	const nodesById = new Map(input.nodes.map((node) => [node.id, node]));
	const allowedRoles = new Set(input.allowedInputAssetRoles);
	const seenAssetIds = new Set<string>();
	const frozen: CanvasGenerationInputBinding[] = [];
	const addNode = (nodeId: string) => {
		const node = nodesById.get(nodeId);
		const assetId = node?.data.assetId;
		if (!node || typeof assetId !== "string" || !assetId.trim()) return;
		const roleBearing = roleBearingAsset({ assetId, nodeType: node.type });
		if (!roleBearing || !allowedRoles.has(roleBearing.role)) return;
		if (seenAssetIds.has(assetId)) return;
		seenAssetIds.add(assetId);
		frozen.push({ assetId, nodeId: node.id, nodeType: node.type });
	};

	for (const selectedNodeId of input.selectedNodeIds) {
		addNode(selectedNodeId);
		for (const edge of input.edges) {
			if (edge.source === selectedNodeId) addNode(edge.target);
			if (edge.target === selectedNodeId) addNode(edge.source);
		}
	}
	return frozen;
}

export function resolveGenerationJobInputNodeIds(
	job: {
		inputAssetIds?: readonly string[];
		inputNodeIds?: readonly string[];
		maskAssetId?: string;
		maskNodeId?: string;
	},
	nodes: readonly CanvasGraphNodeLike[],
	fallbackNodeIds: readonly string[],
): string[] {
	const nodeIds = new Set(nodes.map((node) => node.id));
	if (Array.isArray(job.inputNodeIds)) {
		return uniqueStrings([
			...job.inputNodeIds.filter((nodeId) => nodeIds.has(nodeId)),
			...(job.maskNodeId && nodeIds.has(job.maskNodeId)
				? [job.maskNodeId]
				: []),
		]);
	}
	if (Array.isArray(job.inputAssetIds)) {
		const firstNodeByAssetId = new Map<string, string>();
		for (const fallbackNodeId of fallbackNodeIds) {
			const fallbackNode = nodes.find((node) => node.id === fallbackNodeId);
			const assetId = fallbackNode?.data.assetId;
			if (typeof assetId === "string" && !firstNodeByAssetId.has(assetId)) {
				firstNodeByAssetId.set(assetId, fallbackNodeId);
			}
		}
		for (const node of nodes) {
			const assetId = node.data.assetId;
			if (typeof assetId === "string" && !firstNodeByAssetId.has(assetId)) {
				firstNodeByAssetId.set(assetId, node.id);
			}
		}
		return uniqueStrings(
			[...job.inputAssetIds, ...(job.maskAssetId ? [job.maskAssetId] : [])]
				.map((assetId) => firstNodeByAssetId.get(assetId))
				.filter((nodeId): nodeId is string => Boolean(nodeId)),
		);
	}
	return uniqueStrings(fallbackNodeIds.filter((nodeId) => nodeIds.has(nodeId)));
}

export function generatedResultEdges(input: {
	existingEdges: readonly CanvasGraphEdgeLike[];
	inputNodeIds: readonly string[];
	resultNodeId: string;
}): Array<
	Required<Pick<CanvasGraphEdgeLike, "id" | "source" | "target" | "type">>
> {
	const existingPairs = new Set(
		input.existingEdges.map((edge) => `${edge.source}\u0000${edge.target}`),
	);
	const existingIds = new Set(
		input.existingEdges
			.map((edge) => edge.id)
			.filter((id): id is string => typeof id === "string"),
	);
	return uniqueStrings(input.inputNodeIds)
		.filter(
			(source) =>
				source !== input.resultNodeId &&
				!existingPairs.has(`${source}\u0000${input.resultNodeId}`),
		)
		.map((source) => {
			const baseId = `generation-${source}-${input.resultNodeId}`;
			let id = baseId;
			let suffix = 2;
			while (existingIds.has(id)) {
				id = `${baseId}-${suffix}`;
				suffix += 1;
			}
			existingIds.add(id);
			return {
				id,
				source,
				target: input.resultNodeId,
				type: "generation",
			};
		});
}

export function buildCanvasGenerationInput(input: {
	assets: CanvasAssetInput[];
	allowedInputAssetRoles: readonly CanvasGenerationInputAssetRole[];
	allowedParameters: readonly string[];
	maskAssetId: string;
	maskNodeId: string;
	modelId?: string;
	operation: CanvasGenerationOperation;
	parameterValues?: Record<string, CanvasGenerationParameterValue>;
	projectId: string;
	prompt: string;
	ratio: string;
	revisionId: string;
}): CanvasGenerationRequest {
	const modelId = normalizedModelId(input.modelId);
	const common = {
		...(modelId ? { modelId } : {}),
		projectId: input.projectId,
		prompt: input.prompt,
		revisionId: input.revisionId,
	};
	const allowedRoles = new Set(input.allowedInputAssetRoles);
	const assets = input.assets
		.map(roleBearingAsset)
		.filter(isPresent)
		.filter((asset) => allowedRoles.has(asset.role));
	const canUseMask = input.maskAssetId.length > 0 && allowedRoles.has("mask");
	const parameters = strictCanvasGenerationParameters({
		allowedParameters: input.allowedParameters,
		operation: input.operation,
		values: {
			...defaultCanvasGenerationParameters(input.operation, input.ratio),
			...input.parameterValues,
		},
	});
	switch (input.operation) {
		case "image.generate":
			return {
				...common,
				...generationInputFields(
					assets
						.filter((asset) => asset.role === "reference_image")
						.slice(0, 20),
					input.assets,
				),
				operation: input.operation,
				parameters,
			};
		case "image.edit":
			return {
				...common,
				...generationInputFields(
					[
						...assets
							.filter((asset) => asset.role === "reference_image")
							.slice(0, canUseMask ? 19 : 20),
						...(canUseMask
							? [{ assetId: input.maskAssetId, role: "mask" as const }]
							: []),
					],
					input.assets,
					canUseMask
						? {
								assetId: input.maskAssetId,
								nodeId: input.maskNodeId,
								role: "mask",
							}
						: undefined,
				),
				operation: input.operation,
				parameters,
			};
		case "text.respond":
			return {
				...common,
				...generationInputFields(
					assets
						.filter((asset) => asset.role === "reference_image")
						.slice(0, 8),
					input.assets,
				),
				operation: input.operation,
				parameters,
			};
		case "video.generate":
			return {
				...common,
				...generationInputFields(assets.slice(0, 8), input.assets),
				operation: input.operation,
				parameters,
			};
		case "audio.speech":
			return {
				...common,
				...generationInputFields(
					assets
						.filter((asset) => asset.role === "reference_audio")
						.slice(0, 1),
					input.assets,
				),
				operation: input.operation,
				parameters,
			};
		case "audio.sfx":
			return {
				...common,
				...generationInputFields(
					assets
						.filter((asset) => asset.role === "reference_audio")
						.slice(0, 1),
					input.assets,
				),
				operation: input.operation,
				parameters,
			};
	}
}

const STRICT_CANVAS_GENERATION_PARAMETERS: Record<
	CanvasGenerationOperation,
	readonly string[]
> = {
	"audio.sfx": ["durationSeconds", "format"],
	"audio.speech": [
		"format",
		"language",
		"maxDurationSeconds",
		"speed",
		"tone",
		"voice",
	],
	"image.edit": [
		"height",
		"quality",
		"ratio",
		"resolution",
		"strength",
		"width",
	],
	"image.generate": ["height", "quality", "ratio", "resolution", "width"],
	"text.respond": ["maxOutputTokens", "temperature"],
	"video.generate": [
		"durationSeconds",
		"generateAudio",
		"ratio",
		"resolution",
		"watermark",
	],
};

export function strictCanvasGenerationParameterNames(
	operation: CanvasGenerationOperation,
) {
	return STRICT_CANVAS_GENERATION_PARAMETERS[operation];
}

export function strictCanvasGenerationParameters(input: {
	allowedParameters: readonly string[];
	operation: CanvasGenerationOperation;
	values: Record<string, CanvasGenerationParameterValue>;
}): Record<string, CanvasGenerationParameterValue> {
	const serverAllowed = new Set(input.allowedParameters);
	const parameters: Record<string, CanvasGenerationParameterValue> = {};
	for (const name of strictCanvasGenerationParameterNames(input.operation)) {
		const value = input.values[name];
		if (
			serverAllowed.has(name) &&
			isStrictCanvasGenerationParameterValue(input.operation, name, value)
		) {
			if (name === "ratio") {
				const normalized = normalizeCanvasGenerationRatio(value as string);
				if (normalized) parameters[name] = normalized;
			} else {
				parameters[name] = value;
			}
		}
	}
	if (
		!serverAllowed.has("ratio") &&
		serverAllowed.has("width") &&
		serverAllowed.has("height") &&
		!("width" in parameters) &&
		!("height" in parameters) &&
		typeof input.values.ratio === "string"
	) {
		const dimensions = ratioDimensions(input.values.ratio);
		if (dimensions) Object.assign(parameters, dimensions);
	}
	return parameters;
}

export function isStrictCanvasGenerationParameterValue(
	operation: CanvasGenerationOperation,
	name: string,
	value: CanvasGenerationParameterValue | undefined,
) {
	if (!strictCanvasGenerationParameterNames(operation).includes(name)) {
		return false;
	}
	switch (name) {
		case "durationSeconds":
			return isIntegerInRange(value, 1, 120);
		case "format":
			return value === "mp3" || value === "wav";
		case "generateAudio":
		case "watermark":
			return typeof value === "boolean";
		case "height":
		case "width":
			return isIntegerInRange(value, 1, 4096);
		case "language":
			return isTextInRange(value, 2, 20);
		case "maxDurationSeconds":
			return isIntegerInRange(value, 1, 600);
		case "maxOutputTokens":
			return isIntegerInRange(value, 1, 16_000);
		case "ratio":
			return (
				typeof value === "string" &&
				Boolean(normalizeCanvasGenerationRatio(value))
			);
		case "quality":
			return value === "standard" || value === "high";
		case "resolution":
		case "tone":
		case "voice":
			return isTextInRange(value, 1, name === "resolution" ? 30 : 100);
		case "speed":
			return typeof value === "number" && value >= 0.5 && value <= 2;
		case "strength":
			return typeof value === "number" && value >= 0 && value <= 1;
		case "temperature":
			return typeof value === "number" && value >= 0 && value <= 2;
	}
}

function defaultCanvasGenerationParameters(
	operation: CanvasGenerationOperation,
	ratio: string,
): Record<string, CanvasGenerationParameterValue> {
	switch (operation) {
		case "image.generate":
			return { quality: "standard", ratio, resolution: "standard" };
		case "image.edit":
			return {
				quality: "standard",
				ratio,
				resolution: "standard",
				strength: 0.7,
			};
		case "text.respond":
			return { maxOutputTokens: 1200, temperature: 0.4 };
		case "video.generate":
			return {
				generateAudio: false,
				ratio,
				resolution: "standard",
				watermark: false,
			};
		case "audio.speech":
			return {
				format: "mp3",
				language: "zh-CN",
				maxDurationSeconds: 120,
				speed: 1,
				tone: "natural",
				voice: "default",
			};
		case "audio.sfx":
			return { durationSeconds: 10, format: "mp3" };
	}
}

function generationInputFields(
	inputAssets: Array<{ assetId: string; role: CanvasGenerationInputAssetRole }>,
	sourceAssets: CanvasAssetInput[],
	mask?: { assetId: string; nodeId?: string; role: "mask" },
) {
	const bindingByKey = new Map<string, CanvasGenerationInputNodeBinding>();
	for (const source of sourceAssets) {
		const roleBearing = roleBearingAsset(source);
		if (!roleBearing || !source.nodeId) continue;
		bindingByKey.set(`${roleBearing.role}:${source.assetId}`, {
			...roleBearing,
			nodeId: source.nodeId,
		});
	}
	if (mask?.assetId && mask.nodeId) {
		bindingByKey.set(`mask:${mask.assetId}`, {
			assetId: mask.assetId,
			nodeId: mask.nodeId,
			role: "mask",
		});
	}
	return {
		inputAssets,
		inputNodeBindings: inputAssets
			.map((asset) => bindingByKey.get(`${asset.role}:${asset.assetId}`))
			.filter(isPresent),
	};
}

export function selectableCanvasAssets<T extends CanvasAssetInput>(
	assets: readonly T[],
	allowedInputAssetRoles: readonly CanvasGenerationInputAssetRole[],
): T[] {
	const allowed = new Set(allowedInputAssetRoles);
	return assets.filter((asset) => {
		const roleBearing = roleBearingAsset(asset);
		return roleBearing !== null && allowed.has(roleBearing.role);
	});
}

function normalizedModelId(modelId: string | undefined) {
	const normalized = modelId?.trim() ?? "";
	return normalized.length > 0 && normalized.length <= 200 ? normalized : null;
}

function isIntegerInRange(
	value: CanvasGenerationParameterValue | undefined,
	minimum: number,
	maximum: number,
) {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= minimum &&
		value <= maximum
	);
}

function isTextInRange(
	value: CanvasGenerationParameterValue | undefined,
	minimum: number,
	maximum: number,
) {
	return (
		typeof value === "string" &&
		value.trim().length >= minimum &&
		value.length <= maximum
	);
}

export function normalizeCanvasGenerationRatio(ratio: string): string | null {
	const match = /^\s*(\d+)\s*:\s*(\d+)\s*$/u.exec(ratio);
	if (!match) return null;
	const widthRatio = Number(match[1]);
	const heightRatio = Number(match[2]);
	if (
		!Number.isSafeInteger(widthRatio) ||
		!Number.isSafeInteger(heightRatio) ||
		widthRatio < 1 ||
		heightRatio < 1 ||
		widthRatio > 4096 ||
		heightRatio > 4096
	) {
		return null;
	}
	const divisor = greatestCommonDivisor(widthRatio, heightRatio);
	return `${widthRatio / divisor}:${heightRatio / divisor}`;
}

function ratioDimensions(ratio: string) {
	const normalized = normalizeCanvasGenerationRatio(ratio);
	if (!normalized) return null;
	const [widthText, heightText] = normalized.split(":");
	const widthRatio = Number(widthText);
	const heightRatio = Number(heightText);
	const longSide = 1024;
	if (widthRatio >= heightRatio) {
		return {
			height: Math.max(1, Math.round((longSide * heightRatio) / widthRatio)),
			width: longSide,
		};
	}
	return {
		height: longSide,
		width: Math.max(1, Math.round((longSide * widthRatio) / heightRatio)),
	};
}

function greatestCommonDivisor(left: number, right: number) {
	let dividend = left;
	let divisor = right;
	while (divisor !== 0) {
		const remainder = dividend % divisor;
		dividend = divisor;
		divisor = remainder;
	}
	return dividend;
}

export function canvasGenerationSubmitPayload(
	input: CanvasGenerationRequest,
	quote: Pick<CoreCanvasGenerationQuote, "quoteId">,
) {
	return { input, quoteId: quote.quoteId };
}

export function canvasGenerationCancelPayload(
	projectId: string,
	jobId: string,
) {
	return { jobId, projectId };
}

export function generatedCanvasNode(
	job: CoreCanvasGenerationJob,
): { data: Record<string, string>; type: string } | null {
	if (job.deliverable?.kind === "text") {
		return {
			data: { jobId: job.jobId, text: job.deliverable.text },
			type: "text",
		};
	}
	if (job.deliverable?.kind === "asset") {
		return {
			data: { assetId: job.deliverable.asset.id, jobId: job.jobId },
			type: mediaNodeType(job),
		};
	}
	return null;
}

export function isCanvasGenerationCancellable(status: string) {
	return status === "queued" || status === "running" || status === "unknown";
}

export function canvasGenerationJobPresentation(job: CoreCanvasGenerationJob): {
	billingLabel?: string;
	detail: string;
	statusLabel: string;
} {
	return {
		...(job.usage ? { billingLabel: usageStatusLabel(job.usage.status) } : {}),
		detail:
			job.status === "failed"
				? failureDetail(job.failureCode)
				: generationStatusDetail(job.status),
		statusLabel: generationStatusLabel(job.status),
	};
}

export function canvasNodeTypeFromContentType(
	contentType: string,
): "audio" | "image" | "video" | null {
	const normalized = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
	if (normalized.startsWith("image/")) return "image";
	if (normalized.startsWith("video/")) return "video";
	if (normalized.startsWith("audio/")) return "audio";
	return null;
}

function roleBearingAsset(asset: CanvasAssetInput) {
	const role =
		asset.nodeType === "image"
			? ("reference_image" as const)
			: asset.nodeType === "video"
				? ("reference_video" as const)
				: asset.nodeType === "audio"
					? ("reference_audio" as const)
					: null;
	return role ? { assetId: asset.assetId, role } : null;
}

function uniqueStrings(values: readonly string[]) {
	return [...new Set(values.filter((value) => value.length > 0))];
}

function mediaNodeType(job: CoreCanvasGenerationJob) {
	if (job.deliverable?.kind === "asset") {
		const contentTypeNode = canvasNodeTypeFromContentType(
			job.deliverable.asset.contentType,
		);
		if (contentTypeNode) return contentTypeNode;
	}
	if (job.operation?.startsWith("video.")) return "video";
	if (job.operation?.startsWith("audio.")) return "audio";
	return "image";
}

function generationStatusLabel(status: string) {
	switch (status) {
		case "queued":
			return "排队中";
		case "accepted":
		case "running":
			return "生成中";
		case "delivery_pending":
			return "结果入库中";
		case "cancel_requested":
			return "取消确认中";
		case "cancelled":
			return "已取消";
		case "completed":
			return "已完成";
		case "failed":
			return "生成失败";
		case "unknown":
			return "状态核对中";
		default:
			return "处理中";
	}
}

function generationStatusDetail(status: string) {
	switch (status) {
		case "completed":
			return "结果已由服务端确认交付。";
		case "cancelled":
			return "任务已确认取消，未交付结果。";
		case "delivery_pending":
			return "正在将生成结果存入服务端素材库。";
		case "cancel_requested":
			return "已发起取消，等待生成服务确认。";
		case "unknown":
			return "正在核对生成服务的最终结果。";
		default:
			return "生成任务正在处理。";
	}
}

function failureDetail(failureCode: string | undefined) {
	const code = failureCode?.toLowerCase() ?? "";
	if (/content|policy|safety/u.test(code)) {
		return "内容未通过安全检查，本次未交付，请调整后重试。";
	}
	if (/timeout|poll/u.test(code)) {
		return "生成服务响应超时，本次未交付，请稍后重试。";
	}
	if (/cancel/u.test(code)) {
		return "生成任务已取消，本次未交付。";
	}
	if (/asset|delivery|download/u.test(code)) {
		return "结果交付失败，正在核对最终交付与额度状态。";
	}
	if (/provider|dispatch|unavailable/u.test(code)) {
		return "生成服务暂不可用，本次未交付，请稍后重试。";
	}
	return "生成未完成，本次未交付，请稍后重试。";
}

function usageStatusLabel(
	status: NonNullable<CoreCanvasGenerationJob["usage"]>["status"],
) {
	switch (status) {
		case "committed":
			return "本次额度已结算";
		case "refunded":
			return "本次额度已退回";
		case "reserved":
			return "额度已预留，待结果确认";
	}
}

function isPresent<T>(value: T | null | undefined): value is T {
	return value != null;
}
