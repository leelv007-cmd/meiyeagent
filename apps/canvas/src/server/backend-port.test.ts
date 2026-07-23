import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import {
	AdvancedCanvasProjectService,
	CanvasAssetFacade,
	type CanvasGraph,
	CanvasSessionService,
	LaunchCodeService,
	MemoryAdvancedCanvasProjectRepository,
	MemoryCanvasAssetRepository,
	MemoryCanvasExportReceiptRepository,
	MemoryCanvasObjectStorage,
	MemoryLaunchCodeRepository,
	MemorySecurityRejectionAuditRepository,
	SecurityRejectionAuditService,
} from "@meiye/core/pro-studio";
import {
	CanvasAgentError,
	ProStudioEntitlementError,
} from "@meiye/core/pro-studio-runtime";
import {
	CANVAS_ACTION_CONTRACTS,
	CanvasBackendPort,
	type CanvasBackendRuntimePorts,
} from "./backend-port.js";
import { CanvasRevisionExportService } from "./canvas-export.js";
import { CoreAdvancedCanvasAdoptionError } from "./core-adoption-client.js";
import { CoreCanvasExportAssetClient } from "./core-canvas-export-asset-client.js";
import { CoreGenerationProviderError } from "./core-generation-provider.js";

async function fixture(
	ports = runtimePorts(),
	upstreamIsActive: () => Promise<boolean> = async () => true,
	seedGraph: CanvasGraph = { edges: [], nodes: [], schemaVersion: 1 },
) {
	let id = 0;
	const launchRepository = new MemoryLaunchCodeRepository();
	const launch = new LaunchCodeService({
		repository: launchRepository,
		randomBytes: () => new Uint8Array(32).fill(++id),
		access: {
			async canAccessWorkspace() {
				return true;
			},
			async canAccessProject() {
				return true;
			},
		},
	});
	const issued = await launch.issue({
		audience: { kind: "workspace" },
		browserNonce: "nonce",
		mainSessionId: "main-session",
		userId: "user-1",
		workspaceId: "workspace-1",
	});
	const exchanged = await launch.exchange({
		browserNonce: "nonce",
		code: issued.code,
	});
	const sessions = new CanvasSessionService({
		repository: launchRepository,
		upstream: {
			isActive: upstreamIsActive,
		},
	});
	const projectRepository = new MemoryAdvancedCanvasProjectRepository();
	const seededAt = "2026-07-16T00:00:00.000Z";
	await projectRepository.insertProject({
		createdAt: seededAt,
		createdBy: "user-1",
		draftVersion: 1,
		graph: seedGraph,
		id: "project-1",
		name: "Seed project",
		updatedAt: seededAt,
		workspaceId: "workspace-1",
	});
	await projectRepository.createCheckpoint({
		expectedDraftVersion: 1,
		revision: {
			createdAt: seededAt,
			createdBy: "user-1",
			id: "revision-1",
			projectId: "project-1",
			reason: "checkpoint",
			workspaceId: "workspace-1",
		},
	});
	const projects = new AdvancedCanvasProjectService({
		repository: projectRepository,
		nextId: (kind) => `${kind}-${++id}`,
	});
	const assets = new CanvasAssetFacade({
		repository: new MemoryCanvasAssetRepository(),
		storage: new MemoryCanvasObjectStorage(),
		nextId: () => `asset-${++id}`,
	});
	return {
		port: new CanvasBackendPort({
			...ports,
			assets,
			projects,
			sessions,
		}),
		sessionToken: exchanged.sessionToken,
	};
}

function runtimePorts(): CanvasBackendRuntimePorts {
	const securityAudit = new SecurityRejectionAuditService(
		new MemorySecurityRejectionAuditRepository(),
		{ clock: () => new Date("2026-07-16T12:00:00.000Z") },
	);
	return {
		adoption: {
			async adopt() {
				throw new Error("Adoption is not configured in this fixture.");
			},
			async listAdoptions() {
				return [];
			},
		},
		agent: {
			audit: {
				async list() {
					return [];
				},
			},
			service: {
				async apply() {
					throw new Error("Agent is not configured in this fixture.");
				},
				async confirm() {
					throw new Error("Agent is not configured in this fixture.");
				},
				async plan() {
					throw new Error("Agent is not configured in this fixture.");
				},
			},
		},
		entitlement: {
			async resolveRole() {
				return "owner" as const;
			},
			service: {
				async assertCanEnter() {},
				async assertCanGenerate() {},
				async getEntry() {
					return {
						activatedAt: "2026-07-16T10:00:00.000Z",
						offerId: "pro-studio-v1",
						status: "active" as const,
					};
				},
				async purchase() {
					return {
						activatedAt: "2026-07-16T10:00:00.000Z",
						offerId: "pro-studio-v1",
						status: "active" as const,
					};
				},
			},
		},
		generation: {
			catalog: {
				async list() {
					return {
						agent: {
							activation: "inactive" as const,
							reason: "No planner is configured.",
						},
						operations: [],
					};
				},
			},
			core: {
				async cancel() {
					throw new Error("Generation is not configured in this fixture.");
				},
				async getCatalog() {
					return { operations: [], revisionId: "catalog-v1" };
				},
				async getJob() {
					throw new Error("Generation is not configured in this fixture.");
				},
				async listProjectGenerations() {
					return [];
				},
				async quote() {
					throw new Error("Generation is not configured in this fixture.");
				},
				async retry() {
					throw new Error("Generation is not configured in this fixture.");
				},
				async submit() {
					throw new Error("Generation is not configured in this fixture.");
				},
				async streamCanvasText() {
					throw new Error("Generation is not configured in this fixture.");
				},
			},
		},
		securityAudit,
	};
}

