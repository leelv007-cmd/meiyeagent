import type {
	CanvasGenerationCatalogEntry,
	CanvasGenerationOperation,
} from "@meiye/core/pro-studio-runtime";
import {
	type CanvasGenerationFanOutCaller,
	type CanvasGenerationFanOutInput,
	type CanvasGenerationFanOutMemberInput,
	type CanvasGenerationFanOutQuoteProjection,
	type CanvasGenerationFanOutSubmissionProjection,
	quoteFanOutGeneration,
	submitQuotedFanOutGeneration,
} from "./generation-batch-orchestrator";
import {
	type CanvasGenerationInputAssetRole,
	type CanvasGenerationParameterValue,
	type CoreCanvasGenerationJob,
	type CoreCanvasGenerationQuote,
	canvasGenerationCancelPayload,
	canvasGenerationJobPresentation,
	isCanvasGenerationCancellable,
	isStrictCanvasGenerationParameterValue,
	strictCanvasGenerationParameterNames,
} from "./generation-ui-contract";

export type CanvasGenerationCapability = CanvasGenerationCatalogEntry & {
	allowedInputAssetRoles: CanvasGenerationInputAssetRole[];
	modelLabel?: string;
	unavailableReason?: string;
};

export type CanvasGenerationCatalog = {
	operations: readonly CanvasGenerationCapability[];
};

export type CanvasGenerationModelChoice = {
	label: string;
	modelId: string;
};

export type CanvasGenerationAvailability = {
	available: boolean;
	capability?: CanvasGenerationCapability;
	modelChoices: CanvasGenerationModelChoice[];
	reason?: string;
};

export type CanvasGenerationParameterControl = {
	kind: "boolean" | "number" | "ratio" | "select" | "text";
	label: string;
	maximum?: number;
	minimum?: number;
	name: string;
	options?: Array<{ label: string; value: string }>;
	step?: number;
};

export type CanvasGenerationContextNodeKind =
	| "audio"
	| "config"
	| "image"
	| "text"
	| "video";

export type CanvasGenerationContextAction = {
	label: string;
	operation: CanvasGenerationOperation;
};

export type CanvasGenerationBackendAction =
	| "cancelGeneration"
	| "quoteGeneration"
	| "retryGeneration"
	| "submitGeneration";

export type CanvasGenerationBackendRequest = <T>(
	action: CanvasGenerationBackendAction,
	input: Record<string, unknown>,
	options: { idempotencyKey: string },
) => Promise<T>;

/**
 * Serializable host-owned projection. It intentionally retains the frozen
 * quote input (including model and strict parameters) without rendering IDs.
 */
export type CanvasGenerationBatchSnapshot = {
	batchKey: string;
	confirmation: "aggregate-N-quotes-once";
	items: CanvasGenerationBatchSnapshotItem[];
	primaryJobId?: string;
	schemaVersion: 1;
	strategy: CanvasGenerationFanOutSubmissionProjection["strategy"];
	totalEstimatedProviderCost: CanvasGenerationFanOutSubmissionProjection["totalEstimatedProviderCost"];
};

export type CanvasGenerationBatchSnapshotItem = {
	error?: { code: string };
	idempotencyKey: string;
	input: CanvasGenerationFanOutMemberInput;
	itemKey: string;
	job?: CoreCanvasGenerationJob;
	quote: CoreCanvasGenerationQuote;
	state: "submit_failed" | "submitted";
};

const PARAMETER_CONTROLS: Record<
	CanvasGenerationOperation,
	CanvasGenerationParameterControl[]
