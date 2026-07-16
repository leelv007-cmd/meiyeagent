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
	operation: CanvasGenerationOperation;
	parameters: Record<string, boolean | number | string>;
	projectId: string;
	prompt: string;
	revisionId: string;
};

export interface CoreCanvasGenerationQuote {
	catalogRevisionId: string;
	createdAt: string;
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
	jobId: string;
	modelId: string;
	operation?: CanvasGenerationOperation;
	projectId: string;
	revisionId: string;
	status: string;
}

type CanvasAssetInput = { assetId: string; nodeType: string };

export function buildCanvasGenerationInput(input: {
	assets: CanvasAssetInput[];
	allowedParameters: readonly string[];
	maskAssetId: string;
	operation: CanvasGenerationOperation;
	projectId: string;
	prompt: string;
	ratio: string;
	revisionId: string;
}): CanvasGenerationRequest {
	const common = {
		projectId: input.projectId,
		prompt: input.prompt,
		revisionId: input.revisionId,
	};
	const assets = input.assets.map(roleBearingAsset).filter(isPresent);
	switch (input.operation) {
		case "image.generate":
			return {
				...common,
				inputAssets: assets
					.filter((asset) => asset.role === "reference_image")
					.slice(0, 20),
				operation: input.operation,
				parameters: supportedParameters(
					{ ratio: input.ratio },
					input.allowedParameters,
				),
			};
		case "image.edit":
			return {
				...common,
				inputAssets: [
					...assets
						.filter((asset) => asset.role === "reference_image")
						.slice(0, input.maskAssetId ? 19 : 20),
					...(input.maskAssetId
						? [{ assetId: input.maskAssetId, role: "mask" as const }]
						: []),
				],
				operation: input.operation,
				parameters: supportedParameters(
					{ ratio: input.ratio, strength: 0.7 },
					input.allowedParameters,
				),
			};
		case "text.respond":
			return {
				...common,
				inputAssets: assets
					.filter((asset) => asset.role === "reference_image")
					.slice(0, 8),
				operation: input.operation,
				parameters: supportedParameters(
					{ maxOutputTokens: 1200, temperature: 0.4 },
					input.allowedParameters,
				),
			};
		case "video.generate":
			return {
				...common,
				inputAssets: assets.slice(0, 8),
				operation: input.operation,
				parameters: supportedParameters(
					{
						generateAudio: false,
						ratio: input.ratio,
						watermark: false,
					},
					input.allowedParameters,
				),
			};
		case "audio.speech":
			return {
				...common,
				inputAssets: assets
					.filter((asset) => asset.role === "reference_audio")
					.slice(0, 1),
				operation: input.operation,
				parameters: supportedParameters(
					{
						format: "mp3",
						language: "zh-CN",
						maxDurationSeconds: 120,
						speed: 1,
						tone: "natural",
						voice: "default",
					},
					input.allowedParameters,
				),
			};
		case "audio.sfx":
			return {
				...common,
				inputAssets: assets
					.filter((asset) => asset.role === "reference_audio")
					.slice(0, 1),
				operation: input.operation,
				parameters: supportedParameters(
					{ durationSeconds: 10, format: "mp3" },
					input.allowedParameters,
				),
			};
	}
}

function supportedParameters(
	parameters: Record<string, boolean | number | string>,
	allowedParameters: readonly string[],
) {
	const allowed = new Set(allowedParameters);
	const supported = Object.fromEntries(
		Object.entries(parameters).filter(([name]) => allowed.has(name)),
	) as Record<string, boolean | number | string>;
	if (
		typeof parameters.ratio === "string" &&
		!allowed.has("ratio") &&
		allowed.has("width") &&
		allowed.has("height")
	) {
		const dimensions = ratioDimensions(parameters.ratio);
		if (dimensions) Object.assign(supported, dimensions);
	}
	return supported;
}

function ratioDimensions(ratio: string) {
	const match = /^(\d+):(\d+)$/u.exec(ratio.trim());
	if (!match) return null;
	const widthRatio = Number(match[1]);
	const heightRatio = Number(match[2]);
	if (!Number.isSafeInteger(widthRatio) || !Number.isSafeInteger(heightRatio)) {
		return null;
	}
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

function mediaNodeType(job: CoreCanvasGenerationJob) {
	if (job.operation?.startsWith("video.")) return "video";
	if (job.operation?.startsWith("audio.")) return "audio";
	return "image";
}

function isPresent<T>(value: T | null): value is T {
	return value !== null;
}
