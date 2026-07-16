import {
	AdvancedCanvasProjectService,
	CanvasAssetFacade,
	CanvasSessionService,
	CompositeCanvasObjectStorage,
	CoreCanvasObjectStorage,
	FileSystemCanvasObjectStorage,
	type LaunchCodeContext,
	LaunchCodeError,
	LaunchCodeService,
	migrateProStudioSchema,
	PostgresAdvancedCanvasProjectRepository,
	PostgresCanvasAssetRepository,
	PostgresLaunchCodeRepository,
	PostgresProStudioAccessAudit,
} from "@meiye/core/pro-studio";
import {
	type AgentAuditEvent,
	AuthoritativeCanvasAgentAuthorizationAdapter,
	CanvasAgentApplicationService,
	CanvasAgentGenerationConsumer,
	type CanvasAgentWorkspaceState,
	createPostgresProStudioEntitlementRepository,
	migrateProStudioWorkspaceState,
	PostgresCanvasAgentAuthoritySource,
	PostgresCanvasAgentRepository,
	ProStudioEntitlementApplicationService,
} from "@meiye/core/pro-studio-runtime";
import { Pool } from "pg";
import { CanvasBackendPort } from "./backend-port";
import {
	CORE_GENERATION_DISPATCH_REVISIONS,
	CoreCanonicalGenerationAdapter,
	CoreGenerationAuthority,
	CoreQuotaAuthority,
	DurableGenerationConsumerWorker,
} from "./canonical-generation";
import { CoreAdvancedCanvasAdoptionClient } from "./core-adoption-client";
import { CoreGenerationProvider } from "./core-generation-provider";
import { CoreCanvasAgentPlanner } from "./core-planner";
import { canIssueProStudioLaunch } from "./launch-entitlement";
import { PostgresProStudioBillingVerifier } from "./postgres-pro-studio-billing-verifier";
import { proStudioOffer } from "./pro-studio-offer";

interface CanvasRuntime {
	backend: CanvasBackendPort;
	entry: {
		get(input: {
			mainSessionId: string;
			userId: string;
			workspaceId: string;
		}): ReturnType<ProStudioEntitlementApplicationService["getEntry"]>;
	};
	launch: LaunchCodeService;
	purchases: {
		activate(input: {
			offerId: string;
			paymentEventId: string;
			userId: string;
			workspaceId: string;
		}): ReturnType<ProStudioEntitlementApplicationService["purchase"]>;
	};
	sessions: CanvasSessionService;
}

export class MainSessionAvailabilityError extends Error {
	readonly code = "MAIN_SESSION_UNAVAILABLE";

	constructor(message: string, options?: ErrorOptions) {
		super(message, options);
		this.name = "MainSessionAvailabilityError";
	}
}

const globalRuntime = globalThis as typeof globalThis & {
	__meiyeCanvasRuntime?: Promise<CanvasRuntime>;
};

export function canvasRuntime() {
	globalRuntime.__meiyeCanvasRuntime ??= createRuntime();
	return globalRuntime.__meiyeCanvasRuntime;
}