> = {
	"audio.sfx": [
		{
			kind: "number",
			label: "时长（秒）",
			maximum: 120,
			minimum: 1,
			name: "durationSeconds",
		},
		{
			kind: "select",
			label: "音频格式",
			name: "format",
			options: [
				{ label: "MP3", value: "mp3" },
				{ label: "WAV", value: "wav" },
			],
		},
	],
	"audio.speech": [
		{
			kind: "select",
			label: "音色",
			name: "voice",
			options: [{ label: "默认音色", value: "default" }],
		},
		{ kind: "text", label: "语气", name: "tone" },
		{ kind: "text", label: "语言", name: "language" },
		{
			kind: "number",
			label: "语速",
			maximum: 2,
			minimum: 0.5,
			name: "speed",
			step: 0.1,
		},
		{
			kind: "number",
			label: "最长时长（秒）",
			maximum: 600,
			minimum: 1,
			name: "maxDurationSeconds",
		},
		{
			kind: "select",
			label: "音频格式",
			name: "format",
			options: [
				{ label: "MP3", value: "mp3" },
				{ label: "WAV", value: "wav" },
			],
		},
	],
	"image.edit": [
		{ kind: "ratio", label: "画面比例", name: "ratio" },
		{
			kind: "select",
			label: "画质",
			name: "quality",
			options: [
				{ label: "标准", value: "standard" },
				{ label: "高清", value: "high" },
			],
		},
		{
			kind: "select",
			label: "清晰度（兼容字段）",
			name: "resolution",
			options: [
				{ label: "标准", value: "standard" },
				{ label: "高清", value: "high" },
			],
		},
		{
			kind: "number",
			label: "重绘强度",
			maximum: 1,
			minimum: 0,
			name: "strength",
			step: 0.1,
		},
		{ kind: "number", label: "宽度", maximum: 4096, minimum: 1, name: "width" },
		{
			kind: "number",
			label: "高度",
			maximum: 4096,
			minimum: 1,
			name: "height",
		},
	],
	"image.generate": [
		{ kind: "ratio", label: "画面比例", name: "ratio" },
		{
			kind: "select",
			label: "画质",
			name: "quality",
			options: [
				{ label: "标准", value: "standard" },
				{ label: "高清", value: "high" },
			],
		},
		{
			kind: "select",
			label: "清晰度（兼容字段）",
			name: "resolution",
			options: [
				{ label: "标准", value: "standard" },
				{ label: "高清", value: "high" },
			],
		},
		{ kind: "number", label: "宽度", maximum: 4096, minimum: 1, name: "width" },
		{
			kind: "number",
			label: "高度",
			maximum: 4096,
			minimum: 1,
			name: "height",
		},
	],
	"text.respond": [
		{
			kind: "number",
			label: "最长输出",
			maximum: 16_000,
			minimum: 1,
			name: "maxOutputTokens",
		},
		{
			kind: "number",
			label: "创意程度",
			maximum: 2,
			minimum: 0,
			name: "temperature",
			step: 0.1,
		},
	],
	"video.generate": [
		{ kind: "ratio", label: "画面比例", name: "ratio" },
		{
			kind: "select",
			label: "清晰度",
			name: "resolution",
			options: [
				{ label: "标准", value: "standard" },
				{ label: "高清", value: "high" },
			],
		},
		{
			kind: "number",
			label: "时长（秒）",
			maximum: 120,
			minimum: 1,
			name: "durationSeconds",
		},
		{ kind: "boolean", label: "生成声音", name: "generateAudio" },
		{ kind: "boolean", label: "添加水印", name: "watermark" },
	],
};

const REQUIRED_AUDIO_PARAMETERS: Record<
	"audio.sfx" | "audio.speech",
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
};

export function activeCanvasGenerationModels(
	catalog: CanvasGenerationCatalog | null | undefined,
	operation: CanvasGenerationOperation,
): CanvasGenerationModelChoice[] {
	const seen = new Set<string>();
	const matches = catalog?.operations.filter(
		(entry) => entry.operation === operation && hasActiveGenerationModel(entry),
	);
	return (matches ?? []).flatMap((entry, index) => {
		const modelId = entry.modelId?.trim();
		if (!modelId || seen.has(modelId)) return [];
		seen.add(modelId);
		return [{ label: modelLabel(entry, index), modelId }];
	});
}