test("freezes the M1 action paths, methods and idempotency location", () => {
	assert.deepEqual(
		Object.fromEntries(
			Object.entries(CANVAS_ACTION_CONTRACTS).map(([action, contract]) => [
				action,
				[contract.method, contract.path, contract.idempotency],
			]),
		),
		{
			adoptAdvancedCanvasOutput: [
				"POST",
				"/api/canvas/adoptAdvancedCanvasOutput",
				"header",
			],
			applyAgentOps: ["POST", "/api/canvas/applyAgentOps", "header"],
			cancelGeneration: ["POST", "/api/canvas/cancelGeneration", "header"],
			confirmAgent: ["POST", "/api/canvas/confirmAgent", "header"],
			createCheckpoint: ["POST", "/api/canvas/createCheckpoint", "header"],
			createProject: ["POST", "/api/canvas/createProject", "header"],
			deleteProject: ["POST", "/api/canvas/deleteProject", "header"],
			duplicateProject: ["POST", "/api/canvas/duplicateProject", "header"],
			exportCanvas: ["POST", "/api/canvas/exportCanvas", "header"],
			getAsset: ["POST", "/api/canvas/getAsset", "none"],
			getAssetDelivery: ["GET", "/api/canvas/getAssetDelivery", "none"],
			getCatalog: ["POST", "/api/canvas/getCatalog", "none"],
			getGenerationJob: ["POST", "/api/canvas/getGenerationJob", "none"],
			getProStudioEntry: ["POST", "/api/canvas/getProStudioEntry", "none"],
			getRevision: ["POST", "/api/canvas/getRevision", "none"],
			getSessionContext: ["POST", "/api/canvas/getSessionContext", "none"],
			listAdoptions: ["POST", "/api/canvas/listAdoptions", "none"],
			listAdoptionTargets: ["POST", "/api/canvas/listAdoptionTargets", "none"],
			listAgentAudit: ["POST", "/api/canvas/listAgentAudit", "none"],
			listAssets: ["POST", "/api/canvas/listAssets", "none"],
			listPrompts: ["POST", "/api/canvas/listPrompts", "none"],
			listProjectGenerations: [
				"POST",
				"/api/canvas/listProjectGenerations",
				"none",
			],
			listProjects: ["POST", "/api/canvas/listProjects", "none"],
			listRevisions: ["POST", "/api/canvas/listRevisions", "none"],
			listSecurityRejectionAudit: [
				"POST",
				"/api/canvas/listSecurityRejectionAudit",
				"none",
			],
			loadProject: ["POST", "/api/canvas/loadProject", "none"],
			planAgent: ["POST", "/api/canvas/planAgent", "header"],
			persistLocalCanvasArtifact: [
				"POST",
				"/api/canvas/persistLocalCanvasArtifact",
				"header",
			],
			purchaseProStudio: ["POST", "/api/canvas/purchaseProStudio", "header"],
			quoteGeneration: ["POST", "/api/canvas/quoteGeneration", "header"],
			retryGeneration: ["POST", "/api/canvas/retryGeneration", "header"],
			renameProject: ["POST", "/api/canvas/renameProject", "header"],
			restoreRevision: ["POST", "/api/canvas/restoreRevision", "header"],
			saveProjectDraft: ["POST", "/api/canvas/saveProjectDraft", "header"],
			submitGeneration: ["POST", "/api/canvas/submitGeneration", "header"],
			streamTextGeneration: [
				"POST",
				"/api/canvas/streamTextGeneration",
				"none",
			],
		},
	);
});

test("returns 404 for actions outside the frozen table", async () => {
	const { port, sessionToken } = await fixture();
	const response = await port.handle(
		"proxyAnything",
		request({}),
		sessionToken,
	);
	assert.equal(response.status, 404);
});

test("rejects standard action bodies larger than 1 MiB", async () => {
	const { port, sessionToken } = await fixture();
	const body = JSON.stringify({ padding: "x".repeat(1024 * 1024) });
	const response = await port.handle(
		"getCatalog",
		new Request("https://canvas.example.test/api/canvas/getCatalog", {
			body,
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
		sessionToken,
	);

	assert.equal(response.status, 413);
	assert.equal((await response.json()).error.code, "REQUEST_BODY_TOO_LARGE");
});

test("rejects deeply nested JSON without recursive traversal", async () => {
	const { port, sessionToken } = await fixture();
	const body = `${'{"child":'.repeat(100)}null${"}".repeat(100)}`;
	const response = await port.handle(
		"getCatalog",
		new Request("https://canvas.example.test/api/canvas/getCatalog", {
			body,
			headers: { "content-type": "application/json" },
			method: "POST",
		}),
		sessionToken,
	);

	assert.equal(response.status, 400);
	assert.equal((await response.json()).error.code, "JSON_TOO_COMPLEX");
});

test("keeps an independent large-body budget for local Canvas media", async () => {
	const { port, sessionToken } = await fixture();
	const bytes = Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		Buffer.alloc(800_000),
	]);
	const response = await port.handle(
		"persistLocalCanvasArtifact",
		request({
			bytesBase64: bytes.toString("base64"),
			contentType: "image/png",
			derivation: "retouch",
			fileName: "large.png",
		}),
		sessionToken,
	);

	assert.equal(response.status, 200);
});

test("rejects invalid idempotency keys instead of replacing them", async () => {
	const { port, sessionToken } = await fixture();
	const original = request({ projectId: "project-1" });
	const headers = new Headers(original.headers);
	headers.set("idempotency-key", "invalid key with spaces");
	const response = await port.handle(
		"deleteProject",
		new Request(original, { headers }),
		sessionToken,
	);

	assert.equal(response.status, 400);
	assert.equal((await response.json()).error.code, "INVALID_IDEMPOTENCY_KEY");
});

test("regenerates unsafe correlation IDs at the Canvas boundary", async () => {
	const { port, sessionToken } = await fixture();
	const original = request({});
	const headers = new Headers(original.headers);
	headers.set("x-correlation-id", "unsafe correlation value");
	const response = await port.handle(
		"getCatalog",
		new Request(original, { headers }),
		sessionToken,
	);
	const correlationId = response.headers.get("x-correlation-id");

	assert.equal(response.status, 200);
	assert.notEqual(correlationId, "unsafe correlation value");
	assert.match(correlationId ?? "", /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,199}$/u);
});

test("maps transient main-session validation failures to 503", async () => {
	const unavailable = Object.assign(new Error("main app unavailable"), {
		code: "MAIN_SESSION_UNAVAILABLE",
	});
	const { port, sessionToken } = await fixture(runtimePorts(), async () => {
		throw unavailable;
	});
	const response = await port.handle("listProjects", request({}), sessionToken);

	assert.equal(response.status, 503);
	assert.equal((await response.json()).error.code, "MAIN_SESSION_UNAVAILABLE");
});