async function createRuntime(): Promise<CanvasRuntime> {
	const databaseUrl = requiredEnv("DATABASE_URL");
	const pool = new Pool({ connectionString: databaseUrl, max: 10 });
	await migrateProStudioSchema(pool);
	await migrateProStudioWorkspaceState(pool);
	const coreServiceToken = requiredEnv("CORE_SERVICE_TOKEN");
	const coreServiceUrl =
		process.env.CORE_SERVICE_URL ?? "http://127.0.0.1:4100";

	const launchRepository = new PostgresLaunchCodeRepository(pool);
	const projectRepository = new PostgresAdvancedCanvasProjectRepository(pool);
	const assetRepository = new PostgresCanvasAssetRepository(pool);
	const accessAudit = new PostgresProStudioAccessAudit(pool);
	const projects = new AdvancedCanvasProjectService({
		repository: projectRepository,
	});
	const assets = new CanvasAssetFacade({
		accessAudit,
		repository: assetRepository,
		storage: new CompositeCanvasObjectStorage(
			new FileSystemCanvasObjectStorage(
				process.env.CANVAS_OBJECT_STORAGE_ROOT ?? ".data/canvas-assets",
			),
			new CoreCanvasObjectStorage({
				coreServiceToken,
				coreServiceUrl,
			}),
		),
	});
	const entitlement = new ProStudioEntitlementApplicationService(
		createPostgresProStudioEntitlementRepository(pool),
		{
			billing: new PostgresProStudioBillingVerifier(
				pool,
				process.env.PRO_STUDIO_PRICE_ID,
			),
			offer: proStudioOffer(),
		},
	);
	const resolveRole = (input: { userId: string; workspaceId: string }) =>
		resolveWorkspaceRole(pool, input);
	const generation = new CoreGenerationProvider({
		coreServiceToken,
		coreServiceUrl,
	});
	const adoption = new CoreAdvancedCanvasAdoptionClient({
		coreServiceToken,
		coreServiceUrl,
	});
	const agentAuthority = new PostgresCanvasAgentAuthoritySource(pool);
	const generationAuthority = new CoreGenerationAuthority(pool, generation);
	const quotaAuthority = new CoreQuotaAuthority(generation);
	const agentAuthorization = new AuthoritativeCanvasAgentAuthorizationAdapter({
		authority: agentAuthority,
		generation: generationAuthority,
		quota: quotaAuthority,
	});
	const agentRepository = new PostgresCanvasAgentRepository(
		pool,
		agentAuthorization,
	);
	const agentPlanner = new CoreCanvasAgentPlanner(generation);
	const canonicalGeneration = new CoreCanonicalGenerationAdapter({
		authority: generationAuthority,
		core: generation,
		ownership: agentAuthority,
		projects: agentRepository,
	});
	const generationConsumer = new CanvasAgentGenerationConsumer(
		agentRepository,
		canonicalGeneration,
	);
	const generationWorker = new DurableGenerationConsumerWorker(
		pool,
		generationConsumer,
	);
	generationWorker.start();
	const agent = new CanvasAgentApplicationService(agentRepository, {
		accessAudit,
		authorization: agentAuthorization,
		generationOutbox: { revisions: CORE_GENERATION_DISPATCH_REVISIONS },
		planner: agentPlanner,
	});
	const validateUpstream = (context: LaunchCodeContext) =>
		validateMainSession(context);
	const sessions = new CanvasSessionService({
		repository: launchRepository,
		upstream: { isActive: validateUpstream },
	});
	const launch = new LaunchCodeService({
		repository: launchRepository,
		access: {
			async canAccessWorkspace(input) {
				return canIssueProStudioLaunch(input, {
					assertCanEnter: (context) => entitlement.assertCanEnter(context),
					resolveRole,
					validateMainSession: (context) =>
						validateMainSession({
							audience: { kind: "workspace" },
							...context,
						}),
				});
			},
			async canAccessProject(input) {
				if (
					!(await canIssueProStudioLaunch(input, {
						assertCanEnter: (context) => entitlement.assertCanEnter(context),
						resolveRole,
						validateMainSession: (context) =>
							validateMainSession({
								audience: {
									kind: "project",
									projectId: input.projectId,
								},
								...context,
							}),
					}))
				) {
					return false;
				}
				return Boolean(
					await projectRepository.getProject(
						input.workspaceId,
						input.projectId,
					),
				);
			},
		},
	});
	return {
		backend: new CanvasBackendPort({
			adoption,
			allowedOrigin: process.env.CANVAS_ORIGIN ?? "http://127.0.0.1:4200",
			agent: {
				audit: {
					list: (input) => listAgentAudit(pool, input),
				},
				service: agent,
			},
			assets,
			entitlement: { resolveRole, service: entitlement },
			generation: {
				catalog: {
					async list(input) {
						const [plannerReady, generationReady] = await Promise.all([
							agentPlanner.isAvailable(input.workspaceId),
							canonicalGeneration.isReady(input.workspaceId),
						]);
						const agentAvailable =
							plannerReady && generationReady && generationWorker.isStarted();
						return {
							agent: {
								activation: agentAvailable
									? ("active" as const)
									: ("inactive" as const),
								...(agentAvailable
									? {}
									: {
											reason:
												"Canvas Agent requires ready Core planning and generation dispatch.",
										}),
							},
							operations: [],
						};
					},
				},
				core: generation,
			},
			projects,
			sessions,
		}),
		entry: {
			async get(input) {
				if (
					!(await validateMainSession({
						audience: { kind: "workspace" },
						...input,
					}))
				) {
					throw new LaunchCodeError(
						"SESSION_EXPIRED",
						"Main session is not active.",
					);
				}
				const role = await resolveRole(input);
				if (!role) {
					throw new LaunchCodeError(
						"FORBIDDEN",
						"Workspace membership is required.",
					);
				}
				return entitlement.getEntry({
					correlationId: `entry-${crypto.randomUUID()}`,
					role,
					userId: input.userId,
					workspaceId: input.workspaceId,
				});
			},
		},
		launch,
		purchases: {
			async activate(input) {
				const role = await resolveRole(input);
				if (role !== "owner") {
					throw new Error("Workspace owner membership is required.");
				}
				return entitlement.purchase(
					{
						correlationId: `pro-studio-payment-${input.paymentEventId}`,
						role,
						userId: input.userId,
						workspaceId: input.workspaceId,
					},
					{
						idempotencyKey: `pro-studio-payment-${input.paymentEventId}`,
						offerId: input.offerId,
						paymentEventId: input.paymentEventId,
					},
				);
			},
		},
		sessions,
	};
}

