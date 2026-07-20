import type { CanvasGenerationOperation } from "@meiye/core/pro-studio-runtime";
import {
	CoreRemoteCall,
	CoreRemoteCallConfigurationError,
} from "./core-remote-call";

const coreOperations = [
	"image.generate",
	"image.edit",
	"text.respond",
	"video.generate",
	"audio.speech",
	"audio.sfx",
] as const satisfies readonly CanvasGenerationOperation[];

type CoreGenerationOperation = (typeof coreOperations)[number];
type CoreDataClass = "contains_face" | "pii" | "medical";

export interface CoreGenerationIdentity {
	workspaceId: string;
	userId: string;
	correlationId: string;
}

export interface CoreGenerationQuoteInput extends CoreGenerationIdentity {
	idempotencyKey: string;
	projectId: string;
	revisionId: string;
	operation: CanvasGenerationOperation;
	modelId?: string;
	prompt: string;
	dataClass: CoreDataClass[];
	parameters: Record<string, unknown>;
	inputAssets: Array<{
		assetId: string;
		role: "reference_image" | "reference_video" | "reference_audio" | "mask";
	}>;
	inputNodeBindings: Array<{
		assetId: string;
		nodeId: string;
		role: "reference_image" | "reference_video" | "reference_audio" | "mask";
	}>;
}

export interface CoreGenerationSubmitInput extends CoreGenerationQuoteInput {
	quoteId: string;
}

export interface CoreTextResponseInput extends CoreGenerationIdentity {
	idempotencyKey: string;
	prompt: string;
}

export interface CoreGenerationJobResult {
	jobId: string;
	status:
		| "queued"
		| "running"
		| "cancel_requested"
		| "cancelled"
		| "completed"
		| "unknown"
		| "failed";
	failureCode?: string;
	[key: string]: unknown;
}

export class CoreGenerationProviderError extends Error {
	constructor(
		readonly code: string,
		message: string,
		readonly options: { retryable: boolean; status?: number },
	) {
		super(message);
		this.name = "CoreGenerationProviderError";
	}
}

interface CoreGenerationProviderOptions {
	coreServiceToken: string;
	coreServiceUrl: string;
	fetcher?: typeof fetch;
}

export class CoreGenerationProvider {
	private readonly remoteCall: CoreRemoteCall;

	constructor(options: CoreGenerationProviderOptions) {
		try {
			this.remoteCall = new CoreRemoteCall(options);
		} catch (error) {
			if (
				error instanceof CoreRemoteCallConfigurationError &&
				error.reason === "service-token"
			) {
				throw new CoreGenerationProviderError(
					"CORE_SERVICE_TOKEN_REQUIRED",
					"Core generation requires a service token.",
					{ retryable: false },
				);
			}
			if (!(error instanceof CoreRemoteCallConfigurationError)) throw error;
			throw new CoreGenerationProviderError(
				"CORE_SERVICE_URL_INVALID",
				"Core generation requires a valid service URL.",
				{ retryable: false },
			);
		}
	}

	async submit(input: CoreGenerationSubmitInput) {
		const operation = requireCoreOperation(input.operation);
		const providerInput = coreProviderInput(input);
		const result = await this.request(
			input,
			"commands",
			{
				action: "canvas_generation_submit",
				module: "model-supply",
				payload: {
					...canvasGenerationPayload(input, operation, providerInput),
					quoteId: requireText(input.quoteId, "quoteId"),
				},
			},
			input.idempotencyKey,
		);
		return generationResult(result);
	}

	async respondText(input: CoreTextResponseInput) {
		const result = await this.request(
			input,
			"commands",
			{
				action: "submit_generation",
				module: "model-supply",
				payload: {
					dataClass: [],
					operation: "text.respond",
					prompt: requireText(input.prompt, "prompt"),
					selection: { mode: "auto" },
				},
			},
			input.idempotencyKey,
		);
		return generationResult(result) as CoreGenerationJobResult & {
			text?: string;
		};
	}

	async getJob(
		input: CoreGenerationIdentity & { jobId: string; projectId: string },
	) {
		const result = await this.request(input, "query", {
			action: "canvas_generation_job",
			module: "model-supply",
			payload: {
				jobId: requireText(input.jobId, "jobId"),
				projectId: requireText(input.projectId, "projectId"),
			},
		});
		return result as Record<string, unknown>;
	}

	async getCatalog(input: CoreGenerationIdentity) {
		return this.request(input, "query", {
			action: "canvas_generation_catalog",
			module: "model-supply",
			payload: {},
		});
	}

	async quote(input: CoreGenerationQuoteInput) {
		const providerInput = coreProviderInput(input);
		return this.request(
			input,
			"commands",
			{
				action: "canvas_generation_quote",
				module: "model-supply",
				payload: canvasGenerationPayload(
					input,
					requireCoreOperation(input.operation),
					providerInput,
				),
			},
			input.idempotencyKey,
		);
	}

	async listProjectGenerations(
		input: CoreGenerationIdentity & { projectId: string },
	) {
		return this.request(input, "query", {
			action: "canvas_generation_jobs",
			module: "model-supply",
			payload: { projectId: requireText(input.projectId, "projectId") },
		});
	}

