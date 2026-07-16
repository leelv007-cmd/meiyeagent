import assert from "node:assert/strict";
import test from "node:test";
import {
	AdvancedCanvasProjectService,
	CanvasAssetFacade,
	CanvasSessionService,
	LaunchCodeService,
	MemoryAdvancedCanvasProjectRepository,
	MemoryCanvasAssetRepository,
	MemoryCanvasObjectStorage,
	MemoryLaunchCodeRepository,
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
import { CoreAdvancedCanvasAdoptionError } from "./core-adoption-client.js";
import { CoreGenerationProviderError } from "./core-generation-provider.js";

async function fixture(
	ports = runtimePorts(),
	upstreamIsActive: () => Promise<boolean> = async () => true,
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
		graph: { edges: [], nodes: [], schemaVersion: 1 },
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
				async submit() {
					throw new Error("Generation is not configured in this fixture.");
				},
			},
		},
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
			getAsset: ["POST", "/api/canvas/getAsset", "none"],
			getAssetDelivery: ["GET", "/api/canvas/getAssetDelivery", "none"],
			getCatalog: ["POST", "/api/canvas/getCatalog", "none"],
			getGenerationJob: ["POST", "/api/canvas/getGenerationJob", "none"],
			getProStudioEntry: ["POST", "/api/canvas/getProStudioEntry", "none"],
			getRevision: ["POST", "/api/canvas/getRevision", "none"],
			getSessionContext: ["POST", "/api/canvas/getSessionContext", "none"],
			listAdoptions: ["POST", "/api/canvas/listAdoptions", "none"],
			listAgentAudit: ["POST", "/api/canvas/listAgentAudit", "none"],
			listAssets: ["POST", "/api/canvas/listAssets", "none"],
			listProjectGenerations: [
				"POST",
				"/api/canvas/listProjectGenerations",
				"none",
			],
			listProjects: ["POST", "/api/canvas/listProjects", "none"],
			listRevisions: ["POST", "/api/canvas/listRevisions", "none"],
			loadProject: ["POST", "/api/canvas/loadProject", "none"],
			planAgent: ["POST", "/api/canvas/planAgent", "header"],
			persistLocalCanvasArtifact: [
				"POST",
				"/api/canvas/persistLocalCanvasArtifact",
				"header",
			],
			purchaseProStudio: ["POST", "/api/canvas/purchaseProStudio", "header"],
			quoteGeneration: ["POST", "/api/canvas/quoteGeneration", "header"],
			renameProject: ["POST", "/api/canvas/renameProject", "header"],
			restoreRevision: ["POST", "/api/canvas/restoreRevision", "header"],
			saveProjectDraft: ["POST", "/api/canvas/saveProjectDraft", "header"],
			submitGeneration: ["POST", "/api/canvas/submitGeneration", "header"],
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

test("quote, submit and Agent apply explicitly require generation entitlement", async () => {
	const generationInput = {
		inputAssets: [],
		operation: "image.generate",
		parameters: {},
		projectId: "project-1",
		prompt: "Create a nail image",
		revisionId: "revision-1",
	};
	const cases = [
		["quoteGeneration", generationInput],
		["submitGeneration", { input: generationInput, quoteId: "quote-1" }],
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
	assert.equal(body.operations[0]?.modelId, "core-image-model");
	assert.equal(body.operations[0]?.activation, "active");
});

test("generation quote reaches Core without creating a Canvas-local ledger", async () => {
	const ports = runtimePorts();
	let quoteInput:
		| { inputAssets: unknown[]; workspaceId: string }
		| undefined;
	ports.generation.core.quote = async (input) => {
		quoteInput = input;
		return { quoteId: "core-quote-1", workspaceId: input.workspaceId };
	};
	const { port, sessionToken } = await fixture(ports);
	const response = await port.handle(
		"quoteGeneration",
		request(generationContract("text.respond", {})),
		sessionToken,
	);
	assert.equal(response.status, 200);
	assert.equal((await response.json()).data.quoteId, "core-quote-1");
	assert.equal(quoteInput?.workspaceId, "workspace-1");
	assert.deepEqual(quoteInput?.inputAssets, []);
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
		inputAssets: [],
		operation,
		parameters,
		projectId: "project-1",
		prompt: "Create a beauty campaign asset",
		revisionId: "revision-1",
	};
}

function request(
	body: unknown,
	options: { csrf?: boolean; method?: string } = {},
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
		},
		body: JSON.stringify(body),
	});
}
