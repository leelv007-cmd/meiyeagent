import { createHash, timingSafeEqual } from "node:crypto";
import {
	AdvancedCanvasProjectError,
	type AdvancedCanvasProjectService,
	CanvasAssetError,
	type CanvasAssetFacade,
	type CanvasGraph,
	type CanvasSessionService,
	LaunchCodeError,
	type SecurityRejectionAuditService,
	type SecurityRejectionObjectKind,
} from "@meiye/core/pro-studio";
import {
	AdvancedCanvasAdoptionError,
	type AdvancedCanvasAdoptionPort,
	type AgentAuditEvent,
	type CanvasAgentApplicationService,
	CanvasAgentError,
	type CanvasGenerationCatalogEntry,
	CanvasGenerationError,
	type ProStudioEntitlementApplicationService,
	ProStudioEntitlementError,
} from "@meiye/core/pro-studio-runtime";
import * as z from "zod";
import {
	CanvasRevisionExportError,
	type CanvasRevisionExportPort,
	exportUnavailablePort,
} from "./canvas-export";
import {
	type CanvasAdoptionTarget,
	CoreAdvancedCanvasAdoptionError,
} from "./core-adoption-client";
import {
	type CoreGenerationIdentity,
	type CoreGenerationProvider,
	CoreGenerationProviderError,
} from "./core-generation-provider";

type CanvasActionContract = {
	idempotency: "header" | "none";
	method: "GET" | "POST";
	path: `/api/canvas/${string}`;
	write: boolean;
};

export const CANVAS_ACTION_CONTRACTS = {
	adoptAdvancedCanvasOutput: contract("POST", "header", true),
	applyAgentOps: contract("POST", "header", true),
	cancelGeneration: contract("POST", "header", true),
	confirmAgent: contract("POST", "header", true),
	createCheckpoint: contract("POST", "header", true),
	createProject: contract("POST", "header", true),
	deleteProject: contract("POST", "header", true),
	duplicateProject: contract("POST", "header", true),
	exportCanvas: contract("POST", "header", true),
	getAsset: contract("POST", "none", false),
	getAssetDelivery: contract("GET", "none", false),
	getCatalog: contract("POST", "none", false),
	getGenerationJob: contract("POST", "none", false),
	getProStudioEntry: contract("POST", "none", false),
	getRevision: contract("POST", "none", false),
	getSessionContext: contract("POST", "none", false),
	listAdoptions: contract("POST", "none", false),
	listAdoptionTargets: contract("POST", "none", false),
	listAgentAudit: contract("POST", "none", false),
	listAssets: contract("POST", "none", false),
	listPrompts: contract("POST", "none", false),
	listProjectGenerations: contract("POST", "none", false),
	listProjects: contract("POST", "none", false),
	listRevisions: contract("POST", "none", false),
	listSecurityRejectionAudit: contract("POST", "none", false),
	loadProject: contract("POST", "none", false),
	planAgent: contract("POST", "header", true),
	persistLocalCanvasArtifact: contract("POST", "header", true),
	purchaseProStudio: contract("POST", "header", true),
	quoteGeneration: contract("POST", "header", true),
	retryGeneration: contract("POST", "header", true),
	renameProject: contract("POST", "header", true),
	restoreRevision: contract("POST", "header", true),
	saveProjectDraft: contract("POST", "header", true),
	submitGeneration: contract("POST", "header", true),
	streamTextGeneration: contract("POST", "none", true),
} as const satisfies Record<string, CanvasActionContract>;

export type CanvasM1Action = keyof typeof CANVAS_ACTION_CONTRACTS;

const jsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
	z.union([
		z.string(),
		z.number(),
		z.boolean(),
		z.null(),
		z.array(jsonValueSchema),
		z.record(z.string(), jsonValueSchema),
	]),
);

const graphSchema = z.strictObject({
	edges: z.array(
		z.strictObject({
			id: z.string().min(1).optional(),
			source: z.string().min(1),
			target: z.string().min(1),
			type: z.string().min(1).optional(),
		}),
	),
	nodes: z.array(
		z.strictObject({
			data: z.record(z.string(), jsonValueSchema),
			id: z.string().min(1),
			type: z.string().min(1),
		}),
	),
	schemaVersion: z.literal(1),
});

const emptySchema = z.strictObject({});
const projectIdSchema = z.strictObject({ projectId: z.string().min(1) });
const identifierSchema = z.string().min(1).max(200);
const cursorSchema = z.string().min(1).max(500);
const generationLineageFields = {
	checkpointId: identifierSchema.optional(),
	count: z.literal(1).optional(),
	itemId: identifierSchema.optional(),
	nodeId: identifierSchema.optional(),
};
const inputAssetSchema = z.strictObject({
	assetId: identifierSchema,
	role: z.enum([
		"reference_image",
		"reference_video",
		"reference_audio",
		"mask",
	]),
});
const inputAssetsFor = (
	roles: Array<z.infer<typeof inputAssetSchema>["role"]>,
	max: number,
) =>
	z
		.array(inputAssetSchema)
		.max(max)
		.refine(
			(assets) => assets.every((asset) => roles.includes(asset.role)),
			"Input Asset role is not supported for this operation.",
		);
const inputNodeBindingSchema = inputAssetSchema.extend({
	nodeId: identifierSchema,
});
const inputNodeBindingsFor = (
	roles: Array<z.infer<typeof inputAssetSchema>["role"]>,
	max: number,
) =>
	z
		.array(inputNodeBindingSchema)
		.max(max)
		.refine(
			(bindings) => bindings.every((binding) => roles.includes(binding.role)),
			"Input node role is not supported for this operation.",
		)
		.optional();
