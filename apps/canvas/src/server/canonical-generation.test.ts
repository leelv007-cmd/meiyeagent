import assert from "node:assert/strict";
import test from "node:test";
import type { CanvasAgentTransactionDatabase } from "@meiye/core/pro-studio-runtime";
import {
	CoreCanonicalGenerationAdapter,
	CoreGenerationAuthority,
	CoreQuotaAuthority,
	DurableGenerationConsumerWorker,
} from "./canonical-generation";
import type {
	CoreGenerationQuoteInput,
	CoreGenerationSubmitInput,
} from "./core-generation-provider";

const context = {
	correlationId: "corr-1",
	userId: "owner-1",
	workspaceId: "workspace-1",
};

const catalog = {
	revisionId: "catalog-r7",
	operations: [
		{
			activation: "active",
			allowedInputAssetRoles: ["reference_image"],
			modelId: "image-model-1",
			operation: "image.edit",
		},
		{
			activation: "active",
			allowedInputAssetRoles: ["reference_image"],
			modelId: "llm-model-1",
			operation: "text.respond",
		},
	],
};

test("binds Core capability roles and quota revisions", async () => {
	const database = {
		async query() {
			return { rows: [{ entitled: true }] };
		},
	};
	const core = {
		async getCatalog() {
			return catalog;
		},
	};
	const authority = new CoreGenerationAuthority(database, core);
	const quota = new CoreQuotaAuthority(core);

	const capability = await authority.assertCanGenerate({
		operation: "image.edit",
		operationHash: "operation-hash-1",
		userId: context.userId,
		workspaceId: context.workspaceId,
	});
	assert.deepEqual(capability.allowedInputAssetRoles, ["reference_image"]);
	assert.match(capability.revision, /^[a-f0-9]{64}$/u);
	assert.deepEqual(
		await authority.assertCanGenerateInTransaction(
			database as unknown as CanvasAgentTransactionDatabase,
			{
				operation: "image.edit",
				operationHash: "operation-hash-1",
				userId: context.userId,
				workspaceId: context.workspaceId,
			},
		),
		capability,
	);
	const quote = await quota.quote({
		maxCostMicros: 2_000_000,
		maxGenerationCount: 1,
		operationHash: "operation-hash-1",
		operations: [
			{
				inputAssets: [],
				operation: "image.edit",
				prompt: "Edit",
				tool: "run_generation",
			},
		],
		userId: context.userId,
		workspaceId: context.workspaceId,
	});
	assert.equal(quote.maxCostMicros, 2_000_000);
	assert.equal(quote.maxGenerationCount, 1);
	assert.equal(quote.operationHash, "operation-hash-1");
	assert.match(quote.id, /^core-agent-quota-/u);
	assert.match(quote.revision, /^[a-f0-9]{64}$/u);
});

test("revalidates the frozen read-set then calls only Core quote and submit", async () => {
	const calls: string[] = [];
	const core = {
		async getCatalog() {
			return catalog;
		},
		async quote(input: CoreGenerationQuoteInput) {
			calls.push("quote");
			assert.equal(input.revisionId, "agent-revision-1");
			assert.deepEqual(input.inputAssets, [
				{ assetId: "asset-1", role: "reference_image" },
			]);
			return {
				estimatedProviderCost: { amount: 0.75, currency: "CNY" },
				quoteId: "core-quote-1",
			};
		},
		async submit(input: CoreGenerationSubmitInput) {
			calls.push("submit");
			assert.equal(input.quoteId, "core-quote-1");
			return { jobId: "core-job-1", status: "queued" as const };
		},
	};
	const authority = new CoreGenerationAuthority(
		{
			async query() {
				return { rows: [{ entitled: true }] };
			},
		},
		core,
	);
	const adapter = new CoreCanonicalGenerationAdapter({
		authority,
		core,
		ownership: {
			async resolve() {
				return {
					assetGrantRevisions: { "asset-1": "pro_studio:sha-v1" },
					projectRevision: 4,
					role: "owner" as const,
					roleRevision: "owner-v1",
				};
			},
		},
		projects: {
			async readGraph() {
				return {
					assetVersions: { "asset-1": "sha-v1" },
					edges: [],
					nodes: [],
					projectId: "project-1",
					revision: 4,
					workspaceId: "workspace-1",
				};
			},
		},
	});

	assert.deepEqual(
		await adapter.validateReadSet(context, {
			assetGrantRevisions: { "asset-1": "pro_studio:sha-v1" },
			assetVersions: { "asset-1": "sha-v1" },
			inputAssets: [{ assetId: "asset-1", role: "reference_image" }],
			projectId: "project-1",
		}),
		{
			assetGrantRevisions: { "asset-1": "pro_studio:sha-v1" },
			assetVersions: { "asset-1": "sha-v1" },
		},
	);
	const capability = await authority.assertCanGenerate({
		operation: "image.edit",
		operationHash: "operation-hash-1",
		userId: context.userId,
		workspaceId: context.workspaceId,
	});
	const input = {
		capabilityRevision: capability.revision,
		dispatchRevision: "core-generation-facade-v1",
		idempotencyKey: "agent-generation-1",
		inputAssets: [{ assetId: "asset-1", role: "reference_image" as const }],
		localJobId: "legacy-local-job-ignored",
		operation: "image.edit" as const,
		projectId: "project-1",
		prompt: "Edit",
		quotaQuote: { id: "quota-1", revision: "quota-v1" },
		revisionId: "agent-revision-1",
	};
	const quote = await adapter.quote(context, input);
	assert.deepEqual(quote, {
		capabilityRevision: capability.revision,
		costMicros: 750_000,
		dispatchRevision: "core-generation-facade-v1",
		generationCount: 1,
		quoteId: "core-quote-1",
		quotaQuoteId: "quota-1",
		quotaQuoteRevision: "quota-v1",
	});
	assert.deepEqual(
		await adapter.submit(context, { ...input, quoteId: quote.quoteId }),
		{
			jobId: "core-job-1",
		},
	);
	assert.deepEqual(calls, ["quote", "submit"]);
});

test("durable worker discovers an outbox workspace and wakes the consumer", async () => {
	const workspaces: string[] = [];
	const worker = new DurableGenerationConsumerWorker(
		{
			async query() {
				return { rows: [{ workspaceId: "workspace-1" }] };
			},
		},
		{
			async runOnce(workspaceId: string) {
				workspaces.push(workspaceId);
				return { status: "submitted" as const };
			},
		},
	);

	assert.deepEqual(await worker.runOnce(), { status: "submitted" });
	assert.deepEqual(workspaces, ["workspace-1"]);
	assert.equal(worker.isStarted(), false);
});