test("strictly rejects unknown and provider-routing fields before side effects", async () => {
	const { port, sessionToken } = await fixture();
	const response = await port.handle(
		"createProject",
		request({
			name: "Campaign",
			graph: { schemaVersion: 1, nodes: [], edges: [] },
			serverUrl: "http://169.254.169.254",
		}),
		sessionToken,
	);
	assert.equal(response.status, 400);
	assert.equal((await response.json()).error.code, "INVALID_INPUT");
});

test("requires session and CSRF+origin on mutations", async () => {
	const { port, sessionToken } = await fixture();
	assert.equal(
		(await port.handle("listProjects", request({}), undefined)).status,
		401,
	);
	const missingCsrf = await port.handle(
		"createProject",
		request(
			{ name: "Campaign", graph: { schemaVersion: 1, nodes: [], edges: [] } },
			{ csrf: false },
		),
		sessionToken,
	);
	assert.equal(missingCsrf.status, 403);
});

test("maps stale draft CAS to the frozen 409 code", async () => {
	const { port, sessionToken } = await fixture();
	const created = await port.handle(
		"createProject",
		request({
			name: "Campaign",
			graph: { schemaVersion: 1, nodes: [], edges: [] },
		}),
		sessionToken,
	);
	const project = (await created.json()).data;
	const conflict = await port.handle(
		"saveProjectDraft",
		request({
			projectId: project.id,
			expectedDraftVersion: 9,
			graph: { schemaVersion: 1, nodes: [], edges: [] },
		}),
		sessionToken,
	);
	assert.equal(conflict.status, 409);
	assert.equal((await conflict.json()).error.code, "DRAFT_VERSION_CONFLICT");
});

test("cancelGeneration requests cancellation without confirming provider terminal state", async () => {
	const ports = runtimePorts();
	let requests = 0;
	ports.generation.core.cancel = async (input) => {
		requests += 1;
		return {
			jobId: input.jobId,
			projectId: input.projectId,
			status: "cancel_requested" as const,
		};
	};
	const { port, sessionToken } = await fixture(ports);
	const response = await port.handle(
		"cancelGeneration",
		request({ jobId: "job-1", projectId: "project-1" }),
		sessionToken,
	);

	assert.equal(response.status, 200);
	assert.equal(requests, 1);
	assert.equal((await response.json()).data.status, "cancel_requested");
});

test("streams Canvas text only through the authenticated project facade and forwards its resume cursor", async () => {
	const ports = runtimePorts();
	let received:
		| {
				jobId: string;
				lastEventId?: string;
				projectId: string;
				userId: string;
				workspaceId: string;
		  }
		| undefined;
	ports.generation.core.streamCanvasText = async (input) => {
		received = input;
		return new Response(
			'id: 1\nevent: canvas.text.delta\ndata: {"jobId":"job-1","sequence":1,"delta":"真实"}\n\n',
			{
				headers: {
					"content-type": "text/event-stream; charset=utf-8",
					"x-meiye-stream-protocol": "canvas-text-events-v1",
				},
			},
		);
	};
	const { port, sessionToken } = await fixture(ports);
	const response = await port.handle(
		"streamTextGeneration",
		request(
			{ jobId: "job-1", projectId: "project-1" },
			{ headers: { "last-event-id": "7" } },
		),
		sessionToken,
	);

	assert.equal(response.status, 200);
	assert.equal(
		response.headers.get("content-type"),
		"text/event-stream; charset=utf-8",
	);
	assert.equal(response.headers.get("x-service-token"), null);
	assert.equal(received?.jobId, "job-1");
	assert.equal(received?.lastEventId, "7");
	assert.equal(received?.projectId, "project-1");
	assert.equal(received?.userId, "user-1");
	assert.equal(received?.workspaceId, "workspace-1");

	const unauthenticated = await port.handle(
		"streamTextGeneration",
		request({ jobId: "job-1", projectId: "project-1" }),
		undefined,
	);
	assert.equal(unauthenticated.status, 401);
	const csrfRejected = await port.handle(
		"streamTextGeneration",
		request({ jobId: "job-1", projectId: "project-1" }, { csrf: false }),
		sessionToken,
	);
	assert.equal(csrfRejected.status, 403);
	const foreign = await port.handle(
		"streamTextGeneration",
		request({ jobId: "job-1", projectId: "project-foreign" }),
		sessionToken,
	);
	assert.equal(foreign.status, 404);
});

test("retryGeneration invokes the injected frozen Core retry action once", async () => {
	const ports = runtimePorts();
	let received:
		| {
				idempotencyKey: string;
				jobId: string;
				projectId: string;
				workspaceId: string;
		  }
		| undefined;
	ports.generation.core.retry = async (input) => {
		received = input;
		return {
			jobId: "retry-job-1",
			projectId: input.projectId,
			status: "queued" as const,
		};
	};
	const { port, sessionToken } = await fixture(ports);
	const response = await port.handle(
		"retryGeneration",
		request({ jobId: "failed-job-1", projectId: "project-1" }),
		sessionToken,
	);

	assert.equal(response.status, 200);
	assert.equal(received?.idempotencyKey, "test-idempotency-key");
	assert.equal(received?.jobId, "failed-job-1");
	assert.equal(received?.projectId, "project-1");
	assert.equal(received?.workspaceId, "workspace-1");
	assert.equal((await response.json()).data.jobId, "retry-job-1");
});

test("quote, submit, retry and Agent apply explicitly require generation entitlement", async () => {
	const generationInput = {
		checkpointId: "revision-1",
		count: 1,
		inputAssets: [],
		itemId: "canvas-item-1",
		operation: "image.generate",
		parameters: {},
		projectId: "project-1",
		prompt: "Create a nail image",
		revisionId: "revision-1",
	};
	const cases = [
		["quoteGeneration", generationInput],
		["submitGeneration", { input: generationInput, quoteId: "quote-1" }],
		["retryGeneration", { jobId: "job-1", projectId: "project-1" }],
		["streamTextGeneration", { jobId: "job-1", projectId: "project-1" }],
		[
			"applyAgentOps",
			{
				credentialId: "credential-1",
				expectedRevision: 1,
				projectId: "project-1",
			},
		],
	] as const;
	for (const [action, body] of cases) {
		const ports = runtimePorts();
		ports.entitlement.service.assertCanGenerate = async () => {
			throw new ProStudioEntitlementError(
				"PRO_STUDIO_ENTITLEMENT_REQUIRED",
				"Generation entitlement is required.",
			);
		};
		const { port, sessionToken } = await fixture(ports);
		const response = await port.handle(action, request(body), sessionToken);
		assert.equal(response.status, 403, action);
		assert.equal(
			(await response.json()).error.code,
			"PRO_STUDIO_ENTITLEMENT_REQUIRED",
			action,
		);
	}
});