const generationInputSchema = z.discriminatedUnion("operation", [
	z.strictObject({
		...generationLineageFields,
		inputAssets: inputAssetsFor(["reference_image"], 20),
		inputNodeBindings: inputNodeBindingsFor(["reference_image"], 20),
		modelId: identifierSchema.optional(),
		operation: z.literal("image.generate"),
		parameters: z.strictObject({
			height: z.number().int().positive().max(4096).optional(),
			quality: z.enum(["standard", "high"]).optional(),
			ratio: z.string().min(1).max(20).optional(),
			resolution: z.string().min(1).max(30).optional(),
			width: z.number().int().positive().max(4096).optional(),
		}),
		projectId: identifierSchema,
		prompt: z.string().min(1).max(20_000),
		revisionId: identifierSchema,
	}),
	z.strictObject({
		...generationLineageFields,
		inputAssets: inputAssetsFor(["reference_image", "mask"], 20),
		inputNodeBindings: inputNodeBindingsFor(["reference_image", "mask"], 20),
		modelId: identifierSchema.optional(),
		operation: z.literal("image.edit"),
		parameters: z.strictObject({
			height: z.number().int().positive().max(4096).optional(),
			quality: z.enum(["standard", "high"]).optional(),
			ratio: z.string().min(1).max(20).optional(),
			resolution: z.string().min(1).max(30).optional(),
			strength: z.number().min(0).max(1).optional(),
			width: z.number().int().positive().max(4096).optional(),
		}),
		projectId: identifierSchema,
		prompt: z.string().min(1).max(20_000),
		revisionId: identifierSchema,
	}),
	z.strictObject({
		...generationLineageFields,
		inputAssets: inputAssetsFor(["reference_image"], 8),
		inputNodeBindings: inputNodeBindingsFor(["reference_image"], 8),
		modelId: identifierSchema.optional(),
		operation: z.literal("text.respond"),
		parameters: z.strictObject({
			maxOutputTokens: z.number().int().positive().max(16_000).optional(),
			temperature: z.number().min(0).max(2).optional(),
		}),
		projectId: identifierSchema,
		prompt: z.string().min(1).max(40_000),
		revisionId: identifierSchema,
	}),
	z.strictObject({
		...generationLineageFields,
		inputAssets: inputAssetsFor(
			["reference_image", "reference_video", "reference_audio"],
			8,
		),
		inputNodeBindings: inputNodeBindingsFor(
			["reference_image", "reference_video", "reference_audio"],
			8,
		),
		modelId: identifierSchema.optional(),
		operation: z.literal("video.generate"),
		parameters: z.strictObject({
			durationSeconds: z.number().int().positive().max(120).optional(),
			generateAudio: z.boolean().optional(),
			ratio: z.string().min(1).max(20).optional(),
			resolution: z.string().min(1).max(30).optional(),
			watermark: z.boolean().optional(),
		}),
		projectId: identifierSchema,
		prompt: z.string().min(1).max(20_000),
		revisionId: identifierSchema,
	}),
	z.strictObject({
		...generationLineageFields,
		inputAssets: inputAssetsFor(["reference_audio"], 1),
		inputNodeBindings: inputNodeBindingsFor(["reference_audio"], 1),
		modelId: identifierSchema.optional(),
		operation: z.literal("audio.speech"),
		parameters: z.strictObject({
			format: z.enum(["mp3", "wav"]),
			language: z.string().min(2).max(20),
			maxDurationSeconds: z.number().int().positive().max(600),
			speed: z.number().min(0.5).max(2),
			tone: z.string().min(1).max(100),
			voice: z.string().min(1).max(100),
		}),
		projectId: identifierSchema,
		prompt: z.string().min(1).max(20_000),
		revisionId: identifierSchema,
	}),
	z.strictObject({
		...generationLineageFields,
		inputAssets: inputAssetsFor(["reference_audio"], 1),
		inputNodeBindings: inputNodeBindingsFor(["reference_audio"], 1),
		modelId: identifierSchema.optional(),
		operation: z.literal("audio.sfx"),
		parameters: z.strictObject({
			durationSeconds: z.number().int().positive().max(120),
			format: z.enum(["mp3", "wav"]),
		}),
		projectId: identifierSchema,
		prompt: z.string().min(1).max(20_000),
		revisionId: identifierSchema,
	}),
]);
const schemas = {
	adoptAdvancedCanvasOutput: z.strictObject({
		projectId: identifierSchema,
		revisionRef: z.discriminatedUnion("kind", [
			z.strictObject({
				kind: z.literal("frozen"),
				revisionId: identifierSchema,
			}),
			z.strictObject({
				expectedDraftVersion: z.number().int().positive(),
				kind: z.literal("freeze_current_draft"),
			}),
		]),
		selection: z.strictObject({
			orderedMediaNodeIds: z.array(identifierSchema).min(1).max(100),
			textNodeId: identifierSchema.optional(),
		}),
		target: z.discriminatedUnion("kind", [
			z.strictObject({ kind: z.literal("new_package") }),
			z.strictObject({
				baseVersionId: identifierSchema,
				expectedRevision: z.number().int().nonnegative(),
				kind: z.literal("existing_package"),
				packageId: identifierSchema,
			}),
		]),
	}),
	applyAgentOps: z.strictObject({
		credentialId: identifierSchema,
		expectedRevision: z.number().int().positive(),
		projectId: identifierSchema,
	}),
	cancelGeneration: z.strictObject({
		jobId: identifierSchema,
		projectId: identifierSchema,
	}),
	confirmAgent: z.strictObject({ planId: identifierSchema }),
	createCheckpoint: z.strictObject({
		expectedDraftVersion: z.number().int().positive(),
		label: z.string().max(200).optional(),
		projectId: z.string().min(1),
	}),
	createProject: z.strictObject({
		graph: graphSchema.optional(),
		name: z.string().min(1).max(120),
	}),
	deleteProject: projectIdSchema,
	duplicateProject: z.strictObject({
		name: z.string().min(1).max(120).optional(),
		projectId: z.string().min(1),
	}),
	exportCanvas: z.strictObject({
		format: z.enum(["json", "zip"]),
		includeAvailableOnly: z.literal(true).optional(),
		projectId: identifierSchema,
		revisionId: identifierSchema,
	}),
	getAsset: z.strictObject({ assetId: z.string().min(1) }),
	getAssetDelivery: z.strictObject({
		assetId: z.string().min(1),
		download: z.enum(["0", "1"]).optional(),
	}),
	getCatalog: emptySchema,
	getGenerationJob: z.strictObject({
		jobId: identifierSchema,
		projectId: identifierSchema,
	}),
	getProStudioEntry: emptySchema,
	getRevision: z.strictObject({
		projectId: z.string().min(1),
		revisionId: z.string().min(1),
	}),
	getSessionContext: emptySchema,
	listAdoptions: projectIdSchema,
	listAdoptionTargets: z.strictObject({
		cursor: cursorSchema.optional(),
		query: z.string().max(200).optional(),
	}),
	listAgentAudit: projectIdSchema,
	listAssets: z.strictObject({
		cursor: cursorSchema.optional(),
		kind: z.enum(["audio", "image", "video"]).optional(),
		query: z.string().max(200).optional(),
	}),
	listPrompts: z.strictObject({
		category: z.string().max(100).optional(),
		cursor: cursorSchema.optional(),
		query: z.string().max(200).optional(),
	}),
	listProjectGenerations: projectIdSchema,
	listProjects: emptySchema,
	listRevisions: projectIdSchema,
	listSecurityRejectionAudit: emptySchema,
	loadProject: projectIdSchema,
	planAgent: z.strictObject({
		intent: z.string().min(1).max(10_000),
		maxCostMicros: z.number().int().min(0).max(1_000_000_000),
		maxGenerationCount: z.number().int().min(0).max(20),
		projectId: identifierSchema,
	}),
	persistLocalCanvasArtifact: z.strictObject({
		bytesBase64: z.string().min(1).max(35_000_000),
		contentType: z.enum([
			"audio/mpeg",
			"audio/wav",
			"image/jpeg",
			"image/png",
			"image/webp",
			"video/mp4",
		]),
		derivation: z.enum(["crop", "mask", "retouch", "split", "upscale"]),
		fileName: z.string().min(1).max(200),
		legacyStorageKey: z.string().min(1).max(500).optional(),
		parentAssetId: z.string().min(1).optional(),
	}),
	purchaseProStudio: z.strictObject({
		offerId: identifierSchema,
		paymentEventId: identifierSchema,
	}),
	quoteGeneration: generationInputSchema,
	retryGeneration: z.strictObject({
		jobId: identifierSchema,
		projectId: identifierSchema,
	}),
	renameProject: z.strictObject({
		name: z.string().min(1).max(120),
		projectId: z.string().min(1),
	}),
	restoreRevision: z.strictObject({
		expectedDraftVersion: z.number().int().positive(),
		projectId: z.string().min(1),
		revisionId: z.string().min(1),
	}),
	saveProjectDraft: z.strictObject({
		expectedDraftVersion: z.number().int().positive(),
		graph: graphSchema,
		projectId: z.string().min(1),
	}),
	submitGeneration: z.strictObject({
		input: generationInputSchema,
		quoteId: identifierSchema,
	}),
	streamTextGeneration: z.strictObject({
		jobId: identifierSchema,
		projectId: identifierSchema,
	}),
} as const satisfies Record<CanvasM1Action, z.ZodType>;