	async cancel(
		input: CoreGenerationIdentity & {
			idempotencyKey: string;
			jobId: string;
			projectId: string;
		},
	) {
		return (await this.request(
			input,
			"commands",
			{
				action: "canvas_generation_cancel",
				module: "model-supply",
				payload: {
					jobId: requireText(input.jobId, "jobId"),
					projectId: requireText(input.projectId, "projectId"),
				},
			},
			input.idempotencyKey,
		)) as Record<string, unknown>;
	}

	private async request(
		identity: CoreGenerationIdentity,
		kind: "commands" | "query",
		body: Record<string, unknown>,
		idempotencyKey?: string,
	): Promise<unknown> {
		const workspaceId = requireText(identity.workspaceId, "workspaceId");
		const result = await this.remoteCall.request({
			body,
			identity: {
				correlationId: requireText(identity.correlationId, "correlationId"),
				userId: requireText(identity.userId, "userId"),
				workspaceId,
			},
			...(idempotencyKey === undefined
				? {}
				: {
						idempotencyKey: requireText(idempotencyKey, "idempotencyKey"),
					}),
			kind,
		});
		if (result.kind === "unreachable") {
			throw new CoreGenerationProviderError(
				"CORE_UNREACHABLE",
				`Core generation request failed: ${errorMessage(result.cause)}.`,
				{ retryable: true },
			);
		}
		if (result.kind === "non-json") {
			throw new CoreGenerationProviderError(
				"CORE_RESPONSE_INVALID",
				"Core generation returned a non-JSON response.",
				{
					retryable: result.status >= 500,
					status: result.status,
				},
			);
		}
		if (result.kind === "rejected") {
			const remote = remoteError(result.envelope);
			throw new CoreGenerationProviderError(
				remote.code ?? "CORE_GENERATION_REJECTED",
				remote.message ??
					`Core generation request failed with status ${result.status}.`,
				{
					retryable: result.status === 429 || result.status >= 500,
					status: result.status,
				},
			);
		}
		if (result.kind === "invalid-envelope") {
			throw new CoreGenerationProviderError(
				"CORE_RESPONSE_INVALID",
				"Core generation returned an invalid response envelope.",
				{ retryable: true, status: result.status },
			);
		}
		return result.data;
	}
}

function requireCoreOperation(
	operation: CanvasGenerationOperation,
): CoreGenerationOperation {
	if ((coreOperations as readonly string[]).includes(operation)) {
		return operation as CoreGenerationOperation;
	}
	throw new CoreGenerationProviderError(
		operation === "text.respond"
			? "CORE_TEXT_DELIVERABLE_UNSUPPORTED"
			: "CORE_OPERATION_UNSUPPORTED",
		`Core model-supply does not support Canvas operation ${operation}.`,
		{ retryable: false },
	);
}