test("generation catalog mirrors only authoritative Core capability activation", async () => {
	const ports = runtimePorts();
	ports.generation.catalog.list = async () => ({
		agent: { activation: "inactive" as const, reason: "No planner." },
		operations: [activeCapability("image.generate", "image", ["ratio"])],
	});
	ports.generation.core.getCatalog = async () => ({
		defaultModelIdByOperation: { "image.generate": "core-image-model" },
		operations: [
			{
				activation: "active",
				allowedInputAssetRoles: ["reference_image"],
				allowedParameters: ["width", "height"],
				modelId: "core-image-model",
				operation: "image.generate",
			},
		],
		revisionId: "core-catalog-v2",
	});
	const { port, sessionToken } = await fixture(ports);

	const response = await port.handle("getCatalog", request({}), sessionToken);
	const body = (await response.json()).data;
	assert.equal(response.status, 200);
	assert.equal(body.revisionId, "core-catalog-v2");
	assert.equal(body.agent.activation, "inactive");
	const image = body.operations.find(
		(operation: { operation: string }) =>
			operation.operation === "image.generate",
	);
	assert.equal(image?.modelId, "core-image-model");
	assert.equal(image?.activation, "active");
});

test("catalog is deterministic and fails closed without an explicit default", async () => {
	const ports = runtimePorts();
	ports.generation.core.getCatalog = async () => ({
		operations: [
			{
				activation: "active",
				allowedInputAssetRoles: [],
				allowedParameters: [],
				modelId: "first-by-accident",
				operation: "text.respond",
			},
		],
		revisionId: "core-catalog-v3",
	});
	const { port, sessionToken } = await fixture(ports);
	const response = await port.handle("getCatalog", request({}), sessionToken);
	const body = (await response.json()).data;
	const text = body.operations.find(
		(operation: { operation: string }) =>
			operation.operation === "text.respond",
	);

	assert.equal(response.status, 200);
	assert.equal(text.activation, "inactive");
	assert.equal(text.modelId, "first-by-accident");
	assert.equal(
		body.unavailableReasonCodeByOperation["text.respond"],
		"MODEL_NOT_CONFIGURED",
	);
	assert.deepEqual(
		body.operations.map(
			(operation: { operation: string }) => operation.operation,
		),
		[
			"audio.sfx",
			"audio.speech",
			"image.edit",
			"image.generate",
			"text.respond",
			"video.generate",
		],
	);
});

test("generation rejects unfrozen or invalid lineage before Core", async () => {
	const ports = runtimePorts();
	let coreCalls = 0;
	ports.generation.core.quote = async () => {
		coreCalls += 1;
		return { quoteId: "core-quote-1" };
	};
	const graph: CanvasGraph = {
		edges: [],
		nodes: [{ data: {}, id: "image-1", type: "image" }],
		schemaVersion: 1,
	};
	const { port, sessionToken } = await fixture(ports, async () => true, graph);
	const base = generationContract("image.generate", {});

	for (const [input, code] of [
		[
			{ ...base, checkpointId: "checkpoint-other" },
			"GENERATION_INPUT_BINDING_INVALID",
		],
		[
			{ ...base, itemId: undefined, nodeId: undefined },
			"GENERATION_INPUT_BINDING_INVALID",
		],
		[{ ...base, count: 2 }, "INVALID_INPUT"],
		[
			{ ...base, itemId: undefined, nodeId: "missing-node" },
			"GENERATION_INPUT_BINDING_INVALID",
		],
	] as const) {
		const response = await port.handle(
			"quoteGeneration",
			request(input),
			sessionToken,
		);
		assert.equal(response.status, 400);
		assert.equal((await response.json()).error.code, code);
	}
	assert.equal(coreCalls, 0);
});

test("derives K3 retouch lineage only from a real frozen input node", async () => {
	const ports = runtimePorts();
	let quote:
		| {
				checkpointId: string;
				count: number;
				itemId?: string;
				nodeId?: string;
		  }
		| undefined;
	ports.generation.core.quote = async (input) => {
		quote = input;
		return { quoteId: "core-quote-1" };
	};
	const graph: CanvasGraph = {
		edges: [],
		nodes: [
			{
				data: { assetId: "asset-input-1" },
				id: "image-input-1",
				type: "image",
			},
		],
		schemaVersion: 1,
	};
	const { port, sessionToken } = await fixture(ports, async () => true, graph);
	const retouch = {
		inputAssets: [
			{ assetId: "asset-input-1", role: "reference_image" as const },
		],
		inputNodeBindings: [
			{
				assetId: "asset-input-1",
				nodeId: "image-input-1",
				role: "reference_image" as const,
			},
		],
		operation: "image.edit" as const,
		parameters: {},
		projectId: "project-1",
		prompt: "Retouch the selected image",
		revisionId: "revision-1",
	};
	const compatible = await port.handle(
		"quoteGeneration",
		request(retouch),
		sessionToken,
	);
	assert.equal(compatible.status, 200);
	assert.equal(quote?.checkpointId, "revision-1");
	assert.equal(quote?.count, 1);
	assert.equal(quote?.nodeId, "image-input-1");
	assert.equal(quote?.itemId, undefined);

	const withoutRealLineage = await port.handle(
		"quoteGeneration",
		request({
			...retouch,
			inputAssets: [],
			inputNodeBindings: [],
		}),
		sessionToken,
	);
	assert.equal(withoutRealLineage.status, 400);
	assert.equal(
		(await withoutRealLineage.json()).error.code,
		"GENERATION_INPUT_BINDING_INVALID",
	);
});