const forbiddenFields = new Set([
	"apiKey",
	"baseUrl",
	"channelId",
	"pollUrl",
	"providerPath",
	"requestTemplate",
	"serverUrl",
]);

const MEBIBYTE = 1024 * 1024;
const SAFE_REQUEST_ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u;
const STANDARD_BODY_BUDGET = {
	maxBytes: MEBIBYTE,
	maxDepth: 64,
	maxNodes: 50_000,
};
const GRAPH_BODY_BUDGET = {
	maxBytes: 8 * MEBIBYTE,
	maxDepth: 128,
	maxNodes: 150_000,
};
const MEDIA_BODY_BUDGET = {
	maxBytes: 36 * MEBIBYTE,
	maxDepth: 64,
	maxNodes: 10_000,
};

export interface CanvasBackendRuntimePorts {
	adoption: AdvancedCanvasAdoptionPort;
	adoptionTargets?: {
		list(input: CoreGenerationIdentity): Promise<CanvasAdoptionTarget[]>;
	};
	agent: {
		audit: {
			list(input: {
				projectId: string;
				userId: string;
				workspaceId: string;
			}): Promise<AgentAuditEvent[]>;
		};
		service: Pick<CanvasAgentApplicationService, "apply" | "confirm" | "plan">;
	};
	entitlement: {
		resolveRole(input: {
			userId: string;
			workspaceId: string;
		}): Promise<"operator" | "owner" | "reviewer" | null>;
		service: Pick<
			ProStudioEntitlementApplicationService,
			"assertCanEnter" | "assertCanGenerate" | "getEntry" | "purchase"
		>;
	};
	generation: {
		catalog: {
			list(input: CoreGenerationIdentity): Promise<{
				agent: { activation: "active" | "inactive"; reason?: string };
				operations: Array<
					CanvasGenerationCatalogEntry & { unavailableReason?: string }
				>;
			}>;
		};
		core: Pick<
			CoreGenerationProvider,
			| "cancel"
			| "getCatalog"
			| "getJob"
			| "listProjectGenerations"
			| "quote"
			| "retry"
			| "streamCanvasText"
			| "submit"
		>;
	};
	exports?: CanvasRevisionExportPort;
	prompts?: {
		list(input: CoreGenerationIdentity): Promise<
			Array<{
				category?: string;
				id: string;
				prompt: string;
				title: string;
			}>
		>;
	};
	securityAudit: Pick<SecurityRejectionAuditService, "list" | "record">;
	workspace?: {
		displayName(input: {
			userId: string;
			workspaceId: string;
		}): Promise<string | null>;
	};
}

interface CanvasBackendPortOptions extends CanvasBackendRuntimePorts {
	allowedOrigin?: string;
	assets: CanvasAssetFacade;
	projects: AdvancedCanvasProjectService;
	sessions: CanvasSessionService;
}

class CanvasRuntimeError extends Error {
	constructor(
		readonly code: "WORKSPACE_FORBIDDEN",
		message: string,
	) {
		super(message);
	}
}

class CanvasContractError extends Error {
	constructor(
		readonly code:
			| "CATALOG_UNAVAILABLE"
			| "CONTENT_PACKAGE_LIST_UNAVAILABLE"
			| "INVALID_CURSOR"
			| "PROMPT_CATALOG_UNAVAILABLE",
		readonly status: 400 | 503,
		message: string,
	) {
		super(message);
		this.name = "CanvasContractError";
	}
}

class CanvasGenerationInputBindingError extends Error {
	readonly code = "GENERATION_INPUT_BINDING_INVALID";

	constructor(message: string) {
		super(message);
		this.name = "CanvasGenerationInputBindingError";
	}
}

class CanvasRequestBoundaryError extends Error {
	constructor(
		readonly status: 400 | 413,
		readonly code: "JSON_TOO_COMPLEX" | "REQUEST_BODY_TOO_LARGE",
		message: string,
	) {
		super(message);
		this.name = "CanvasRequestBoundaryError";
	}
}

export class CanvasBackendPort {
	private readonly allowedOrigin: string;

	constructor(private readonly options: CanvasBackendPortOptions) {
		this.allowedOrigin = options.allowedOrigin ?? "https://canvas.example.test";
	}

	async handle(
		action: string,
		request: Request,
		sessionToken: string | undefined,
	): Promise<Response> {
		const suppliedCorrelationId = request.headers.get("x-correlation-id");
		const correlationId =
			suppliedCorrelationId && SAFE_REQUEST_ID.test(suppliedCorrelationId)
				? suppliedCorrelationId
				: crypto.randomUUID();
		const disabledGrantLookup =
			action === "getProviderReferenceGrant" && request.method === "POST";
		if (!isCanvasAction(action) && !disabledGrantLookup) {
			return errorResponse(
				404,
				"NOT_FOUND",
				"Canvas action was not found.",
				correlationId,
			);
		}
		const actionContract = isCanvasAction(action)
			? CANVAS_ACTION_CONTRACTS[action]
			: undefined;
		if (actionContract && request.method !== actionContract.method) {
			return errorResponse(
				404,
				"NOT_FOUND",
				"Canvas action was not found.",
				correlationId,
			);
		}
		if (!sessionToken) {
			return errorResponse(
				401,
				"UNAUTHORIZED",
				"Canvas session is required.",
				correlationId,
			);
		}

		let rejectionContext:
			| { correlationId: string; userId: string; workspaceId: string }
			| undefined;
		let rejectionInput: unknown;
		try {
			const context = await this.options.sessions.authenticate(sessionToken);
			const role = await this.options.entitlement.resolveRole(context);
			if (!role) {
				throw new CanvasRuntimeError(
					"WORKSPACE_FORBIDDEN",
					"Workspace membership is required.",
				);
			}
			const runtimeContext = {
				correlationId,
				role,
				sessionId: createHash("sha256").update(sessionToken).digest("hex"),
				userId: context.userId,
				workspaceId: context.workspaceId,
			};
			rejectionContext = runtimeContext;
			if (disabledGrantLookup) {
				await this.options.entitlement.service.assertCanEnter(runtimeContext);
				const parsed = z
					.strictObject({ grantId: identifierSchema })
					.safeParse(await inputFor(request, "getCatalog"));
				if (!parsed.success) return opaqueObjectNotFound(correlationId);
				try {
					await this.options.securityAudit.record(runtimeContext, {
						objectKind: "grant",
						requestAction: action,
						targetId: parsed.data.grantId,
					});
				} catch {
					return securityAuditUnavailable(correlationId);
				}
				return opaqueObjectNotFound(correlationId);
			}
			if (!actionContract || !isCanvasAction(action)) {
				return opaqueObjectNotFound(correlationId);
			}
			if (requiresProStudioEntry(action)) {
				await this.options.entitlement.service.assertCanEnter(runtimeContext);
			}
			if (requiresGenerationEntitlement(action)) {
				await this.options.entitlement.service.assertCanGenerate(
					runtimeContext,
				);
			}
			if (actionContract.write) this.assertCsrf(request);
			const idempotencyKey = request.headers.get("idempotency-key")?.trim();
			if (actionContract.idempotency === "header" && !idempotencyKey) {
				return errorResponse(
					400,
					"IDEMPOTENCY_KEY_REQUIRED",
					"Idempotency-Key header is required.",
					correlationId,
				);
			}
			if (idempotencyKey && !SAFE_REQUEST_ID.test(idempotencyKey)) {
				return errorResponse(
					400,
					"INVALID_IDEMPOTENCY_KEY",
					"Idempotency-Key header is invalid.",
					correlationId,
				);
			}
			const rawInput = await inputFor(request, action);
			if (containsForbiddenField(rawInput)) {
				return errorResponse(
					400,
					"INVALID_INPUT",
					"Provider-routing fields are not accepted by the Canvas facade.",
					correlationId,
				);
			}
			const parsed = schemas[action].safeParse(rawInput);
			if (!parsed.success) {
				return errorResponse(
					400,
					"INVALID_INPUT",
					"Canvas action input is invalid.",
					correlationId,
				);
			}
			rejectionInput = parsed.data;
			const result = await this.execute(
				action,
				context,
				runtimeContext,
				parsed.data,
				request,
				idempotencyKey,
			);
			if (result instanceof Response) return result;
			return jsonResponse(200, result, correlationId);
		} catch (error) {
			const rejection = securityObjectRejection(action, rejectionInput, error);
			if (rejectionContext && rejection) {
				try {
					await this.options.securityAudit.record(rejectionContext, rejection);
				} catch {
					return securityAuditUnavailable(correlationId);
				}
				return opaqueObjectNotFound(correlationId);
			}
			return mappedError(error, correlationId);
		}
	}

