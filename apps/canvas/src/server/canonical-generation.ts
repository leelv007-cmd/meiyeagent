import { createHash } from "node:crypto";

import {
	CanonicalGenerationError,
	type CanvasAgentAuthoritySource,
	type CanvasAgentCanonicalGenerationInput,
	type CanvasAgentCanonicalGenerationPort,
	type CanvasAgentContext,
	CanvasAgentError,
	type CanvasAgentGenerationAuthorityPort,
	type CanvasAgentOperation,
	type CanvasAgentQuotaQuotePort,
	type CanvasAgentRepository,
	type CanvasAgentTransactionDatabase,
} from "@meiye/core/pro-studio-runtime";
import {
	type CoreGenerationIdentity,
	type CoreGenerationProvider,
	CoreGenerationProviderError,
	type CoreGenerationQuoteInput,
} from "./core-generation-provider";

type GenerationOperation = Extract<
	CanvasAgentOperation,
	{ tool: "run_generation" }
>["operation"];
type InputRole = Extract<
	CanvasAgentOperation,
	{ tool: "run_generation" }
>["inputAssets"][number]["role"];

const generationOperations: GenerationOperation[] = [
	"image.generate",
	"image.edit",
	"text.respond",
	"video.generate",
	"audio.speech",
	"audio.sfx",
];
const inputRoles = new Set<InputRole>([
	"reference_image",
	"reference_video",
	"reference_audio",
	"mask",
]);

export const CORE_GENERATION_DISPATCH_REVISIONS = Object.fromEntries(
	generationOperations.map((operation) => [
		operation,
		"core-generation-facade-v1",
	]),
) as Record<GenerationOperation, string>;

interface QueryPort {
	query(
		sql: string,
		values?: unknown[],
	): Promise<{ rows: Array<Record<string, unknown>> }>;
}

interface CoreCatalogPort {
	getCatalog(input: CoreGenerationIdentity): Promise<unknown>;
}

type CoreCanonicalPort = Pick<
	CoreGenerationProvider,
	"getCatalog" | "quote" | "submit"
>;

export class CoreGenerationAuthority
	implements CanvasAgentGenerationAuthorityPort
{
	constructor(
		private readonly database: QueryPort,
		private readonly core: CoreCatalogPort,
	) {}

	async assertCanGenerate(
		input: Parameters<
			CanvasAgentGenerationAuthorityPort["assertCanGenerate"]
		>[0],
	) {
		await assertEntitled(this.database, input.workspaceId);
		return this.resolve(input);
	}

	async assertCanGenerateInTransaction(
		database: CanvasAgentTransactionDatabase,
		input: Parameters<
			CanvasAgentGenerationAuthorityPort["assertCanGenerate"]
		>[0],
	) {
		await assertEntitled(database, input.workspaceId, true);
		return this.resolve(input);
	}

	private async resolve(
		input: Parameters<
			CanvasAgentGenerationAuthorityPort["assertCanGenerate"]
		>[0],
	) {
		const catalog = catalogView(
			await this.core.getCatalog({
				correlationId: `agent-generation-authority-${input.operationHash}`,
				userId: input.userId,
				workspaceId: input.workspaceId,
			}),
		);
		const capability = catalog.operations.find(
			(candidate) =>
				candidate.operation === input.operation &&
				candidate.activation === "active" &&
				Boolean(candidate.modelId),
		);
		if (!capability) {
			throw new CanvasAgentError(
				"AGENT_GENERATION_UNAVAILABLE",
				"Canvas Agent generation capability is not active in Core.",
			);
		}
		return {
			allowedInputAssetRoles: [...capability.allowedInputAssetRoles],
			revision: digest({
				catalogRevisionId: catalog.revisionId,
				capability,
			}),
		};
	}
}

export class CoreQuotaAuthority implements CanvasAgentQuotaQuotePort {
	constructor(private readonly core: CoreCatalogPort) {}

	async quote(input: Parameters<CanvasAgentQuotaQuotePort["quote"]>[0]) {
		const catalog = catalogView(
			await this.core.getCatalog({
				correlationId: `agent-quota-${input.operationHash}`,
				userId: input.userId,
				workspaceId: input.workspaceId,
			}),
		);
		for (const operation of input.operations) {
			if (operation.tool !== "run_generation") continue;
			if (
				!catalog.operations.some(
					(candidate) =>
						candidate.activation === "active" &&
						candidate.operation === operation.operation,
				)
			) {
				throw new CanvasAgentError(
					"AGENT_GENERATION_UNAVAILABLE",
					"Canvas Agent quota cannot bind an inactive Core capability.",
				);
			}
		}
		const revision = digest({
			catalogRevisionId: catalog.revisionId,
			maxCostMicros: input.maxCostMicros,
			maxGenerationCount: input.maxGenerationCount,
			operationHash: input.operationHash,
		});
		return {
			id: `core-agent-quota-${revision.slice(0, 24)}`,
			maxCostMicros: input.maxCostMicros,
			maxGenerationCount: input.maxGenerationCount,
			operationHash: input.operationHash,
			revision,
		};
	}