test("lists authorized targets, prompts, and assets through scoped query contracts", async () => {
	const ports = runtimePorts();
	ports.adoptionTargets = {
		async list() {
			return Array.from({ length: 51 }, (_, index) => ({
				handle: {
					baseVersionId: `version-${String(index).padStart(2, "0")}`,
					expectedRevision: index,
					packageId: `package-${String(index).padStart(2, "0")}`,
				},
				id: `package-${String(index).padStart(2, "0")}`,
				title: `Target package ${index}`,
			}));
		},
	};
	ports.prompts = {
		async list() {
			return [
				{
					category: "campaign",
					id: "prompt-1",
					prompt: "Create a campaign visual",
					title: "Campaign visual",
				},
				{
					category: "retouch",
					id: "prompt-2",
					prompt: "Retouch a portrait",
					title: "Portrait retouch",
				},
			];
		},
	};
	const { port, sessionToken } = await fixture(ports);

	const firstTargets = await port.handle(
		"listAdoptionTargets",
		request({ query: "target package" }),
		sessionToken,
	);
	const firstTargetPage = (await firstTargets.json()).data;
	assert.equal(firstTargets.status, 200);
	assert.equal(firstTargetPage.items.length, 50);
	assert.ok(firstTargetPage.nextCursor);
	assert.deepEqual(firstTargetPage.items[0], {
		handle: {
			baseVersionId: "version-00",
			expectedRevision: 0,
			packageId: "package-00",
		},
		id: "package-00",
		title: "Target package 0",
	});
	const secondTargets = await port.handle(
		"listAdoptionTargets",
		request({ cursor: firstTargetPage.nextCursor, query: "target package" }),
		sessionToken,
	);
	assert.deepEqual(
		(await secondTargets.json()).data.items.map(
			(item: { id: string }) => item.id,
		),
		["package-50"],
	);

	const prompts = await port.handle(
		"listPrompts",
		request({ category: "campaign", query: "visual" }),
		sessionToken,
	);
	assert.deepEqual((await prompts.json()).data.items, [
		{
			category: "campaign",
			id: "prompt-1",
			prompt: "Create a campaign visual",
			title: "Campaign visual",
		},
	]);

	await port.handle(
		"persistLocalCanvasArtifact",
		request({
			bytesBase64: Buffer.from([
				0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
			]).toString("base64"),
			contentType: "image/png",
			derivation: "retouch",
			fileName: "campaign-poster.png",
		}),
		sessionToken,
	);
	const assets = await port.handle(
		"listAssets",
		request({ kind: "image", query: "poster" }),
		sessionToken,
	);
	assert.equal(assets.status, 200);
	const listedAsset = (await assets.json()).data.items[0];
	assert.equal(listedAsset?.kind, "image");
	assert.equal(listedAsset?.title, "campaign-poster.png");
	assert.equal(typeof listedAsset?.id, "string");

	const invalidCursor = await port.handle(
		"listAssets",
		request({ cursor: "not-a-cursor" }),
		sessionToken,
	);
	assert.equal(invalidCursor.status, 400);
	assert.equal((await invalidCursor.json()).error.code, "INVALID_CURSOR");
});

test("returns only a server-owned workspace display name and fails closed export retrieval", async () => {
	const ports = runtimePorts();
	ports.workspace = {
		async displayName() {
			return "Studio Aurora";
		},
	};
	const { port, sessionToken } = await fixture(ports);
	const session = await port.handle(
		"getSessionContext",
		request({}),
		sessionToken,
	);
	assert.deepEqual((await session.json()).data, {
		workspaceDisplayName: "Studio Aurora",
	});

	const exportResponse = await port.handle(
		"exportCanvas",
		request({
			format: "json",
			projectId: "project-1",
			revisionId: "revision-1",
		}),
		sessionToken,
	);
	assert.equal(exportResponse.status, 503);
	assert.equal(
		(await exportResponse.json()).error.code,
		"EXPORT_NOT_AVAILABLE",
	);

	const missingRevision = await port.handle(
		"exportCanvas",
		request({
			format: "json",
			projectId: "project-1",
			revisionId: "missing-revision",
		}),
		sessionToken,
	);
	assert.equal(missingRevision.status, 404);
	assert.equal((await missingRevision.json()).error.code, "REVISION_NOT_FOUND");
});

test("exports a frozen revision through the authoritative Core asset adapter", async () => {
	const ports = runtimePorts();
	const assetBytes = new TextEncoder().encode("exported media");
	const assetSha256 = createHash("sha256").update(assetBytes).digest("hex");
	let mode: "available" | "foreign" | "revoked" = "available";
	const requests: RequestInit[] = [];
	ports.exports = new CanvasRevisionExportService(
		new CoreCanvasExportAssetClient({
			coreServiceToken: "service-secret",
			coreServiceUrl: "http://core.internal:4100",
			fetcher: async (_url, init) => {
				requests.push(init ?? {});
				if (mode === "revoked") {
					return new Response(
						JSON.stringify({
							data: { code: "ASSET_REVOKED", kind: "unavailable" },
						}),
						{ headers: { "content-type": "application/json" }, status: 200 },
					);
				}
				return new Response(
					JSON.stringify({
						data: {
							asset: {
								bytesBase64: Buffer.from(assetBytes).toString("base64"),
								contentType: "image/png",
								fileName: "image.png",
								id: "asset-1",
								receipt: { id: "asset-1", storageRevision: "receipt-v1" },
								sha256: assetSha256,
								sizeBytes: assetBytes.byteLength,
								workspaceId: mode === "foreign" ? "workspace-2" : "workspace-1",
							},
							kind: "available",
						},
					}),
					{ headers: { "content-type": "application/json" }, status: 200 },
				);
			},
		}),
		new MemoryCanvasExportReceiptRepository({
			clock: () => new Date("2026-07-23T00:00:00.000Z"),
			nextId: () => "canvas-export-backend-receipt",
		}),
	);
	const graph: CanvasGraph = {
		edges: [],
		nodes: [{ data: { assetId: "asset-1" }, id: "image-1", type: "image" }],
		schemaVersion: 1,
	};
	const { port, sessionToken } = await fixture(ports, async () => true, graph);

	const exported = await port.handle(
		"exportCanvas",
		request({
			format: "zip",
			projectId: "project-1",
			revisionId: "revision-1",
		}),
		sessionToken,
	);
	assert.equal(exported.status, 200);
	assert.equal(exported.headers.get("content-type"), "application/zip");
	assert.equal(
		exported.headers.get("content-disposition"),
		'attachment; filename="canvas-export.zip"',
	);
	assert.ok(exported.headers.get("x-canvas-export-manifest-sha256"));
	assert.ok((await exported.arrayBuffer()).byteLength > assetBytes.byteLength);
	assert.deepEqual(JSON.parse(String(requests[0]?.body)), {
		action: "canvas_export_asset",
		module: "operations",
		payload: { assetId: "asset-1" },
	});

	mode = "foreign";
	const foreign = await port.handle(
		"exportCanvas",
		request({
			format: "json",
			projectId: "project-1",
			revisionId: "revision-1",
		}),
		sessionToken,
	);
	assert.equal(foreign.status, 503);
	assert.equal((await foreign.json()).error.code, "EXPORT_NOT_AVAILABLE");

	mode = "revoked";
	const revoked = await port.handle(
		"exportCanvas",
		request({
			format: "json",
			projectId: "project-1",
			revisionId: "revision-1",
		}),
		sessionToken,
	);
	assert.equal(revoked.status, 503);
	assert.equal((await revoked.json()).error.code, "EXPORT_NOT_AVAILABLE");
});

