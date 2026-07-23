import assert from "node:assert/strict";
import test from "node:test";
import {
	type CanvasGenerationFanOutCaller,
	quoteFanOutGeneration,
	submitQuotedFanOutGeneration,
} from "./generation-batch-orchestrator.js";

const generationInput = {
	inputAssets: [],
	inputNodeBindings: [],
	operation: "image.generate" as const,
	parameters: { ratio: "1:1" },
	projectId: "project-1",
	prompt: "Create a beauty campaign visual",
	revisionId: "revision-1",
};

type Call = {
	action: "quoteGeneration" | "submitGeneration";
	idempotencyKey: string;
	input: Record<string, unknown>;
};

test("quotes count=2 through strict existing DTOs, totals the quotes, and submits nothing", async () => {
	const calls: Call[] = [];
	const caller: CanvasGenerationFanOutCaller = async (
		action,
		input,
		options,
	) => {
		calls.push({ action, idempotencyKey: options.idempotencyKey, input });
		if (action === "submitGeneration") throw new Error("submit must not run");
		return {
			estimatedProviderCost: {
				amountMicros: 125_000,
				currency: "CNY" as const,
				unit: "request",
			},
			quoteId: `quote-${options.idempotencyKey}`,
		};
	};

	const projection = await quoteFanOutGeneration(caller, {
		batchKey: "canvas-intent-42",
		count: 2,
		input: generationInput,
	});

	assert.equal(projection.canConfirm, true);
	assert.deepEqual(projection.totalEstimatedProviderCost, {
		amountMicros: 250_000,
		currency: "CNY",
		unit: "request",
	});
	assert.deepEqual(
		projection.items.map((item) => [
			item.itemKey,
			item.state,
			item.quote?.quoteId,
		]),
		[
			[
				"canvas-intent-42:item:1",
				"quoted",
				"quote-canvas-generation:canvas-intent-42:item:1:quote",
			],
			[
				"canvas-intent-42:item:2",
				"quoted",
				"quote-canvas-generation:canvas-intent-42:item:2:quote",
			],
		],
	);
	assert.deepEqual(
		calls.map((call) => [call.action, call.idempotencyKey]),
		[
			["quoteGeneration", "canvas-generation:canvas-intent-42:item:1:quote"],
			["quoteGeneration", "canvas-generation:canvas-intent-42:item:2:quote"],
		],
	);
	assert.deepEqual(
		calls.map((call) => call.input),
		[
			{
				...generationInput,
				count: 1,
				itemId: "canvas-intent-42:item:1",
			},
			{
				...generationInput,
				count: 1,
				itemId: "canvas-intent-42:item:2",
			},
		],
	);
	for (const call of calls) assert.equal("batchKey" in call.input, false);
});

test("accepts count=1 and count=15, and rejects count=16 before an existing action", async () => {
	let calls = 0;
	const caller: CanvasGenerationFanOutCaller = async (
		action,
		_input,
		options,
	) => {
		calls += 1;
		assert.equal(action, "quoteGeneration");
		return {
			estimatedProviderCost: {
				amountMicros: 1,
				currency: "CNY" as const,
				unit: "request",
			},
			quoteId: `quote-${options.idempotencyKey}`,
		};
	};

	const one = await quoteFanOutGeneration(caller, {
		batchKey: "canvas-intent-1",
		count: 1,
		input: generationInput,
	});
	assert.equal(one.items.length, 1);
	const fifteen = await quoteFanOutGeneration(caller, {
		batchKey: "canvas-intent-15",
		count: 15,
		input: generationInput,
	});
	assert.equal(fifteen.items.length, 15);
	assert.equal(calls, 16);

	await assert.rejects(
		quoteFanOutGeneration(caller, {
			batchKey: "canvas-intent-16",
			count: 16,
			input: generationInput,
		}),
		/count between 1 and 15/u,
	);
	assert.equal(calls, 16);
});

test("partial quote failure blocks confirmation and leaves submit at zero", async () => {
	const calls: Call[] = [];
	const caller: CanvasGenerationFanOutCaller = async (
		action,
		input,
		options,
	) => {
		calls.push({ action, idempotencyKey: options.idempotencyKey, input });
		if (action === "submitGeneration") throw new Error("must not submit");
		if (options.idempotencyKey.endsWith(":item:2:quote")) {
			const error = new Error("Model unavailable");
			Object.assign(error, { code: "MODEL_UNAVAILABLE" });
			throw error;
		}
		return {
			estimatedProviderCost: {
				amountMicros: 125_000,
				currency: "CNY" as const,
				unit: "request",
			},
			quoteId: "quote-1",
		};
	};

	const projection = await quoteFanOutGeneration(caller, {
		batchKey: "canvas-intent-partial-quote",
		count: 2,
		input: generationInput,
	});

	assert.equal(projection.canConfirm, false);
	assert.equal(projection.totalEstimatedProviderCost, null);
	assert.deepEqual(
		projection.items.map((item) => [item.state, item.error?.code]),
		[
			["quoted", undefined],
			["quote_failed", "MODEL_UNAVAILABLE"],
		],
	);
	await assert.rejects(
		submitQuotedFanOutGeneration(caller, projection),
		/requires a successful quote for every item/u,
	);
	assert.equal(
		calls.filter((call) => call.action === "submitGeneration").length,
		0,
	);
});