	async quoteInTransaction(
		_database: CanvasAgentTransactionDatabase,
		input: Parameters<CanvasAgentQuotaQuotePort["quote"]>[0],
	) {
		return this.quote(input);
	}
}

export class CoreCanonicalGenerationAdapter
	implements CanvasAgentCanonicalGenerationPort
{
	constructor(
		private readonly dependencies: {
			authority: CoreGenerationAuthority;
			core: CoreCanonicalPort;
			ownership: Pick<CanvasAgentAuthoritySource, "resolve">;
			projects: Pick<CanvasAgentRepository, "readGraph">;
		},
	) {}

	async isReady(workspaceId: string) {
		try {
			const catalog = catalogView(
				await this.dependencies.core.getCatalog({
					correlationId: "canonical-generation-readiness",
					userId: "canonical-generation-readiness",
					workspaceId,
				}),
			);
			return catalog.operations.some(
				(candidate) => candidate.activation === "active" && candidate.modelId,
			);
		} catch {
			return false;
		}
	}

	async validateReadSet(
		context: CanvasAgentContext,
		input: Parameters<CanvasAgentCanonicalGenerationPort["validateReadSet"]>[1],
	) {
		const assetIds = [
			...new Set(input.inputAssets.map((asset) => asset.assetId)),
		].sort();
		const [authority, graph] = await Promise.all([
			this.dependencies.ownership.resolve({
				assetIds,
				projectId: input.projectId,
				userId: context.userId,
				workspaceId: context.workspaceId,
			}),
			this.dependencies.projects.readGraph(
				context.workspaceId,
				input.projectId,
			),
		]);
		if (!authority || !graph) {
			throw new CanonicalGenerationError(
				"AGENT_GENERATION_READ_SET_UNAVAILABLE",
				"Canvas Agent generation read-set is unavailable.",
				{ retryable: false },
			);
		}
		return {
			assetGrantRevisions: Object.fromEntries(
				assetIds.flatMap((assetId) => {
					const revision = authority.assetGrantRevisions[assetId];
					return revision ? [[assetId, revision]] : [];
				}),
			),
			assetVersions: Object.fromEntries(
				assetIds.flatMap((assetId) => {
					const version = graph.assetVersions[assetId];
					return version ? [[assetId, version]] : [];
				}),
			),
		};
	}

	async quote(
		context: CanvasAgentContext,
		input: CanvasAgentCanonicalGenerationInput,
	) {
		try {
			const capability = await this.dependencies.authority.assertCanGenerate({
				operation: input.operation,
				operationHash: input.idempotencyKey,
				userId: context.userId,
				workspaceId: context.workspaceId,
			});
			const raw = record(
				await this.dependencies.core.quote(
					generationRequest(context, input, `${input.idempotencyKey}:quote`),
				),
			);
			return {
				capabilityRevision: capability.revision,
				costMicros: providerCostMicros(raw.estimatedProviderCost),
				dispatchRevision: CORE_GENERATION_DISPATCH_REVISIONS[input.operation],
				generationCount: 1,
				quoteId: text(raw.quoteId, "quoteId"),
				quotaQuoteId: input.quotaQuote.id,
				quotaQuoteRevision: input.quotaQuote.revision,
			};
		} catch (error) {
			throw canonicalError(error);
		}
	}

	async submit(
		context: CanvasAgentContext,
		input: CanvasAgentCanonicalGenerationInput & { quoteId: string },
	) {
		try {
			const result = await this.dependencies.core.submit({
				...generationRequest(context, input, `${input.idempotencyKey}:submit`),
				quoteId: input.quoteId,
			});
			return { jobId: text(result.jobId, "jobId") };
		} catch (error) {
			throw canonicalError(error);
		}
	}
}

export class DurableGenerationConsumerWorker {
	private started = false;
	private timer?: ReturnType<typeof setTimeout>;

	constructor(
		private readonly database: QueryPort,
		private readonly consumer: {
			runOnce(workspaceId: string): Promise<unknown>;
		},
		private readonly intervalMs = 1_000,
	) {}

	isStarted() {
		return this.started;
	}