function coreProviderInput(input: CoreGenerationQuoteInput) {
	const allowed = new Set([
		"width",
		"height",
		"durationSeconds",
		"ratio",
		"resolution",
		"generateAudio",
		"watermark",
		"maxOutputTokens",
		"temperature",
		"strength",
		"format",
		"language",
		"maxDurationSeconds",
		"speed",
		"tone",
		"voice",
	]);
	const unsupported = Object.keys(input.parameters).filter(
		(key) => !allowed.has(key),
	);
	if (unsupported.length > 0) {
		const code = input.operation.startsWith("image.")
			? "CORE_IMAGE_PARAMETERS_UNSUPPORTED"
			: input.operation === "video.generate"
				? "CORE_VIDEO_PARAMETERS_UNSUPPORTED"
				: "CORE_PARAMETER_UNSUPPORTED";
		throw new CoreGenerationProviderError(
			code,
			`Core model-supply does not support parameters: ${unsupported.sort().join(", ")}.`,
			{ retryable: false },
		);
	}
	const parameters: Record<string, number | string | boolean> = {};
	for (const key of ["width", "height", "durationSeconds"] as const) {
		const value = input.parameters[key];
		if (value === undefined) continue;
		if (!Number.isSafeInteger(value) || (value as number) <= 0) {
			throw new CoreGenerationProviderError(
				"CORE_PARAMETER_INVALID",
				`${key} must be a positive integer.`,
				{ retryable: false },
			);
		}
		parameters[key] = value as number;
	}
	for (const key of ["ratio", "resolution"] as const) {
		const value = input.parameters[key];
		if (value === undefined) continue;
		parameters[key] = requireText(value, key);
	}
	for (const key of ["generateAudio", "watermark"] as const) {
		const value = input.parameters[key];
		if (value === undefined) continue;
		if (typeof value !== "boolean") {
			throw new CoreGenerationProviderError(
				"CORE_PARAMETER_INVALID",
				`${key} must be a boolean.`,
				{ retryable: false },
			);
		}
		parameters[key] = value;
	}
	for (const key of ["maxOutputTokens"] as const) {
		const value = input.parameters[key];
		if (value === undefined) continue;
		if (!Number.isSafeInteger(value) || (value as number) <= 0) {
			throw new CoreGenerationProviderError(
				"CORE_PARAMETER_INVALID",
				`${key} must be a positive integer.`,
				{ retryable: false },
			);
		}
		parameters[key] = value as number;
	}
	if (input.parameters.temperature !== undefined) {
		const value = input.parameters.temperature;
		if (typeof value !== "number" || !Number.isFinite(value)) {
			throw new CoreGenerationProviderError(
				"CORE_PARAMETER_INVALID",
				"temperature must be a finite number.",
				{ retryable: false },
			);
		}
		parameters.temperature = value;
	}
	for (const key of ["strength", "speed", "maxDurationSeconds"] as const) {
		const value = input.parameters[key];
		if (value === undefined) continue;
		if (
			typeof value !== "number" ||
			!Number.isFinite(value) ||
			(key === "maxDurationSeconds" &&
				(!Number.isSafeInteger(value) || value <= 0))
		) {
			throw new CoreGenerationProviderError(
				"CORE_PARAMETER_INVALID",
				`${key} must be a valid number.`,
				{ retryable: false },
			);
		}
		parameters[key] = value;
	}
	for (const key of ["format", "language", "tone", "voice"] as const) {
		const value = input.parameters[key];
		if (value === undefined) continue;
		parameters[key] = requireText(value, key);
	}
	const inputAssets = input.inputAssets;
	const inputNodeBindings = input.inputNodeBindings;
	if (inputAssets.length > 0) {
		if (inputAssets.some(({ assetId }) => !assetId.trim())) {
			throw new CoreGenerationProviderError(
				"CORE_INPUT_ASSET_INVALID",
				"Core generation input asset IDs must be non-empty.",
				{ retryable: false },
			);
		}
	}
	if (
		inputNodeBindings.length !== inputAssets.length ||
		inputNodeBindings.some((binding, index) => {
			const asset = inputAssets[index];
			return (
				!binding.nodeId.trim() ||
				binding.assetId !== asset?.assetId ||
				binding.role !== asset.role
			);
		})
	) {
		throw new CoreGenerationProviderError(
			"CORE_INPUT_NODE_BINDING_INVALID",
			"Core generation node bindings must match input assets in order.",
			{ retryable: false },
		);
	}
	const pairedInputs = [
		...new Map(
			inputAssets.map((asset, index) => [
				`${asset.role}:${asset.assetId}`,
				{ asset, binding: inputNodeBindings[index] },
			]),
		).values(),
	];
	return {
		inputAssets: pairedInputs.map(({ asset }) => asset),
		inputNodeBindings: pairedInputs.map(({ binding }) => binding),
		parameters,
	};
}

function canvasGenerationPayload(
	input: CoreGenerationQuoteInput,
	operation: CoreGenerationOperation,
	providerInput: ReturnType<typeof coreProviderInput>,
) {
	return {
		dataClass: requireDataClass(input.dataClass),
		inputAssets: providerInput.inputAssets,
		inputNodeBindings: providerInput.inputNodeBindings,
		...(input.modelId === undefined
			? {}
			: { modelId: requireText(input.modelId, "modelId") }),
		operation,
		parameters: providerInput.parameters,
		projectId: requireText(input.projectId, "projectId"),
		prompt: requireText(input.prompt, "prompt"),
		revisionId: requireText(input.revisionId, "revisionId"),
	};
}

function requireDataClass(value: CoreDataClass[]) {
	const allowed = new Set<CoreDataClass>(["contains_face", "pii", "medical"]);
	if (value.some((item) => !allowed.has(item))) {
		throw new CoreGenerationProviderError(
			"CORE_DATA_CLASS_INVALID",
			"Core generation dataClass contains an unsupported value.",
			{ retryable: false },
		);
	}
	return [...new Set(value)].sort();
}

function generationResult(value: unknown): CoreGenerationJobResult {
	if (
		!isRecord(value) ||
		typeof value.jobId !== "string" ||
		!value.jobId ||
		![
			"queued",
			"running",
			"cancel_requested",
			"cancelled",
			"completed",
			"unknown",
			"failed",
		].includes(String(value.status))
	) {
		throw new CoreGenerationProviderError(
			"CORE_RESPONSE_INVALID",
			"Core generation returned an invalid job result.",
			{ retryable: true },
		);
	}
	return value as CoreGenerationJobResult;
}

function remoteError(value: unknown) {
	if (!isRecord(value) || !isRecord(value.error)) return {};
	return {
		code: typeof value.error.code === "string" ? value.error.code : undefined,
		message:
			typeof value.error.message === "string" ? value.error.message : undefined,
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireText(value: unknown, field: string) {
	if (typeof value !== "string" || !value.trim()) {
		throw new CoreGenerationProviderError(
			"CORE_REQUEST_INVALID",
			`${field} is required.`,
			{ retryable: false },
		);
	}
	return value.trim();
}

function errorMessage(error: unknown) {
	return error instanceof Error ? error.message : "unknown transport error";
}