test("submits only already quoted members after confirmation and projects committed/refunded jobs", async () => {
	const calls: Call[] = [];
	const caller: CanvasGenerationFanOutCaller = async (
		action,
		input,
		options,
	) => {
		calls.push({ action, idempotencyKey: options.idempotencyKey, input });
		if (action === "quoteGeneration") {
			return {
				estimatedProviderCost: {
					amountMicros: 125_000,
					currency: "CNY" as const,
					unit: "request",
				},
				quoteId: `quote-${options.idempotencyKey}`,
			};
		}
		if (options.idempotencyKey.endsWith(":item:1:submit")) {
			return {
				deliverable: { kind: "text" as const, text: "Delivered." },
				jobId: "job-success",
				modelId: "image-model-1",
				projectId: "project-1",
				revisionId: "revision-1",
				status: "completed",
				usage: { quantity: 1, status: "committed" as const },
			};
		}
		return {
			deliverable: null,
			failureCode: "PROVIDER_REJECTED",
			jobId: "job-failed",
			modelId: "image-model-1",
			projectId: "project-1",
			revisionId: "revision-1",
			status: "failed",
			usage: { quantity: 1, status: "refunded" as const },
		};
	};
	const quoted = await quoteFanOutGeneration(caller, {
		batchKey: "canvas-intent-partial-submit",
		count: 2,
		input: generationInput,
	});
	assert.equal(
		calls.filter((call) => call.action === "submitGeneration").length,
		0,
	);

	const projection = await submitQuotedFanOutGeneration(caller, quoted);

	assert.deepEqual(
		projection.items.map((item) => [
			item.state,
			item.job?.status,
			item.job?.usage?.status,
		]),
		[
			["submitted", "completed", "committed"],
			["submitted", "failed", "refunded"],
		],
	);
	assert.deepEqual(
		calls
			.filter((call) => call.action === "submitGeneration")
			.map((call) => call.input),
		[
			{
				input: {
					...generationInput,
					count: 1,
					itemId: "canvas-intent-partial-submit:item:1",
				},
				quoteId:
					"quote-canvas-generation:canvas-intent-partial-submit:item:1:quote",
			},
			{
				input: {
					...generationInput,
					count: 1,
					itemId: "canvas-intent-partial-submit:item:2",
				},
				quoteId:
					"quote-canvas-generation:canvas-intent-partial-submit:item:2:quote",
			},
		],
	);
});

test("keeps each quoted member input frozen until explicit confirmation", async () => {
	const calls: Call[] = [];
	const caller: CanvasGenerationFanOutCaller = async (
		action,
		input,
		options,
	) => {
		calls.push({ action, idempotencyKey: options.idempotencyKey, input });
		if (action === "quoteGeneration") {
			return {
				estimatedProviderCost: {
					amountMicros: 1,
					currency: "CNY" as const,
					unit: "request",
				},
				quoteId: `quote-${options.idempotencyKey}`,
			};
		}
		return {
			deliverable: null,
			jobId: "job-1",
			modelId: "image-model-1",
			projectId: "project-1",
			revisionId: "revision-1",
			status: "queued",
		};
	};
	const input = {
		...generationInput,
		inputAssets: [{ assetId: "asset-1", role: "reference_image" as const }],
		inputNodeBindings: [
			{
				assetId: "asset-1",
				nodeId: "node-1",
				role: "reference_image" as const,
			},
		],
		parameters: { ratio: "1:1" },
	};
	const quoted = await quoteFanOutGeneration(caller, {
		batchKey: "frozen-intent-1",
		count: 1,
		input,
	});
	const firstAsset = input.inputAssets[0];
	const firstBinding = input.inputNodeBindings[0];
	assert.ok(firstAsset);
	assert.ok(firstBinding);
	firstAsset.assetId = "mutated-asset";
	firstBinding.nodeId = "mutated-node";
	input.parameters.ratio = "16:9";

	await submitQuotedFanOutGeneration(caller, quoted);

	assert.deepEqual(calls[1]?.input, {
		input: {
			...generationInput,
			count: 1,
			inputAssets: [{ assetId: "asset-1", role: "reference_image" }],
			inputNodeBindings: [
				{
					assetId: "asset-1",
					nodeId: "node-1",
					role: "reference_image",
				},
			],
			itemId: "frozen-intent-1:item:1",
			parameters: { ratio: "1:1" },
		},
		quoteId: "quote-canvas-generation:frozen-intent-1:item:1:quote",
	});
});

test("replays quote and confirmation with stable member idempotency keys", async () => {
	const seenEffects = new Set<string>();
	let providerEffects = 0;
	const caller: CanvasGenerationFanOutCaller = async (
		action,
		_input,
		options,
	) => {
		const effectKey = `${action}:${options.idempotencyKey}`;
		if (!seenEffects.has(effectKey)) {
			seenEffects.add(effectKey);
			providerEffects += action === "submitGeneration" ? 1 : 0;
		}
		if (action === "quoteGeneration") {
			return {
				estimatedProviderCost: {
					amountMicros: 1,
					currency: "CNY" as const,
					unit: "request",
				},
				quoteId: `quote-${options.idempotencyKey}`,
			};
		}
		return {
			deliverable: null,
			jobId: `job-${options.idempotencyKey}`,
			modelId: "image-model-1",
			projectId: "project-1",
			revisionId: "revision-1",
			status: "queued",
			usage: { quantity: 1, status: "reserved" as const },
		};
	};
	const input = {
		batchKey: "recoverable-intent-1",
		count: 2,
		input: generationInput,
	};

	const firstQuotes = await quoteFanOutGeneration(caller, input);
	const first = await submitQuotedFanOutGeneration(caller, firstQuotes);
	const replayQuotes = await quoteFanOutGeneration(caller, input);
	const replay = await submitQuotedFanOutGeneration(caller, replayQuotes);

	assert.deepEqual(
		replay.items.map((item) => item.idempotencyKey),
		first.items.map((item) => item.idempotencyKey),
	);
	assert.equal(providerEffects, 2);
});