	async runOnce() {
		const result = await this.database.query(
			`SELECT workspace_id AS "workspaceId"
			   FROM pro_studio_workspace_state AS workspace
			  WHERE namespace = 'agent'
			    AND EXISTS (
			      SELECT 1
			        FROM jsonb_array_elements(COALESCE(workspace.state->'outbox', '[]'::jsonb)) AS item
			       WHERE item->>'status' IN ('pending', 'retry', 'claimed')
			    )
			  ORDER BY updated_at, workspace_id
			  LIMIT 1`,
		);
		const workspaceId = result.rows[0]?.workspaceId as string | undefined;
		if (!workspaceId) return { status: "idle" as const };
		return this.consumer.runOnce(workspaceId);
	}

	start() {
		if (this.started) return;
		this.started = true;
		const tick = async () => {
			if (!this.started) return;
			try {
				await this.runOnce();
			} catch {
				// The durable item records classified failures; the next tick resumes work.
			}
			if (!this.started) return;
			this.timer = setTimeout(tick, this.intervalMs);
			this.timer.unref?.();
		};
		void tick();
	}

	stop() {
		this.started = false;
		if (this.timer) clearTimeout(this.timer);
	}
}

function generationRequest(
	context: CanvasAgentContext,
	input: CanvasAgentCanonicalGenerationInput,
	idempotencyKey: string,
): CoreGenerationQuoteInput {
	return {
		correlationId: context.correlationId,
		dataClass: [],
		idempotencyKey,
		inputAssets: [...input.inputAssets],
		operation: input.operation,
		parameters: {},
		projectId: input.projectId,
		prompt: input.prompt,
		revisionId: input.revisionId,
		userId: context.userId,
		workspaceId: context.workspaceId,
	};
}

async function assertEntitled(
	database: QueryPort,
	workspaceId: string,
	lock = false,
) {
	const result = await database.query(
		`SELECT true AS entitled
		   FROM pro_studio_workspace_state
		  WHERE namespace = 'entitlement'
		    AND workspace_id = $1
		    AND jsonb_array_length(COALESCE(state->'purchases', '[]'::jsonb)) > 0
		  ${lock ? "FOR SHARE" : ""}`,
		[workspaceId],
	);
	if (!result.rows[0]) {
		throw new CanvasAgentError(
			"AGENT_GENERATION_UNAVAILABLE",
			"Pro Studio generation entitlement is not active.",
		);
	}
}

function catalogView(value: unknown) {
	const raw = record(value);
	const revisionId = text(raw.revisionId, "catalog.revisionId");
	const operations = Array.isArray(raw.operations)
		? raw.operations.flatMap((candidate) => {
				if (
					!candidate ||
					typeof candidate !== "object" ||
					Array.isArray(candidate)
				)
					return [];
				const entry = candidate as Record<string, unknown>;
				if (
					!generationOperations.includes(
						entry.operation as GenerationOperation,
					) ||
					(entry.activation !== "active" && entry.activation !== "inactive")
				)
					return [];
				const roles = Array.isArray(entry.allowedInputAssetRoles)
					? entry.allowedInputAssetRoles.filter((role): role is InputRole =>
							inputRoles.has(role as InputRole),
						)
					: [];
				return [
					{
						activation: entry.activation,
						allowedInputAssetRoles: roles,
						modelId: typeof entry.modelId === "string" ? entry.modelId : null,
						operation: entry.operation as GenerationOperation,
					},
				];
			})
		: [];
	return { operations, revisionId };
}

function providerCostMicros(value: unknown) {
	const cost = record(value);
	if (
		typeof cost.amount !== "number" ||
		!Number.isFinite(cost.amount) ||
		cost.amount < 0
	) {
		throw new CanonicalGenerationError(
			"CORE_GENERATION_PRICE_UNAVAILABLE",
			"Core generation quote has no canonical provider price.",
			{ retryable: false },
		);
	}
	return Math.round(cost.amount * 1_000_000);
}

function canonicalError(error: unknown) {
	if (error instanceof CanonicalGenerationError) return error;
	if (error instanceof CoreGenerationProviderError) {
		return new CanonicalGenerationError(error.code, error.message, {
			retryable: error.options.retryable,
		});
	}
	if (error instanceof CanvasAgentError) {
		return new CanonicalGenerationError(error.code, error.message, {
			retryable: false,
		});
	}
	return new CanonicalGenerationError(
		"CORE_GENERATION_UNAVAILABLE",
		error instanceof Error ? error.message : "Core generation is unavailable.",
		{ retryable: true },
	);
}

function digest(value: unknown) {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function record(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error("Core generation response is invalid.");
	}
	return value as Record<string, unknown>;
}

function text(value: unknown, field: string) {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${field} is required.`);
	}
	return value.trim();
}