	private assertCsrf(request: Request) {
		const origin = request.headers.get("origin");
		const fetchSite = request.headers.get("sec-fetch-site");
		const cookieToken = cookie(
			request.headers.get("cookie"),
			"__Host-canvas-csrf",
		);
		const headerToken = request.headers.get("x-csrf-token");
		if (
			origin !== this.allowedOrigin ||
			(fetchSite !== "same-origin" && fetchSite !== "same-site") ||
			!cookieToken ||
			!headerToken ||
			!safeEqual(cookieToken, headerToken)
		) {
			throw new CanvasSecurityError(
				"CSRF_REJECTED",
				"Canvas CSRF check failed.",
			);
		}
	}

	private async execute(
		action: CanvasM1Action,
		context: Awaited<ReturnType<CanvasSessionService["authenticate"]>>,
		runtimeContext: {
			correlationId: string;
			role: "operator" | "owner" | "reviewer";
			sessionId: string;
			userId: string;
			workspaceId: string;
		},
		input: unknown,
		request: Request,
		idempotencyKey: string | undefined,
	) {
		switch (action) {
			case "getSessionContext":
				return {
					workspaceDisplayName: await safeWorkspaceDisplayName(
						this.options.workspace,
						context,
					),
				};
			case "getProStudioEntry":
				return this.options.entitlement.service.getEntry(runtimeContext);
			case "purchaseProStudio": {
				const value = input as z.infer<(typeof schemas)["purchaseProStudio"]>;
				return this.options.entitlement.service.purchase(runtimeContext, {
					...value,
					idempotencyKey: requiredIdempotencyKey(idempotencyKey),
				});
			}
			case "getCatalog": {
				try {
					const [localCatalog, coreCatalog] = await Promise.all([
						this.options.generation.catalog.list(runtimeContext),
						this.options.generation.core.getCatalog(runtimeContext),
					]);
					return normalizedCanvasCatalog(coreCatalog, localCatalog.agent);
				} catch (error) {
					if (error instanceof CanvasContractError) throw error;
					throw new CanvasContractError(
						"CATALOG_UNAVAILABLE",
						503,
						"Canvas capability catalog is unavailable.",
					);
				}
			}
			case "quoteGeneration": {
				const value = input as z.infer<(typeof schemas)["quoteGeneration"]>;
				const revision = await this.options.projects.getRevision(
					context,
					value.projectId,
					value.revisionId,
				);
				const inputNodeBindings = validatedInputNodeBindings(
					value,
					revision.graph,
				);
				const frozen = freezeGenerationLineage(
					value,
					revision,
					inputNodeBindings,
				);
				return this.options.generation.core.quote({
					...runtimeContext,
					...frozen,
					dataClass: [],
					idempotencyKey: requiredIdempotencyKey(idempotencyKey),
					inputNodeBindings,
				});
			}
			case "submitGeneration": {
				const value = input as z.infer<(typeof schemas)["submitGeneration"]>;
				const revision = await this.options.projects.getRevision(
					context,
					value.input.projectId,
					value.input.revisionId,
				);
				const inputNodeBindings = validatedInputNodeBindings(
					value.input,
					revision.graph,
				);
				const frozen = freezeGenerationLineage(
					value.input,
					revision,
					inputNodeBindings,
				);
				return this.options.generation.core.submit({
					...runtimeContext,
					...frozen,
					dataClass: [],
					idempotencyKey: requiredIdempotencyKey(idempotencyKey),
					inputNodeBindings,
					quoteId: value.quoteId,
				});
			}
			case "getGenerationJob": {
				const value = input as z.infer<(typeof schemas)["getGenerationJob"]>;
				await this.options.projects.loadProject(context, value.projectId);
				return this.options.generation.core.getJob({
					...runtimeContext,
					...value,
				});
			}
			case "streamTextGeneration": {
				const value = input as z.infer<
					(typeof schemas)["streamTextGeneration"]
				>;
				const lastEventId = request.headers.get("last-event-id");
				await this.options.projects.loadProject(context, value.projectId);
				return this.options.generation.core.streamCanvasText({
					...runtimeContext,
					...value,
					...(lastEventId ? { lastEventId } : {}),
					signal: request.signal,
				});
			}
			case "retryGeneration": {
				const value = input as z.infer<(typeof schemas)["retryGeneration"]>;
				await this.options.projects.loadProject(context, value.projectId);
				return this.options.generation.core.retry({
					...runtimeContext,
					...value,
					idempotencyKey: requiredIdempotencyKey(idempotencyKey),
				});
			}
			case "listProjectGenerations": {
				const value = input as z.infer<
					(typeof schemas)["listProjectGenerations"]
				>;
				await this.options.projects.loadProject(context, value.projectId);
				return this.options.generation.core.listProjectGenerations({
					...runtimeContext,
					...value,
				});
			}
			case "cancelGeneration": {
				const value = input as z.infer<(typeof schemas)["cancelGeneration"]>;
				await this.options.projects.loadProject(context, value.projectId);
				return this.options.generation.core.cancel({
					...runtimeContext,
					...value,
					idempotencyKey: requiredIdempotencyKey(idempotencyKey),
				});
			}
			case "adoptAdvancedCanvasOutput":
				return this.options.adoption.adopt(runtimeContext, {
					...(input as z.infer<(typeof schemas)["adoptAdvancedCanvasOutput"]>),
					idempotencyKey: requiredIdempotencyKey(idempotencyKey),
				});
			case "listAdoptions":
				return this.options.adoption.listAdoptions(
					runtimeContext,
					(input as z.infer<(typeof schemas)["listAdoptions"]>).projectId,
				);
			case "listAdoptionTargets": {
				if (!this.options.adoptionTargets) {
					throw new CanvasContractError(
						"CONTENT_PACKAGE_LIST_UNAVAILABLE",
						503,
						"Canvas adoption targets are unavailable.",
					);
				}
				const value = input as z.infer<(typeof schemas)["listAdoptionTargets"]>;
				const targets = await this.options.adoptionTargets.list(runtimeContext);
				return cursorPage(
					targets
						.filter((target) => matchesQuery(target, value.query))
						.sort((left, right) =>
							left.handle.packageId.localeCompare(right.handle.packageId),
						),
					value.cursor,
				);
			}
			case "planAgent": {
				const value = input as z.infer<(typeof schemas)["planAgent"]>;
				return this.options.agent.service.plan(runtimeContext, {
					...value,
					idempotencyKey: requiredIdempotencyKey(idempotencyKey),
					sessionId: runtimeContext.sessionId,
				});
			}
			case "confirmAgent":
				return this.options.agent.service.confirm(runtimeContext, {
					idempotencyKey: requiredIdempotencyKey(idempotencyKey),
					planId: (input as z.infer<(typeof schemas)["confirmAgent"]>).planId,
					sessionId: runtimeContext.sessionId,
				});
			case "applyAgentOps": {
				const value = input as z.infer<(typeof schemas)["applyAgentOps"]>;
				return this.options.agent.service.apply(runtimeContext, {
					...value,
					idempotencyKey: requiredIdempotencyKey(idempotencyKey),
					sessionId: runtimeContext.sessionId,
				});
			}
			case "listAgentAudit": {
				const value = input as z.infer<(typeof schemas)["listAgentAudit"]>;
				return this.options.agent.audit.list({
					projectId: value.projectId,
					userId: runtimeContext.userId,
					workspaceId: runtimeContext.workspaceId,
				});
			}
			case "listProjects":
				return this.options.projects.listProjects(context);
			case "createProject": {
				const value = input as z.infer<(typeof schemas)["createProject"]>;
				return this.options.projects.createProject(context, {
					name: value.name,
					...(value.graph ? { graph: value.graph as CanvasGraph } : {}),
				});
			}
			case "renameProject":
				return this.options.projects.renameProject(
					context,
					input as z.infer<(typeof schemas)["renameProject"]>,
				);
			case "duplicateProject":
				return this.options.projects.duplicateProject(
					context,
					input as z.infer<(typeof schemas)["duplicateProject"]>,
				);
			case "exportCanvas": {
				const value = input as z.infer<(typeof schemas)["exportCanvas"]>;
				let revision: Awaited<
					ReturnType<AdvancedCanvasProjectService["getRevision"]>
				>;
				try {
					revision = await this.options.projects.getRevision(
						context,
						value.projectId,
						value.revisionId,
					);
				} catch (error) {
					if (
						error instanceof AdvancedCanvasProjectError &&
						error.code === "NOT_FOUND"
					) {
						throw new CanvasRevisionExportError(
							"REVISION_NOT_FOUND",
							"Canvas revision was not found.",
						);
					}
					throw error;
				}
				const artifact = await (
					this.options.exports ?? exportUnavailablePort()
				).export({
					idempotencyKey: requiredIdempotencyKey(idempotencyKey),
					includeAvailableOnly: value.includeAvailableOnly === true,
					revision,
					userId: runtimeContext.userId,
					workspaceId: runtimeContext.workspaceId,
				});
				if (value.format === "json") {
					return {
						manifest: artifact.manifest,
						manifestSha256: artifact.manifestSha256,
						zipSha256: artifact.zipSha256,
					};
				}
				return new Response(Uint8Array.from(artifact.zipBytes).buffer, {
					headers: {
						"cache-control": "private, no-store",
						"content-disposition": `attachment; filename="${artifact.fileName}"`,
						"content-type": artifact.contentType,
						"x-canvas-export-manifest-sha256": artifact.manifestSha256,
						"x-canvas-export-zip-sha256": artifact.zipSha256,
					},
				});
			}
			case "deleteProject":
				return this.options.projects.deleteProject(
					context,
					(input as z.infer<typeof projectIdSchema>).projectId,
				);
			case "loadProject": {
				const project = await this.options.projects.loadProject(
					context,
					(input as z.infer<typeof projectIdSchema>).projectId,
				);
				return {
					...project,
					graph: await this.options.assets.hydrateGraph(
						context.workspaceId,
						project.graph,
					),
				};
			}
			case "saveProjectDraft": {
				const value = input as z.infer<(typeof schemas)["saveProjectDraft"]>;
				return this.options.projects.saveProjectDraft(context, {
					...value,
					graph: value.graph as CanvasGraph,
				});
			}
			case "createCheckpoint":
				return this.options.projects.createCheckpoint(
					context,
					input as z.infer<(typeof schemas)["createCheckpoint"]>,
				);
			case "listRevisions":
				return this.options.projects.listRevisions(
					context,
					(input as z.infer<typeof projectIdSchema>).projectId,
				);
			case "listSecurityRejectionAudit":
				return this.options.securityAudit.list(runtimeContext);
			case "getRevision": {
				const value = input as z.infer<(typeof schemas)["getRevision"]>;
				return this.options.projects.getRevision(
					context,
					value.projectId,
					value.revisionId,
				);
			}
			case "restoreRevision":
				return this.options.projects.restoreRevision(
					context,
					input as z.infer<(typeof schemas)["restoreRevision"]>,
				);
			case "listAssets": {
				const value = input as z.infer<(typeof schemas)["listAssets"]>;
				const assets = await this.options.assets.listAssets(context);
				return cursorPage(
					assets
						.map((asset) => ({
							id: asset.id,
							kind: assetKind(asset.contentType),
							title: asset.fileName,
						}))
						.filter(
							(asset) =>
								(value.kind === undefined || asset.kind === value.kind) &&
								matchesQuery(asset, value.query),
						)
						.sort((left, right) => left.id.localeCompare(right.id)),
					value.cursor,
				);
			}
			case "listPrompts": {
				if (!this.options.prompts) {
					throw new CanvasContractError(
						"PROMPT_CATALOG_UNAVAILABLE",
						503,
						"Canvas prompt catalog is unavailable.",
					);
				}
				const value = input as z.infer<(typeof schemas)["listPrompts"]>;
				const prompts = await this.options.prompts.list(runtimeContext);
				return cursorPage(
					prompts
						.filter(
							(prompt) =>
								(value.category === undefined ||
									prompt.category === value.category) &&
								matchesQuery(prompt, value.query),
						)
						.sort((left, right) => left.id.localeCompare(right.id)),
					value.cursor,
				);
			}
			case "getAsset":
				return this.options.assets.getAsset(
					context,
					(input as z.infer<(typeof schemas)["getAsset"]>).assetId,
				);
			case "persistLocalCanvasArtifact": {
				const value = input as z.infer<
					(typeof schemas)["persistLocalCanvasArtifact"]
				>;
				return this.options.assets.persistLocalCanvasArtifact(context, {
					...value,
					bytes: Uint8Array.from(Buffer.from(value.bytesBase64, "base64")),
				});
			}
			case "getAssetDelivery": {
				const value = input as z.infer<(typeof schemas)["getAssetDelivery"]>;
				const delivery = await this.options.assets.getAssetDelivery(context, {
					assetId: value.assetId,
					download: value.download === "1",
					range: request.headers.get("range") ?? undefined,
				});
				return new Response(delivery.body, {
					headers: delivery.headers,
					status: delivery.status,
				});
			}
		}
	}
}