export function canvasGenerationAvailability(input: {
	catalog: CanvasGenerationCatalog | null | undefined;
	modelId?: string;
	operation: CanvasGenerationOperation;
}): CanvasGenerationAvailability {
	if (!input.catalog) {
		return {
			available: false,
			modelChoices: [],
			reason: "正在获取服务端能力目录，暂不能提交。",
		};
	}
	const modelChoices = activeCanvasGenerationModels(
		input.catalog,
		input.operation,
	);
	const matchingEntries =
		input.catalog?.operations.filter(
			(entry) => entry.operation === input.operation,
		) ?? [];
	if (modelChoices.length === 0) {
		return {
			available: false,
			modelChoices,
			reason: unavailableModelReason(input.operation, matchingEntries),
		};
	}
	const selectedModelId = input.modelId?.trim() || modelChoices[0]?.modelId;
	const choice = modelChoices.find(
		(candidate) => candidate.modelId === selectedModelId,
	);
	if (!choice) {
		return {
			available: false,
			modelChoices,
			reason: "请选择服务端当前允许的模型。",
		};
	}
	const capability = matchingEntries.find(
		(entry) =>
			entry.modelId === choice.modelId && hasActiveGenerationModel(entry),
	);
	if (!capability) {
		return {
			available: false,
			modelChoices,
			reason: "当前模型已不可用，请重新选择。",
		};
	}
	if (
		(capability.operation === "audio.speech" ||
			capability.operation === "audio.sfx") &&
		!hasCompleteAudioParameters(capability)
	) {
		return {
			available: false,
			capability,
			modelChoices,
			reason: "音频生成参数尚未完整启用，暂不能提交。",
		};
	}
	return { available: true, capability, modelChoices };
}

export function visibleCanvasGenerationParameterControls(input: {
	allowedParameters: readonly string[];
	operation: CanvasGenerationOperation;
}) {
	const allowed = new Set(input.allowedParameters);
	const strict = new Set(strictCanvasGenerationParameterNames(input.operation));
	const hasApprovedQuality = allowed.has("quality") && strict.has("quality");
	return PARAMETER_CONTROLS[input.operation].filter((control) => {
		if (!allowed.has(control.name) || !strict.has(control.name)) return false;
		// A current Catalog quality field is authoritative. The legacy resolution
		// field remains visible only for older Catalog entries that have no quality.
		return control.name !== "resolution" || !hasApprovedQuality;
	});
}

