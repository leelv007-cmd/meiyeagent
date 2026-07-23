import {
	type CANVAS_BATCH_STRATEGY,
	createFanOutGenerationLedger,
} from "../kernel-host/generation-batch-contract";
import {
	type CanvasGenerationRequest,
	type CoreCanvasGenerationJob,
	type CoreCanvasGenerationQuote,
	canvasGenerationSubmitPayload,
} from "./generation-ui-contract";

type CanvasGenerationAction = "quoteGeneration" | "submitGeneration";

export type CanvasGenerationFanOutCaller = (
	action: CanvasGenerationAction,
	input: Record<string, unknown>,
	options: { idempotencyKey: string },
) => Promise<unknown>;

export type CanvasGenerationFanOutInput = {
	batchKey: string;
	count: number;
	input: CanvasGenerationRequest;
};

export type CanvasGenerationFanOutMemberInput = CanvasGenerationRequest & {
	count: 1;
	itemId: string;
};

export type CanvasGenerationFanOutQuoteMember = {
	error?: { code: string; message: string };
	idempotencyKey: string;
	input: CanvasGenerationFanOutMemberInput;
	itemKey: string;
	quote?: CoreCanvasGenerationQuote;
	state: "quote_failed" | "quoted";
};

export type CanvasGenerationFanOutQuoteProjection = {
	batchKey: string;
	canConfirm: boolean;
	confirmation: "aggregate-N-quotes-once";
	items: CanvasGenerationFanOutQuoteMember[];
	strategy: typeof CANVAS_BATCH_STRATEGY;
	totalEstimatedProviderCost: CanvasGenerationEstimatedProviderCost | null;
};

export type CanvasGenerationFanOutSubmissionMember = {
	error?: { code: string; message: string };
	idempotencyKey: string;
	itemKey: string;
	job?: CoreCanvasGenerationJob;
	quote: CoreCanvasGenerationQuote;
	state: "submit_failed" | "submitted";
};

export type CanvasGenerationFanOutSubmissionProjection = {
	batchKey: string;
	confirmation: "aggregate-N-quotes-once";
	items: CanvasGenerationFanOutSubmissionMember[];
	strategy: typeof CANVAS_BATCH_STRATEGY;
	totalEstimatedProviderCost: CanvasGenerationEstimatedProviderCost;
};

export type CanvasGenerationEstimatedProviderCost = {
	amountMicros: number;
	currency: "CNY" | "USD";
	unit: string;
};

/**
 * Creates independent existing Core-backed quotes before the UI confirms the
 * aggregate price. The returned value is an in-memory Canvas projection only.
 */
export async function quoteFanOutGeneration(
	caller: CanvasGenerationFanOutCaller,
	request: CanvasGenerationFanOutInput,
): Promise<CanvasGenerationFanOutQuoteProjection> {
	assertFanOutCount(request.count);
	const ledger = createFanOutGenerationLedger(
		request.batchKey,
		Array.from({ length: request.count }, () => ({
			operation: request.input.operation,
		})),
	);
	const items: CanvasGenerationFanOutQuoteMember[] = [];

	for (const item of ledger.items) {
		const input = frozenMemberInput(request.input, item.itemKey);
		try {
			const quote = (await caller("quoteGeneration", input, {
				idempotencyKey: `${item.idempotencyKey}:quote`,
			})) as CoreCanvasGenerationQuote;
			items.push({
				idempotencyKey: item.idempotencyKey,
				input,
				itemKey: item.itemKey,
				quote,
				state: "quoted",
			});
		} catch (error) {
			items.push({
				error: fanOutError(error),
				idempotencyKey: item.idempotencyKey,
				input,
				itemKey: item.itemKey,
				state: "quote_failed",
			});
		}
	}

	const totalEstimatedProviderCost = totalEstimatedProviderCostFor(items);
	return {
		batchKey: ledger.batchKey,
		canConfirm: totalEstimatedProviderCost !== null && everyItemIsQuoted(items),
		confirmation: ledger.confirmation,
		items,
		strategy: ledger.strategy,
		totalEstimatedProviderCost,
	};
}