class CanvasSecurityError extends Error {
	constructor(
		readonly code: "CSRF_REJECTED",
		message: string,
	) {
		super(message);
	}
}

function contract(
	method: CanvasActionContract["method"],
	idempotency: CanvasActionContract["idempotency"],
	write: boolean,
) {
	return {
		idempotency,
		method,
		path: "" as `/api/canvas/${string}`,
		write,
	};
}

for (const [action, value] of Object.entries(CANVAS_ACTION_CONTRACTS)) {
	(value as CanvasActionContract).path = `/api/canvas/${action}`;
}

function isCanvasAction(action: string): action is CanvasM1Action {
	return Object.hasOwn(CANVAS_ACTION_CONTRACTS, action);
}

async function inputFor(request: Request, action: CanvasM1Action) {
	if (request.method === "GET") {
		return Object.fromEntries(new URL(request.url).searchParams.entries());
	}
	const budget = bodyBudgetFor(action);
	const text = await readTextUpTo(request, budget.maxBytes);
	if (!text) return {};
	try {
		const input = JSON.parse(text) as unknown;
		assertJsonComplexity(input, budget.maxDepth, budget.maxNodes);
		return input;
	} catch (error) {
		if (error instanceof CanvasRequestBoundaryError) throw error;
		return Symbol("invalid-json");
	}
}