export function defaultCanvasGenerationParameterValues(
	operation: CanvasGenerationOperation,
): Record<string, CanvasGenerationParameterValue> {
	switch (operation) {
		case "image.generate":
			return { quality: "standard", ratio: "1:1", resolution: "standard" };
		case "image.edit":
			return {
				quality: "standard",
				ratio: "1:1",
				resolution: "standard",
				strength: 0.7,
			};
		case "text.respond":
			return { maxOutputTokens: 1200, temperature: 0.4 };
		case "video.generate":
			return {
				generateAudio: false,
				ratio: "16:9",
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

export function invalidCanvasGenerationParameters(input: {
	allowedParameters: readonly string[];
	operation: CanvasGenerationOperation;
	values: Record<string, CanvasGenerationParameterValue>;
}) {
	const allowed = new Set(input.allowedParameters);
	return strictCanvasGenerationParameterNames(input.operation).filter(
		(name) =>
			allowed.has(name) &&
			!isStrictCanvasGenerationParameterValue(
				input.operation,
				name,
				input.values[name],
			),
	);
}

export function canvasNodeGenerationActions(
	kind: CanvasGenerationContextNodeKind,
): CanvasGenerationContextAction[] {
	switch (kind) {
		case "image":
			return [
				{ label: "编辑图片", operation: "image.edit" },
				{ label: "生成图片", operation: "image.generate" },
			];
		case "text":
			return [
				{ label: "生成文本", operation: "text.respond" },
				{ label: "用文字生成图片", operation: "image.generate" },
			];
		case "video":
			return [{ label: "生成视频", operation: "video.generate" }];
		case "audio":
			return [
				{ label: "生成语音", operation: "audio.speech" },
				{ label: "生成音效", operation: "audio.sfx" },
			];
		case "config":
			return [
				{ label: "生成图片", operation: "image.generate" },
				{ label: "编辑图片", operation: "image.edit" },
				{ label: "生成文本", operation: "text.respond" },
				{ label: "生成视频", operation: "video.generate" },
				{ label: "生成语音", operation: "audio.speech" },
				{ label: "生成音效", operation: "audio.sfx" },
			];
	}
}

export function defaultCanvasNodeGenerationOperation(
	kind: CanvasGenerationContextNodeKind,
) {
	return canvasNodeGenerationActions(kind)[0].operation;
}

export async function quoteCanvasGenerationBatch(
	request: CanvasGenerationBackendRequest,
	input: CanvasGenerationFanOutInput,
) {
	return quoteFanOutGeneration(asFanOutCaller(request), input);
}

export async function submitCanvasGenerationBatch(
	request: CanvasGenerationBackendRequest,
	quotes: CanvasGenerationFanOutQuoteProjection,
) {
	return submitQuotedFanOutGeneration(asFanOutCaller(request), quotes);
}

export function createCanvasGenerationBatchSnapshot(input: {
	quotes: CanvasGenerationFanOutQuoteProjection;
	submission: CanvasGenerationFanOutSubmissionProjection;
}): CanvasGenerationBatchSnapshot {
	const quotedByItemKey = new Map(
		input.quotes.items.flatMap((item) =>
			item.state === "quoted" && item.quote
				? [[item.itemKey, item] as const]
				: [],
		),
	);
	return {
		batchKey: input.submission.batchKey,
		confirmation: input.submission.confirmation,
		items: input.submission.items.map((item) => {
			const quoted = quotedByItemKey.get(item.itemKey);
			if (!quoted) {
				throw new Error(
					"Submitted fan-out item is missing its frozen quote input.",
				);
			}
			return {
				...(item.error ? { error: { code: item.error.code } } : {}),
				idempotencyKey: item.idempotencyKey,
				input: cloneCanvasGenerationMemberInput(quoted.input),
				itemKey: item.itemKey,
				...(item.job ? { job: cloneCanvasGenerationJob(item.job) } : {}),
				quote: cloneCanvasGenerationQuote(item.quote),
				state: item.state,
			};
		}),
		schemaVersion: 1,
		strategy: input.submission.strategy,
		totalEstimatedProviderCost: {
			...input.submission.totalEstimatedProviderCost,
		},
	};
}

export function selectCanvasGenerationBatchPrimary(
	snapshot: CanvasGenerationBatchSnapshot,
	jobId: string,
): CanvasGenerationBatchSnapshot {
	if (!snapshot.items.some((item) => item.job?.jobId === jobId))
		return snapshot;
	return { ...snapshot, primaryJobId: jobId };
}

/** Applies a canonical retry/cancel response to the durable host snapshot. */
export function applyCanvasGenerationBatchJobUpdate(input: {
	job: CoreCanvasGenerationJob;
	previousJobId: string;
	snapshot: CanvasGenerationBatchSnapshot;
}): CanvasGenerationBatchSnapshot {
	let updated = false;
	const items = input.snapshot.items.map((item) => {
		if (item.job?.jobId !== input.previousJobId) return item;
		updated = true;
		return {
			...item,
			job: cloneCanvasGenerationJob(input.job),
			state: "submitted" as const,
		};
	});
	if (!updated) return input.snapshot;
	return {
		...input.snapshot,
		items,
		...(input.snapshot.primaryJobId === input.previousJobId
			? { primaryJobId: input.job.jobId }
			: {}),
	};
}

/** Lets the host rehydrate the projection from its durable generation jobs. */
export function reconcileCanvasGenerationBatchJobs(
	snapshot: CanvasGenerationBatchSnapshot,
	jobs: readonly CoreCanvasGenerationJob[],
): CanvasGenerationBatchSnapshot {
	const jobsById = new Map(jobs.map((job) => [job.jobId, job]));
	return {
		...snapshot,
		items: snapshot.items.map((item) => {
			const next = item.job ? jobsById.get(item.job.jobId) : undefined;
			return next ? { ...item, job: cloneCanvasGenerationJob(next) } : item;
		}),
	};
}

export function canvasGenerationBatchSnapshotSummary(
	snapshot: CanvasGenerationBatchSnapshot,
) {
	const submitted = snapshot.items.filter(
		(item) => item.state === "submitted" && item.job,
	).length;
	return {
		failed: snapshot.items.length - submitted,
		submitted,
		total: snapshot.items.length,
	};
}

export async function retryCanvasGeneration(
	request: CanvasGenerationBackendRequest,
	input: { idempotencyKey: string; jobId: string; projectId: string },
) {
	return request<CoreCanvasGenerationJob>(
		"retryGeneration",
		{ jobId: input.jobId, projectId: input.projectId },
		{ idempotencyKey: input.idempotencyKey },
	);
}

export async function cancelCanvasGeneration(
	request: CanvasGenerationBackendRequest,
	input: { idempotencyKey: string; jobId: string; projectId: string },
) {
	return request<CoreCanvasGenerationJob>(
		"cancelGeneration",
		canvasGenerationCancelPayload(input.projectId, input.jobId),
		{ idempotencyKey: input.idempotencyKey },
	);
}

export function canvasGenerationJobView(job: CoreCanvasGenerationJob) {
	const presentation = canvasGenerationJobPresentation(job);
	return {
		billingLabel: presentation.billingLabel,
		detail: presentation.detail,
		progress: canvasGenerationProgress(job.status),
		retryable: job.status === "failed",
		statusLabel: presentation.statusLabel,
		cancellable: isCanvasGenerationCancellable(job.status),
	};
}

export function canvasGenerationProgress(status: string) {
	switch (status) {
		case "queued":
			return 20;
		case "accepted":
		case "running":
			return 55;
		case "delivery_pending":
			return 85;
		case "completed":
			return 100;
		case "cancelled":
		case "failed":
			return 0;
		default:
			return 10;
	}
}

export function canvasGenerationFailureMessage(code: string | undefined) {
	switch (code) {
		case "MODEL_UNAVAILABLE":
		case "MODEL_NOT_CONFIGURED":
			return "当前模型暂不可用，请重新获取报价。";
		case "QUOTE_EXPIRED":
			return "报价已失效，请重新获取报价。";
		default:
			return "本项未能完成，请稍后重试。";
	}
}

function asFanOutCaller(
	request: CanvasGenerationBackendRequest,
): CanvasGenerationFanOutCaller {
	return (action, input, options) => request(action, input, options);
}

function hasActiveGenerationModel(entry: CanvasGenerationCapability) {
	if (entry.activation !== "active" || !entry.modelId?.trim()) return false;
	return (
		!entry.operation.startsWith("audio.") ||
		entry.activationEvidence?.status === "live_verified"
	);
}

function hasCompleteAudioParameters(capability: CanvasGenerationCapability) {
	if (
		capability.operation !== "audio.speech" &&
		capability.operation !== "audio.sfx"
	)
		return true;
	const allowed = new Set(capability.allowedParameters);
	return REQUIRED_AUDIO_PARAMETERS[capability.operation].every((name) =>
		allowed.has(name),
	);
}

function modelLabel(entry: CanvasGenerationCapability, index: number) {
	const proposed = entry.modelLabel?.trim();
	return isSafeDisplayText(proposed) ? proposed : `可用模型 ${index + 1}`;
}

function unavailableModelReason(
	operation: CanvasGenerationOperation,
	entries: readonly CanvasGenerationCapability[],
) {
	if (operation.startsWith("audio.")) {
		return "音频能力尚未启用或未完成可用性验证。";
	}
	const supplied = entries
		.map((entry) => entry.unavailableReason?.trim())
		.find(isSafeDisplayText);
	return supplied ?? "当前没有可用模型。";
}

function isSafeDisplayText(value: string | undefined): value is string {
	if (!value || value.length > 120) return false;
	return !(
		/(?:asset|node|job|provider|deployment|object|key|workspace)[-_:/]/iu.test(
			value,
		) ||
		/\b[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}\b/iu.test(value) ||
		/^[A-Za-z0-9_-]{16,}$/u.test(value) ||
		httpsUrl.test(value)
	);
}

const httpsUrl = /https?:\/\//iu;

function cloneCanvasGenerationMemberInput(
	input: CanvasGenerationFanOutMemberInput,
): CanvasGenerationFanOutMemberInput {
	return {
		...input,
		inputAssets: input.inputAssets.map((asset) => ({ ...asset })),
		inputNodeBindings: input.inputNodeBindings.map((binding) => ({
			...binding,
		})),
		parameters: { ...input.parameters },
	};
}

function cloneCanvasGenerationQuote(
	quote: CoreCanvasGenerationQuote,
): CoreCanvasGenerationQuote {
	return {
		...quote,
		...(quote.estimatedProviderCost
			? { estimatedProviderCost: { ...quote.estimatedProviderCost } }
			: {}),
	};
}

function cloneCanvasGenerationJob(
	job: CoreCanvasGenerationJob,
): CoreCanvasGenerationJob {
	return {
		...job,
		...(job.deliverable?.kind === "asset"
			? {
					deliverable: {
						...job.deliverable,
						asset: { ...job.deliverable.asset },
					},
				}
			: {}),
		...(job.inputAssetIds ? { inputAssetIds: [...job.inputAssetIds] } : {}),
		...(job.inputNodeIds ? { inputNodeIds: [...job.inputNodeIds] } : {}),
		...(job.usage ? { usage: { ...job.usage } } : {}),
	};
}