test("generation quote reaches Core without creating a Canvas-local ledger", async () => {
	const ports = runtimePorts();
	let quoteInput:
		| {
				inputAssets: unknown[];
				inputNodeBindings: unknown[];
				modelId?: string;
				workspaceId: string;
		  }
		| undefined;
	ports.generation.core.quote = async (input) => {
		quoteInput = input;
		return { quoteId: "core-quote-1", workspaceId: input.workspaceId };
	};
	const { port, sessionToken } = await fixture(ports);
	const response = await port.handle(
		"quoteGeneration",
		request({
			...generationContract("text.respond", {}),
			modelId: "core-text-model",
		}),
		sessionToken,
	);
	assert.equal(response.status, 200);
	assert.equal((await response.json()).data.quoteId, "core-quote-1");
	assert.equal(quoteInput?.workspaceId, "workspace-1");
	assert.equal(quoteInput?.modelId, "core-text-model");
	assert.deepEqual(quoteInput?.inputAssets, []);
	assert.deepEqual(quoteInput?.inputNodeBindings, []);
});

test("generation input node bindings match the frozen revision before Core", async () => {
	const ports = runtimePorts();
	const quoted: unknown[] = [];
	let submitted = 0;
	ports.generation.core.quote = async (input) => {
		quoted.push(input.inputNodeBindings);
		return { quoteId: "core-quote-1" };
	};
	ports.generation.core.submit = async () => {
		submitted += 1;
		return { jobId: "core-job-1", status: "queued" as const };
	};
	const graph: CanvasGraph = {
		edges: [],
		nodes: [
			{ data: { assetId: "asset-image-1" }, id: "image-1", type: "image" },
			{ data: { assetId: "asset-video-1" }, id: "video-1", type: "video" },
		],
		schemaVersion: 1,
	};
	const { port, sessionToken } = await fixture(ports, async () => true, graph);
	const input = {
		...generationContract("video.generate", {}),
		inputAssets: [
			{ assetId: "asset-image-1", role: "reference_image" as const },
			{ assetId: "asset-video-1", role: "reference_video" as const },
		],
		inputNodeBindings: [
			{
				assetId: "asset-image-1",
				nodeId: "image-1",
				role: "reference_image" as const,
			},
			{
				assetId: "asset-video-1",
				nodeId: "video-1",
				role: "reference_video" as const,
			},
		],
	};

	const valid = await port.handle(
		"quoteGeneration",
		request(input),
		sessionToken,
	);
	assert.equal(valid.status, 200);
	assert.deepEqual(quoted, [input.inputNodeBindings]);

	for (const inputNodeBindings of [
		input.inputNodeBindings.slice(0, 1),
		[input.inputNodeBindings[1], input.inputNodeBindings[0]],
		[
			input.inputNodeBindings[0],
			{ ...input.inputNodeBindings[1], nodeId: "missing-node" },
		],
		[
			input.inputNodeBindings[0],
			{ ...input.inputNodeBindings[1], nodeId: "image-1" },
		],
	]) {
		const invalid = await port.handle(
			"quoteGeneration",
			request({ ...input, inputNodeBindings }),
			sessionToken,
		);
		assert.equal(invalid.status, 400);
		assert.equal(
			(await invalid.json()).error.code,
			"GENERATION_INPUT_BINDING_INVALID",
		);
	}

	const invalidSubmit = await port.handle(
		"submitGeneration",
		request({
			input: {
				...input,
				inputNodeBindings: input.inputNodeBindings.slice(0, 1),
			},
			quoteId: "core-quote-1",
		}),
		sessionToken,
	);
	assert.equal(invalidSubmit.status, 400);
	assert.equal(submitted, 0);
	assert.equal(quoted.length, 1);
});

test("image quote accepts bounded pixel dimensions from the authoritative catalog", async () => {
	const ports = runtimePorts();
	const quoted: Array<Record<string, unknown>> = [];
	ports.generation.core.quote = async (input) => {
		quoted.push(input.parameters);
		return { quoteId: `core-quote-${quoted.length}` };
	};
	const { port, sessionToken } = await fixture(ports);

	for (const operation of ["image.generate", "image.edit"] as const) {
		const response = await port.handle(
			"quoteGeneration",
			request(generationContract(operation, { height: 1024, width: 1024 })),
			sessionToken,
		);
		assert.equal(response.status, 200, operation);
	}
	assert.deepEqual(quoted, [
		{ height: 1024, width: 1024 },
		{ height: 1024, width: 1024 },
	]);

	for (const parameters of [
		{ height: 1024, width: 0 },
		{ height: 1024, width: 1024.5 },
		{ height: 1024, width: 4097 },
	]) {
		const response = await port.handle(
			"quoteGeneration",
			request(generationContract("image.generate", parameters)),
			sessionToken,
		);
		assert.equal(response.status, 400, JSON.stringify(parameters));
		assert.equal((await response.json()).error.code, "INVALID_INPUT");
	}
	assert.equal(quoted.length, 2);
});