function containsForbiddenField(value: unknown): boolean {
	const pending = [value];
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current || typeof current !== "object") continue;
		if (Array.isArray(current)) {
			pending.push(...current);
			continue;
		}
		for (const [key, child] of Object.entries(current)) {
			if (forbiddenFields.has(key)) return true;
			pending.push(child);
		}
	}
	return false;
}

function bodyBudgetFor(action: CanvasM1Action) {
	if (action === "persistLocalCanvasArtifact") return MEDIA_BODY_BUDGET;
	if (action === "createProject" || action === "saveProjectDraft") {
		return GRAPH_BODY_BUDGET;
	}
	return STANDARD_BODY_BUDGET;
}

async function readTextUpTo(request: Request, maxBytes: number) {
	const declaredLength = Number(request.headers.get("content-length"));
	if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
		throw new CanvasRequestBoundaryError(
			413,
			"REQUEST_BODY_TOO_LARGE",
			"Canvas request body exceeds the action limit.",
		);
	}
	if (!request.body) return "";

	const reader = request.body.getReader();
	const decoder = new TextDecoder();
	let bytesRead = 0;
	let text = "";
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		bytesRead += value.byteLength;
		if (bytesRead > maxBytes) {
			await reader.cancel();
			throw new CanvasRequestBoundaryError(
				413,
				"REQUEST_BODY_TOO_LARGE",
				"Canvas request body exceeds the action limit.",
			);
		}
		text += decoder.decode(value, { stream: true });
	}
	return text + decoder.decode();
}

function assertJsonComplexity(
	value: unknown,
	maxDepth: number,
	maxNodes: number,
) {
	const pending: Array<{ depth: number; value: unknown }> = [
		{ depth: 0, value },
	];
	let nodes = 0;
	while (pending.length > 0) {
		const current = pending.pop();
		if (!current) break;
		nodes += 1;
		if (current.depth > maxDepth || nodes > maxNodes) {
			throw new CanvasRequestBoundaryError(
				400,
				"JSON_TOO_COMPLEX",
				"Canvas request JSON exceeds the action complexity limit.",
			);
		}
		if (!current.value || typeof current.value !== "object") continue;
		const children = Array.isArray(current.value)
			? current.value
			: Object.values(current.value);
		for (const child of children) {
			pending.push({ depth: current.depth + 1, value: child });
		}
	}
}

function mappedError(error: unknown, correlationId: string) {
	if (error instanceof CanvasRequestBoundaryError) {
		return errorResponse(
			error.status,
			error.code,
			error.message,
			correlationId,
		);
	}
	if (errorCode(error) === "MAIN_SESSION_UNAVAILABLE") {
		return errorResponse(
			503,
			"MAIN_SESSION_UNAVAILABLE",
			"Main session validation is unavailable.",
			correlationId,
		);
	}
	if (error instanceof CanvasSecurityError) {
		return errorResponse(403, error.code, error.message, correlationId);
	}
	if (error instanceof CanvasGenerationInputBindingError) {
		return errorResponse(400, error.code, error.message, correlationId);
	}
	if (error instanceof CanvasContractError) {
		return errorResponse(
			error.status,
			error.code,
			error.message,
			correlationId,
		);
	}
	if (error instanceof CanvasRevisionExportError) {
		return errorResponse(
			error.code === "EXPORT_NOT_AVAILABLE" ? 503 : 404,
			error.code,
			error.message,
			correlationId,
		);
	}
	if (error instanceof CanvasRuntimeError) {
		return errorResponse(403, error.code, error.message, correlationId);
	}
	if (error instanceof CoreAdvancedCanvasAdoptionError) {
		return errorResponse(
			coreAdoptionErrorStatus(error),
			error.code,
			error.message,
			correlationId,
		);
	}
	if (error instanceof CoreGenerationProviderError) {
		return errorResponse(
			coreGenerationErrorStatus(error),
			error.code,
			error.message,
			correlationId,
		);
	}
	if (
		error instanceof CanvasGenerationError ||
		error instanceof AdvancedCanvasAdoptionError ||
		error instanceof ProStudioEntitlementError ||
		error instanceof CanvasAgentError
	) {
		return errorResponse(
			runtimeErrorStatus(error.code),
			error.code,
			error.message,
			correlationId,
		);
	}
	if (error instanceof LaunchCodeError) {
		const status = error.code === "SESSION_EXPIRED" ? 401 : 403;
		return errorResponse(status, error.code, error.message, correlationId);
	}
	if (error instanceof AdvancedCanvasProjectError) {
		const status =
			error.code === "NOT_FOUND"
				? 404
				: error.code === "DRAFT_VERSION_CONFLICT"
					? 409
					: 400;
		return errorResponse(status, error.code, error.message, correlationId);
	}
	if (error instanceof CanvasAssetError) {
		const status =
			error.code === "NOT_FOUND"
				? 404
				: error.code === "RANGE_NOT_SATISFIABLE"
					? 416
					: 400;
		return errorResponse(status, error.code, error.message, correlationId);
	}
	return errorResponse(
		500,
		"INTERNAL_ERROR",
		"Canvas action failed.",
		correlationId,
	);
}

function validatedInputNodeBindings(
	input: z.infer<typeof generationInputSchema>,
	graph: CanvasGraph,
) {
	const bindings = input.inputNodeBindings ?? [];
	if (bindings.length !== input.inputAssets.length) {
		throw new CanvasGenerationInputBindingError(
			"Every generation input asset requires one same-order Canvas node binding.",
		);
	}
	const nodesById = new Map(graph.nodes.map((node) => [node.id, node]));
	for (const [index, asset] of input.inputAssets.entries()) {
		const binding = bindings[index];
		if (
			!binding ||
			binding.assetId !== asset.assetId ||
			binding.role !== asset.role
		) {
			throw new CanvasGenerationInputBindingError(
				"Generation input node bindings must match input asset order, IDs, and roles.",
			);
		}
		const node = nodesById.get(binding.nodeId);
		if (!node || node.data.assetId !== binding.assetId) {
			throw new CanvasGenerationInputBindingError(
				"Generation input node bindings must reference matching assets in the frozen revision.",
			);
		}
	}
	return bindings;
}