async function resolveWorkspaceRole(
	pool: Pool,
	input: { userId: string; workspaceId: string },
) {
	const result = await pool.query<{ role: string }>(
		`SELECT role FROM workspace_memberships
		 WHERE workspace_id = $1 AND user_id = $2`,
		[input.workspaceId, input.userId],
	);
	const role = result.rows[0]?.role;
	return role === "owner" || role === "operator" || role === "reviewer"
		? role
		: null;
}

async function listAgentAudit(
	pool: Pool,
	input: { projectId: string; userId: string; workspaceId: string },
) {
	const result = await pool.query<{ state: CanvasAgentWorkspaceState }>(
		`SELECT state FROM pro_studio_workspace_state
		 WHERE namespace = 'agent' AND workspace_id = $1`,
		[input.workspaceId],
	);
	return structuredClone(
		(result.rows[0]?.state.auditEvents ?? []).filter(
			(event: AgentAuditEvent) =>
				event.projectId === input.projectId && event.userId === input.userId,
		),
	);
}

export async function validateMainSession(context: LaunchCodeContext) {
	let response: Response;
	try {
		response = await fetch(
			new URL(
				"/api/pro-studio/launch",
				process.env.MAIN_APP_ORIGIN ?? "http://127.0.0.1:3000",
			),
			{
				body: JSON.stringify({
					action: "validate",
					audience: context.audience,
					mainSessionId: context.mainSessionId,
					userId: context.userId,
					workspaceId: context.workspaceId,
				}),
				cache: "no-store",
				headers: {
					"content-type": "application/json",
					"x-canvas-service-token": requiredEnv("CANVAS_SERVICE_TOKEN"),
				},
				method: "POST",
			},
		);
	} catch (error) {
		throw new MainSessionAvailabilityError(
			"Main session validation is unavailable.",
			{ cause: error },
		);
	}
	if (response.status === 204) return true;
	if (response.status === 401 || response.status === 403) return false;
	throw new MainSessionAvailabilityError(
		`Main session validation returned status ${response.status}.`,
	);
}

function requiredEnv(name: string) {
	const value = process.env[name]?.trim();
	if (!value) throw new Error(`${name} is required by the Canvas service.`);
	return value;
}