test("image quote accepts only the approved quality field", async () => {
	const ports = runtimePorts();
	const quoted: Array<Record<string, unknown>> = [];
	ports.generation.core.quote = async (input) => {
		quoted.push(input.parameters);
		return { quoteId: `core-quality-${quoted.length}` };
	};
	const { port, sessionToken } = await fixture(ports);

	for (const operation of ["image.generate", "image.edit"] as const) {
		const response = await port.handle(
			"quoteGeneration",
			request(generationContract(operation, { quality: "high" })),
			sessionToken,
		);
		assert.equal(response.status, 200, operation);
	}
	assert.deepEqual(quoted, [{ quality: "high" }, { quality: "high" }]);

	const rejected = await port.handle(
		"quoteGeneration",
		request(generationContract("image.generate", { quality: "ultra" })),
		sessionToken,
	);
	assert.equal(rejected.status, 400);
	assert.equal((await rejected.json()).error.code, "INVALID_INPUT");
});

test("generation actions reject unknown projects and mismatched revisions before Core", async () => {
	const ports = runtimePorts();
	let coreCalls = 0;
	ports.generation.core.quote = async () => {
		coreCalls += 1;
		return { quoteId: "core-quote-1" };
	};
	ports.generation.core.listProjectGenerations = async () => {
		coreCalls += 1;
		return [];
	};

	for (const [action, body] of [
		[
			"quoteGeneration",
			{ ...generationContract("text.respond", {}), revisionId: "missing" },
		],
		["listProjectGenerations", { projectId: "missing" }],
	] as const) {
		const { port, sessionToken } = await fixture(ports);
		const response = await port.handle(action, request(body), sessionToken);
		assert.equal(response.status, 404, action);
		assert.equal((await response.json()).error.code, "NOT_FOUND", action);
	}
	assert.equal(coreCalls, 0);
});

test("records every foreign object rejection as one opaque audit-only side effect", async () => {
	const ports = runtimePorts();
	ports.generation.core.getJob = async () => {
		throw new CoreGenerationProviderError(
			"GENERATION_JOB_NOT_FOUND",
			"Foreign job detail must stay private.",
			{ retryable: false, status: 404 },
		);
	};
	ports.adoption.adopt = async () => {
		throw new CoreAdvancedCanvasAdoptionError(
			"CONTENT_PACKAGE_NOT_FOUND",
			"Foreign package detail must stay private.",
			404,
		);
	};
	ports.agent.service.apply = async () => {
		throw new CanvasAgentError(
			"CONFIRMATION_NOT_FOUND",
			"Foreign confirmation detail must stay private.",
		);
	};
	const { port, sessionToken } = await fixture(ports);
	const attempts = [
		["loadProject", { projectId: "foreign-project" }],
		["getRevision", { projectId: "project-1", revisionId: "foreign-revision" }],
		["getAsset", { assetId: "foreign-asset" }],
		["getGenerationJob", { jobId: "foreign-job", projectId: "project-1" }],
		[
			"adoptAdvancedCanvasOutput",
			{
				projectId: "project-1",
				revisionRef: { kind: "frozen", revisionId: "revision-1" },
				selection: { orderedMediaNodeIds: ["image-1"] },
				target: {
					baseVersionId: "foreign-version",
					expectedRevision: 0,
					kind: "existing_package",
					packageId: "foreign-package",
				},
			},
		],
		["getProviderReferenceGrant", { grantId: "foreign-grant" }],
		[
			"applyAgentOps",
			{
				credentialId: "foreign-confirmation",
				expectedRevision: 1,
				projectId: "project-1",
			},
		],
	] as const;

	for (const [action, body] of attempts) {
		const response = await port.handle(action, request(body), sessionToken);
		const envelope = await response.json();
		assert.equal(response.status, 404, action);
		assert.equal(envelope.error.code, "NOT_FOUND", action);
		assert.equal(
			envelope.error.message,
			"Canvas object was not found.",
			action,
		);
		assert.equal(
			JSON.stringify(envelope).includes(Object.values(body)[0]),
			false,
		);
	}

	const listed = await port.handle(
		"listSecurityRejectionAudit",
		request({}),
		sessionToken,
	);
	assert.equal(listed.status, 200);
	const events = (await listed.json()).data;
	assert.deepEqual(
		events.map((event: { objectKind: string }) => event.objectKind),
		["project", "revision", "asset", "job", "package", "grant", "confirmation"],
	);
	assert.equal(JSON.stringify(events).includes("foreign-"), false);
});

test("keeps disabled Grant access rejected when durable rejection audit is unavailable", async () => {
	const ports = runtimePorts();
	ports.securityAudit.record = async () => {
		throw new Error("audit database unavailable");
	};
	const { port, sessionToken } = await fixture(ports);

	const response = await port.handle(
		"getProviderReferenceGrant",
		request({ grantId: "foreign-grant" }),
		sessionToken,
	);
	const envelope = await response.json();
	assert.equal(response.status, 503);
	assert.equal(envelope.error.code, "SECURITY_AUDIT_UNAVAILABLE");
	assert.equal(JSON.stringify(envelope).includes("foreign-grant"), false);
});

test("preserves authoritative Core generation status and retry semantics", async () => {
	const ports = runtimePorts();
	ports.generation.core.quote = async () => {
		throw new CoreGenerationProviderError(
			"IDEMPOTENCY_CONFLICT",
			"Core rejected the quote.",
			{ retryable: false, status: 409 },
		);
	};
	const { port, sessionToken } = await fixture(ports);
	const response = await port.handle(
		"quoteGeneration",
		request(generationContract("text.respond", {})),
		sessionToken,
	);
	assert.equal(response.status, 409);
	assert.equal((await response.json()).error.code, "IDEMPOTENCY_CONFLICT");
});

test("Agent authority and canonical generation blockers are service-unavailable", async () => {
	for (const code of [
		"AGENT_AUTHORITY_UNAVAILABLE",
		"AGENT_GENERATION_UNAVAILABLE",
	] as const) {
		const ports = runtimePorts();
		ports.agent.service.plan = async () => {
			throw new CanvasAgentError(code, "Agent runtime is not configured.");
		};
		const { port, sessionToken } = await fixture(ports);

		const response = await port.handle(
			"planAgent",
			request({
				intent: "Create a node",
				maxCostMicros: 0,
				maxGenerationCount: 0,
				projectId: "project-1",
			}),
			sessionToken,
		);

		assert.equal(response.status, 503, code);
		assert.equal((await response.json()).error.code, code);
	}
});