/**
 * Runs only after the UI confirms a complete quote projection. Each submit is
 * still the existing single-item request and owns its own durable Core job.
 */
export async function submitQuotedFanOutGeneration(
	caller: CanvasGenerationFanOutCaller,
	quotes: CanvasGenerationFanOutQuoteProjection,
): Promise<CanvasGenerationFanOutSubmissionProjection> {
	if (!quotes.canConfirm || !quotes.totalEstimatedProviderCost) {
		throw new Error(
			"Fan-out submission requires a successful quote for every item and a total price.",
		);
	}
	const items: CanvasGenerationFanOutSubmissionMember[] = [];

	for (const item of quotes.items) {
		if (item.state !== "quoted" || !item.quote) {
			throw new Error(
				"Fan-out submission requires a successful quote for every item and a total price.",
			);
		}
		try {
			const job = (await caller(
				"submitGeneration",
				canvasGenerationSubmitPayload(item.input, item.quote),
				{ idempotencyKey: `${item.idempotencyKey}:submit` },
			)) as CoreCanvasGenerationJob;
			items.push({
				idempotencyKey: item.idempotencyKey,
				itemKey: item.itemKey,
				job,
				quote: item.quote,
				state: "submitted",
			});
		} catch (error) {
			items.push({
				error: fanOutError(error),
				idempotencyKey: item.idempotencyKey,
				itemKey: item.itemKey,
				quote: item.quote,
				state: "submit_failed",
			});
		}
	}

	return {
		batchKey: quotes.batchKey,
		confirmation: quotes.confirmation,
		items,
		strategy: quotes.strategy,
		totalEstimatedProviderCost: quotes.totalEstimatedProviderCost,
	};
}

function assertFanOutCount(count: number) {
	if (!Number.isSafeInteger(count) || count < 1 || count > 15) {
		throw new Error("A fan-out batch requires a count between 1 and 15.");
	}
}

function frozenMemberInput(
	input: CanvasGenerationRequest,
	itemId: string,
): CanvasGenerationFanOutMemberInput {
	return {
		...input,
		count: 1,
		inputAssets: input.inputAssets.map((asset) => ({ ...asset })),
		inputNodeBindings: input.inputNodeBindings.map((binding) => ({
			...binding,
		})),
		itemId,
		parameters: { ...input.parameters },
	};
}

function everyItemIsQuoted(items: CanvasGenerationFanOutQuoteMember[]) {
	return items.every((item) => item.state === "quoted" && item.quote);
}

function totalEstimatedProviderCostFor(
	items: CanvasGenerationFanOutQuoteMember[],
): CanvasGenerationEstimatedProviderCost | null {
	if (!everyItemIsQuoted(items)) return null;
	const costs = items.map((item) => item.quote?.estimatedProviderCost);
	if (
		costs.some(
			(cost) =>
				!cost ||
				!Number.isSafeInteger(cost.amountMicros) ||
				cost.amountMicros < 0 ||
				!cost.unit.trim(),
		)
	) {
		return null;
	}
	const first = costs[0] as CanvasGenerationEstimatedProviderCost;
	if (
		costs.some(
			(cost) => cost?.currency !== first.currency || cost.unit !== first.unit,
		)
	) {
		return null;
	}
	const amountMicros = costs.reduce(
		(total, cost) =>
			total + (cost as CanvasGenerationEstimatedProviderCost).amountMicros,
		0,
	);
	if (!Number.isSafeInteger(amountMicros)) return null;
	return { ...first, amountMicros };
}

function fanOutError(error: unknown) {
	const code =
		typeof error === "object" &&
		error !== null &&
		"code" in error &&
		typeof error.code === "string"
			? error.code
			: "REQUEST_FAILED";
	return {
		code,
		message:
			error instanceof Error
				? error.message
				: "Canvas generation request failed.",
	};
}