function freezeGenerationLineage(
	input: z.infer<typeof generationInputSchema>,
	revision: { id: string; graph: CanvasGraph },
	inputNodeBindings: ReturnType<typeof validatedInputNodeBindings>,
) {
	const checkpointId = input.checkpointId ?? revision.id;
	if (checkpointId !== revision.id) {
		throw new CanvasGenerationInputBindingError(
			"Canvas generation checkpointId must be the frozen revision checkpoint.",
		);
	}
	if (
		input.nodeId &&
		!revision.graph.nodes.some((node) => node.id === input.nodeId)
	) {
		throw new CanvasGenerationInputBindingError(
			"Canvas generation nodeId must exist in the frozen revision.",
		);
	}
	const nodeId = input.nodeId ?? inputNodeBindings[0]?.nodeId;
	const itemId = input.itemId;
	if (!nodeId && !itemId) {
		throw new CanvasGenerationInputBindingError(
			"Canvas generation requires a real frozen nodeId or itemId.",
		);
	}
	return {
		...input,
		checkpointId,
		count: input.count ?? 1,
		...(itemId ? { itemId } : {}),
		...(nodeId ? { nodeId } : {}),
	};
}

const CANVAS_GENERATION_OPERATIONS = [
	"audio.sfx",
	"audio.speech",
	"image.edit",
	"image.generate",
	"text.respond",
	"video.generate",
] as const;

const CANVAS_UNAVAILABLE_REASONS = new Set([
	"CATALOG_UNAVAILABLE",
	"MODEL_DISABLED",
	"MODEL_NOT_CONFIGURED",
	"OPERATION_UNAVAILABLE",
	"WORKSPACE_NOT_ENTITLED",
]);

function normalizedCanvasCatalog(
	value: unknown,
	agent: { activation: "active" | "inactive"; reason?: string },
) {
	const catalog = plainRecord(value);
	const revisionId = safeText(catalog?.revisionId);
	if (!catalog || !revisionId) {
		throw new CanvasContractError(
			"CATALOG_UNAVAILABLE",
			503,
			"Canvas capability catalog is unavailable.",
		);
	}
	const rawDefaults = plainRecord(catalog.defaultModelIdByOperation);
	const rawReasons = plainRecord(catalog.unavailableReasonCodeByOperation);
	const rawOperations = Array.isArray(catalog.operations)
		? catalog.operations
				.map(plainRecord)
				.filter(
					(operation): operation is Record<string, unknown> =>
						operation !== null,
				)
		: [];
	const byOperation = new Map(
		rawOperations
			.filter((operation) => isCanvasGenerationOperation(operation.operation))
			.sort((left, right) => {
				const byOperation = String(left.operation).localeCompare(
					String(right.operation),
				);
				if (byOperation !== 0) return byOperation;
				return String(left.modelId ?? "").localeCompare(
					String(right.modelId ?? ""),
				);
			})
			.map((operation) => [String(operation.operation), operation]),
	);
	const defaultModelIdByOperation: Record<string, string> = {};
	const unavailableReasonCodeByOperation: Record<string, string> = {};
	const operations = CANVAS_GENERATION_OPERATIONS.map((operation) => {
		const source = byOperation.get(operation);
		const defaultModelId = safeText(rawDefaults?.[operation]);
		const explicitReason = safeUnavailableReason(rawReasons?.[operation]);
		const active = source?.activation === "active";
		const sourceModelId = safeText(source?.modelId);
		const unavailableReason =
			explicitReason ??
			(!active
				? "OPERATION_UNAVAILABLE"
				: !defaultModelId
					? "MODEL_NOT_CONFIGURED"
					: sourceModelId !== defaultModelId
						? "MODEL_DISABLED"
						: undefined);
		if (unavailableReason) {
			unavailableReasonCodeByOperation[operation] = unavailableReason;
		} else if (defaultModelId) {
			defaultModelIdByOperation[operation] = defaultModelId;
		}
		return {
			activation: unavailableReason
				? ("inactive" as const)
				: ("active" as const),
			allowedInputAssetRoles: stringArray(source?.allowedInputAssetRoles),
			allowedParameters: stringArray(source?.allowedParameters),
			...(sourceModelId ? { modelId: sourceModelId } : { modelId: null }),
			operation,
			output: canvasOperationOutput(operation),
			usageAmount:
				typeof source?.usageAmount === "number" && !unavailableReason
					? source.usageAmount
					: 0,
			usageResource:
				typeof source?.usageResource === "string"
					? source.usageResource
					: canvasOperationOutput(operation),
		};
	});
	return {
		agent: {
			activation: agent.activation,
			...(agent.reason ? { reason: agent.reason } : {}),
		},
		defaultModelIdByOperation,
		models: normalizedCatalogModels(catalog.models),
		operations,
		revisionId,
		...(catalog.schema && typeof catalog.schema === "object"
			? { schema: structuredClone(catalog.schema) }
			: {}),
		unavailableReasonCodeByOperation,
	};
}

function normalizedCatalogModels(value: unknown) {
	if (!Array.isArray(value)) return [];
	return value
		.map(plainRecord)
		.filter((model): model is Record<string, unknown> => model !== null)
		.map((model) => ({
			active: model.active === true,
			capabilities: stringArray(model.capabilities),
			displayName: safeText(model.displayName) ?? safeText(model.id) ?? "Model",
			id: safeText(model.id) ?? "",
		}))
		.filter((model) => model.id.length > 0)
		.sort((left, right) => left.id.localeCompare(right.id));
}

function canvasOperationOutput(
	operation: (typeof CANVAS_GENERATION_OPERATIONS)[number],
) {
	if (operation.startsWith("image.")) return "image";
	if (operation === "text.respond") return "text";
	if (operation === "video.generate") return "video";
	return "audio";
}

function isCanvasGenerationOperation(
	value: unknown,
): value is (typeof CANVAS_GENERATION_OPERATIONS)[number] {
	return (
		typeof value === "string" &&
		(CANVAS_GENERATION_OPERATIONS as readonly string[]).includes(value)
	);
}

function safeUnavailableReason(value: unknown) {
	return typeof value === "string" && CANVAS_UNAVAILABLE_REASONS.has(value)
		? value
		: undefined;
}

function stringArray(value: unknown) {
	return Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: [];
}

function plainRecord(value: unknown) {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: null;
}

function safeText(value: unknown) {
	return typeof value === "string" && value.trim().length > 0
		? value.trim()
		: undefined;
}

async function safeWorkspaceDisplayName(
	workspace: CanvasBackendRuntimePorts["workspace"],
	context: { userId: string; workspaceId: string },
) {
	try {
		const value = await workspace?.displayName(context);
		const displayName = safeText(value);
		if (
			displayName &&
			displayName !== context.workspaceId &&
			displayName.length <= 200
		) {
			return displayName;
		}
	} catch {
		// The bootstrap seam must not expose a raw workspace identifier on failure.
	}
	return "Workspace";
}

const CURSOR_PAGE_SIZE = 50;

function cursorPage<T extends { id: string }>(items: T[], cursor?: string) {
	const cursorId = cursor ? decodeCursor(cursor) : undefined;
	const start = cursorId
		? items.findIndex((item) => item.id === cursorId) + 1
		: 0;
	if (cursorId && start === 0) {
		throw new CanvasContractError(
			"INVALID_CURSOR",
			400,
			"Canvas list cursor is invalid.",
		);
	}
	const page = items.slice(start, start + CURSOR_PAGE_SIZE);
	const last = page.at(-1);
	return {
		items: page,
		nextCursor:
			last && start + CURSOR_PAGE_SIZE < items.length
				? encodeCursor(last.id)
				: null,
	};
}