test("submitGeneration returns the authoritative Core text deliverable", async () => {
	const ports = runtimePorts();
	let submitCalls = 0;
	ports.generation.core.submit = async (input) => {
		submitCalls += 1;
		return {
			deliverable: { kind: "text", text: "Core text" },
			jobId: "core-job-1",
			projectId: input.projectId,
			status: "completed" as const,
		};
	};
	const { port, sessionToken } = await fixture(ports);

	const response = await port.handle(
		"submitGeneration",
		request({
			input: generationContract("text.respond", {}),
			quoteId: "quote-1",
		}),
		sessionToken,
	);

	assert.equal(response.status, 200);
	assert.equal((await response.json()).data.deliverable.text, "Core text");
	assert.equal(submitCalls, 1);
});

test("purchase fails closed when no trusted billing verifier is configured", async () => {
	const ports = runtimePorts();
	ports.entitlement.service.purchase = async () => {
		throw new ProStudioEntitlementError(
			"BILLING_UNAVAILABLE",
			"Purchase must complete through billing.",
		);
	};
	const { port, sessionToken } = await fixture(ports);
	const response = await port.handle(
		"purchaseProStudio",
		request({ offerId: "pro-studio-v1", paymentEventId: "browser-claim" }),
		sessionToken,
	);

	assert.equal(response.status, 503);
	assert.equal((await response.json()).error.code, "BILLING_UNAVAILABLE");
});

test("rejects browser-supplied workspace, role and Agent session identity", async () => {
	const { port, sessionToken } = await fixture();
	for (const [action, body] of [
		[
			"quoteGeneration",
			{
				inputAssetIds: [],
				operation: "image.generate",
				parameters: {},
				projectId: "project-1",
				prompt: "Create a nail image",
				revisionId: "revision-1",
				role: "owner",
				workspaceId: "workspace-2",
			},
		],
		[
			"planAgent",
			{
				intent: "Create a node",
				maxCostMicros: 0,
				maxGenerationCount: 0,
				projectId: "project-1",
				sessionId: "browser-session",
			},
		],
	] as const) {
		const response = await port.handle(action, request(body), sessionToken);
		assert.equal(response.status, 400, action);
		assert.equal((await response.json()).error.code, "INVALID_INPUT", action);
	}
});

test("adoption receives the caller idempotency key from the header", async () => {
	const ports = runtimePorts();
	let observed = "";
	ports.adoption.adopt = async (_context, command) => {
		observed = command.idempotencyKey;
		return {
			orderedMediaNodeIds: ["image-1"],
			packageId: "package-1",
			projectId: "project-1",
			revisionId: "revision-1",
			selectedNodeIds: ["text-1", "image-1"],
			versionId: "version-1",
		};
	};
	const { port, sessionToken } = await fixture(ports);
	const response = await port.handle(
		"adoptAdvancedCanvasOutput",
		request({
			projectId: "project-1",
			revisionRef: { kind: "frozen", revisionId: "revision-1" },
			selection: {
				orderedMediaNodeIds: ["image-1"],
				textNodeId: "text-1",
			},
			target: { kind: "new_package" },
		}),
		sessionToken,
	);

	assert.equal(response.status, 200);
	assert.equal(observed, "test-idempotency-key");
});

test("maps Core adoption availability failures to 503 and preserves business conflicts", async () => {
	for (const [code, status, expectedStatus] of [
		["CORE_UNREACHABLE", 503, 503],
		["CORE_RESPONSE_INVALID", 503, 503],
		["CORE_SERVICE_TOKEN_REQUIRED", 503, 503],
		["CORE_SERVICE_URL_INVALID", 503, 503],
		["CONTENT_VERSION_CONFLICT", 409, 409],
	] as const) {
		const ports = runtimePorts();
		ports.adoption.adopt = async () => {
			throw new CoreAdvancedCanvasAdoptionError(
				code,
				"Core rejected adoption.",
				status,
			);
		};
		const { port, sessionToken } = await fixture(ports);
		const response = await port.handle(
			"adoptAdvancedCanvasOutput",
			request({
				projectId: "project-1",
				revisionRef: { kind: "frozen", revisionId: "revision-1" },
				selection: {
					orderedMediaNodeIds: ["image-1"],
					textNodeId: "text-1",
				},
				target: { kind: "new_package" },
			}),
			sessionToken,
		);

		assert.equal(response.status, expectedStatus, code);
		assert.equal((await response.json()).error.code, code);
	}
});

function activeCapability(
	operation:
		| "audio.sfx"
		| "audio.speech"
		| "image.edit"
		| "image.generate"
		| "text.respond"
		| "video.generate",
	output: "audio" | "image" | "text" | "video",
	allowedParameters: string[],
) {
	return {
		activation: "active" as const,
		activationEvidence: {
			configurationRevision: "a".repeat(64),
			evidenceId: `activation-probe-${"b".repeat(24)}`,
			probedAt: "2026-07-16T00:00:00.000Z",
			status: "live_verified" as const,
		},
		allowedParameters,
		estimatedDurationSeconds: [5, 60] as [number, number],
		modelId: "incorrectly-active-model",
		operation,
		output,
		usageAmount: 1,
		usageResource: output === "text" ? ("copy" as const) : output,
	};
}

function generationContract(
	operation:
		| "image.edit"
		| "image.generate"
		| "text.respond"
		| "video.generate",
	parameters: Record<string, unknown>,
) {
	return {
		checkpointId: "revision-1",
		count: 1,
		inputAssets: [],
		itemId: "canvas-item-1",
		operation,
		parameters,
		projectId: "project-1",
		prompt: "Create a beauty campaign asset",
		revisionId: "revision-1",
	};
}

function request(
	body: unknown,
	options: {
		csrf?: boolean;
		headers?: Record<string, string>;
		method?: string;
	} = {},
) {
	const csrf = options.csrf ?? true;
	return new Request("https://canvas.example.test/api/canvas/action", {
		method: options.method ?? "POST",
		headers: {
			"content-type": "application/json",
			cookie: csrf ? "__Host-canvas-csrf=csrf-token" : "",
			"idempotency-key": "test-idempotency-key",
			origin: "https://canvas.example.test",
			"sec-fetch-site": "same-origin",
			...(csrf ? { "x-csrf-token": "csrf-token" } : {}),
			...(options.headers ?? {}),
		},
		body: JSON.stringify(body),
	});
}
