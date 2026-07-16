import { createHash, timingSafeEqual } from "node:crypto";
import {
	AdvancedCanvasProjectError,
	type AdvancedCanvasProjectService,
	CanvasAssetError,
	type CanvasAssetFacade,
	type CanvasGraph,
	type CanvasSessionService,
	LaunchCodeError,
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
import { CoreAdvancedCanvasAdoptionError } from "./core-adoption-client";
import {
	CoreGenerationProviderError,
	type CoreGenerationIdentity,
	type CoreGenerationProvider,
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
	getAsset: contract("POST", "none", false),
	getAssetDelivery: contract("GET", "none", false),
	getCatalog: contract("POST", "none", false),
	getGenerationJob: contract("POST", "none", false),
	getProStudioEntry: contract("POST", "none", false),
	getRevision: contract("POST", "none", false),
	getSessionContext: contract("POST", "none", false),
	listAdoptions: contract("POST", "none", false),
	listAgentAudit: contract("POST", "none", false),
	listAssets: contract("POST", "none", false),
	listProjectGenerations: contract("POST", "none", false),
	listProjects: contract("POST", "none", false),
	listRevisions: contract("POST", "none", false),
	loadProject: contract("POST", "none", false),
	planAgent: contract("POST", "header", true),
	persistLocalCanvasArtifact: contract("POST", "header", true),
	purchaseProStudio: contract("POST", "header", true),
	quoteGeneration: contract("POST", "header", true),
	renameProject: contract("POST", "header", true),
	restoreRevision: contract("POST", "header", true),
	saveProjectDraft: contract("POST", "header", true),
	submitGeneration: contract("POST", "header", true),
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
const generationInputSchema = z.discriminatedUnion("operation", [
	z.strictObject({
		inputAssets: inputAssetsFor(["reference_image"], 20),
		operation: z.literal("image.generate"),
		parameters: z.strictObject({
			ratio: z.string().min(1).max(20).optional(),
			resolution: z.string().min(1).max(30).optional(),
		}),
		projectId: identifierSchema,
		prompt: z.string().min(1).max(20_000),
		revisionId: identifierSchema,
	}),
	z.strictObject({
		inputAssets: inputAssetsFor(["reference_image", "mask"], 20),
		operation: z.literal("image.edit"),
		parameters: z.strictObject({
			ratio: z.string().min(1).max(20).optional(),
			resolution: z.string().min(1).max(30).optional(),
			strength: z.number().min(0).max(1).optional(),
		}),
		projectId: identifierSchema,
		prompt: z.string().min(1).max(20_000),
		revisionId: identifierSchema,
	}),
	z.strictObject({
		inputAssets: inputAssetsFor(["reference_image"], 8),
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
		inputAssets: inputAssetsFor(
			["reference_image", "reference_video", "reference_audio"],
			8,
		),
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
		inputAssets: inputAssetsFor(["reference_audio"], 1),
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
		inputAssets: inputAssetsFor(["reference_audio"], 1),
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
	listAgentAudit: projectIdSchema,
	listAssets: emptySchema,
	listProjectGenerations: projectIdSchema,
	listProjects: emptySchema,
	listRevisions: projectIdSchema,
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

export interface CanvasBackendRuntimePorts {
	adoption: AdvancedCanvasAdoptionPort;
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
			| "submit"
		>;
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
		const correlationId =
			request.headers.get("x-correlation-id") ?? crypto.randomUUID();
		if (!isCanvasAction(action)) {
			return errorResponse(
				404,
				"NOT_FOUND",
				"Canvas action was not found.",
				correlationId,
			);
		}
		const actionContract = CANVAS_ACTION_CONTRACTS[action];
		if (request.method !== actionContract.method) {
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
			const rawInput = await inputFor(request);
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
				return context;
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
				const [localCatalog, coreCatalog] = await Promise.all([
					this.options.generation.catalog.list(runtimeContext),
					this.options.generation.core.getCatalog(runtimeContext),
				]);
				return {
					...(coreCatalog as Record<string, unknown>),
					agent: localCatalog.agent,
				};
			}
			case "quoteGeneration": {
				const value = input as z.infer<(typeof schemas)["quoteGeneration"]>;
				await this.options.projects.getRevision(
					context,
					value.projectId,
					value.revisionId,
				);
				return this.options.generation.core.quote({
					...runtimeContext,
					...value,
					dataClass: [],
					idempotencyKey: requiredIdempotencyKey(idempotencyKey),
				});
			}
			case "submitGeneration": {
				const value = input as z.infer<(typeof schemas)["submitGeneration"]>;
				await this.options.projects.getRevision(
					context,
					value.input.projectId,
					value.input.revisionId,
				);
				return this.options.generation.core.submit({
					...runtimeContext,
					...value.input,
					dataClass: [],
					idempotencyKey: requiredIdempotencyKey(idempotencyKey),
					quoteId: value.quoteId,
				});
			}
			case "getGenerationJob": {
				const value = input as z.infer<
					(typeof schemas)["getGenerationJob"]
				>;
				await this.options.projects.loadProject(context, value.projectId);
				return this.options.generation.core.getJob({
					...runtimeContext,
					...value,
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
				const value = input as z.infer<
					(typeof schemas)["cancelGeneration"]
				>;
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
			case "listAssets":
				return this.options.assets.listAssets(context);
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

async function inputFor(request: Request) {
	if (request.method === "GET") {
		return Object.fromEntries(new URL(request.url).searchParams.entries());
	}
	const text = await request.text();
	if (!text) return {};
	try {
		return JSON.parse(text) as unknown;
	} catch {
		return Symbol("invalid-json");
	}
}

function containsForbiddenField(value: unknown): boolean {
	if (!value || typeof value !== "object") return false;
	if (Array.isArray(value)) return value.some(containsForbiddenField);
	return Object.entries(value).some(
		([key, child]) => forbiddenFields.has(key) || containsForbiddenField(child),
	);
}

function mappedError(error: unknown, correlationId: string) {
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
	return ["applyAgentOps", "quoteGeneration", "submitGeneration"].includes(
		action,
	);
}

function requiredIdempotencyKey(value: string | undefined) {
	if (!value) throw new Error("Idempotency-Key is required.");
	return value;
}