function encodeCursor(id: string) {
	return Buffer.from(id, "utf8").toString("base64url");
}

function decodeCursor(value: string) {
	try {
		const decoded = Buffer.from(value, "base64url").toString("utf8");
		if (!decoded || decoded.length > 200 || encodeCursor(decoded) !== value) {
			throw new Error("invalid cursor");
		}
		return decoded;
	} catch {
		throw new CanvasContractError(
			"INVALID_CURSOR",
			400,
			"Canvas list cursor is invalid.",
		);
	}
}

function matchesQuery(
	item: { id: string; title: string },
	query: string | undefined,
) {
	if (!query?.trim()) return true;
	const needle = query.trim().toLocaleLowerCase();
	return (
		item.id.toLocaleLowerCase().includes(needle) ||
		item.title.toLocaleLowerCase().includes(needle)
	);
}

function assetKind(contentType: string) {
	if (contentType.startsWith("audio/")) return "audio" as const;
	if (contentType.startsWith("video/")) return "video" as const;
	return "image" as const;
}

function securityObjectRejection(
	action: string,
	input: unknown,
	error: unknown,
):
	| {
			objectKind: SecurityRejectionObjectKind;
			requestAction: string;
			targetId: string;
	  }
	| undefined {
	const code = errorCode(error);
	if (action === "exportCanvas" && code === "REVISION_NOT_FOUND") {
		return undefined;
	}
	if (!code || !opaqueRejectionCode(code)) return undefined;
	const value = input as Record<string, unknown> | undefined;
	if (!value) return undefined;
	if (action === "loadProject") {
		return rejection("project", action, value.projectId);
	}
	if (action === "getRevision") {
		return rejection("revision", action, value.revisionId);
	}
	if (action === "exportCanvas") {
		return rejection("revision", action, value.revisionId);
	}
	if (action === "getAsset") {
		return rejection("asset", action, value.assetId);
	}
	if (action === "getGenerationJob" || action === "retryGeneration") {
		return rejection("job", action, value.jobId);
	}
	if (action === "applyAgentOps") {
		return rejection("confirmation", action, value.credentialId);
	}
	if (action === "adoptAdvancedCanvasOutput") {
		const target = value.target as Record<string, unknown> | undefined;
		if (target?.kind === "existing_package") {
			return rejection("package", action, target.packageId);
		}
	}
	return undefined;
}

function rejection(
	objectKind: SecurityRejectionObjectKind,
	requestAction: string,
	targetId: unknown,
) {
	return typeof targetId === "string" && targetId
		? { objectKind, requestAction, targetId }
		: undefined;
}

function opaqueRejectionCode(code: string) {
	return code === "NOT_FOUND" || code.includes("NOT_FOUND");
}

function opaqueObjectNotFound(correlationId: string) {
	return errorResponse(
		404,
		"NOT_FOUND",
		"Canvas object was not found.",
		correlationId,
	);
}

function securityAuditUnavailable(correlationId: string) {
	return errorResponse(
		503,
		"SECURITY_AUDIT_UNAVAILABLE",
		"Security rejection audit is unavailable.",
		correlationId,
	);
}

function coreAdoptionErrorStatus(error: CoreAdvancedCanvasAdoptionError) {
	if (
		error.code.startsWith("CORE_") ||
		error.code === "UNAUTHORIZED_SERVICE" ||
		error.status >= 500
	) {
		return 503;
	}
	return [400, 403, 404, 409].includes(error.status) ? error.status : 400;
}

function coreGenerationErrorStatus(error: CoreGenerationProviderError) {
	const status = error.options.status;
	if (status !== undefined) {
		if (status >= 500) return 503;
		if ([400, 403, 404, 409, 429].includes(status)) return status;
	}
	if (error.code.startsWith("CORE_") && error.options.retryable) return 503;
	return runtimeErrorStatus(error.code);
}

function errorCode(error: unknown) {
	if (!error || typeof error !== "object" || !("code" in error)) return null;
	return typeof error.code === "string" ? error.code : null;
}

function runtimeErrorStatus(code: string) {
	if (
		code === "BILLING_UNAVAILABLE" ||
		code === "CORE_AUDIO_ACTIVATION_REQUIRED" ||
		code === "CORE_GENERATION_LEDGER_UNWIRED" ||
		code === "CORE_IMAGE_PARAMETERS_UNSUPPORTED" ||
		code === "CORE_MASK_ROLE_UNSUPPORTED" ||
		code === "CORE_TEXT_DELIVERABLE_UNSUPPORTED" ||
		code === "CORE_VIDEO_PARAMETERS_UNSUPPORTED" ||
		code === "OPERATION_NOT_ACTIVE" ||
		code === "PROVIDER_UNAVAILABLE" ||
		code === "AGENT_AUTHORITY_UNAVAILABLE" ||
		code === "AGENT_GENERATION_UNAVAILABLE" ||
		code === "AGENT_PLANNER_UNAVAILABLE"
	) {
		return 503;
	}
	if (code.includes("NOT_FOUND")) return 404;
	if (
		code.includes("CONFLICT") ||
		code === "CONFIRMATION_ALREADY_USED" ||
		code === "CONFIRMATION_EXPIRED" ||
		code === "CONFIRMATION_INVALID" ||
		code === "READ_SET_CHANGED" ||
		code === "QUOTE_MISMATCH" ||
		code === "JOB_NOT_DELIVERABLE"
	) {
		return 409;
	}
	if (
		code === "OWNER_REQUIRED" ||
		code === "PRO_STUDIO_ENTITLEMENT_REQUIRED" ||
		code === "WORKSPACE_FORBIDDEN"
	) {
		return 403;
	}
	return 400;
}

function jsonResponse(status: number, data: unknown, correlationId: string) {
	return Response.json(
		{ data, meta: { correlationId } },
		{
			status,
			headers: {
				"cache-control": "no-store",
				"x-correlation-id": correlationId,
			},
		},
	);
}

function errorResponse(
	status: number,
	code: string,
	message: string,
	correlationId: string,
) {
	return Response.json(
		{ error: { code, message }, meta: { correlationId } },
		{
			status,
			headers: {
				"cache-control": "no-store",
				"x-correlation-id": correlationId,
			},
		},
	);
}

function cookie(value: string | null, name: string) {
	return value
		?.split(";")
		.map((part) => part.trim().split("="))
		.find(([key]) => key === name)
		?.slice(1)
		.join("=");
}

function safeEqual(left: string, right: string) {
	const leftHash = createHash("sha256").update(left).digest();
	const rightHash = createHash("sha256").update(right).digest();
	return timingSafeEqual(leftHash, rightHash);
}

function requiresProStudioEntry(action: CanvasM1Action) {
	return ![
		"getProStudioEntry",
		"getSessionContext",
		"purchaseProStudio",
	].includes(action);
}

function requiresGenerationEntitlement(action: CanvasM1Action) {
	return [
		"applyAgentOps",
		"quoteGeneration",
		"retryGeneration",
		"submitGeneration",
		"streamTextGeneration",
	].includes(action);
}

function requiredIdempotencyKey(value: string | undefined) {
	if (!value) throw new Error("Idempotency-Key is required.");
	return value;
}
