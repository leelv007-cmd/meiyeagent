export const CANVAS_BATCH_STRATEGY = "fan-out" as const;

export type FanOutGenerationItem = {
	nodeId?: string;
	operation: string;
};

export type FanOutGenerationLedger = {
	batchKey: string;
	confirmation: "aggregate-N-quotes-once";
	items: Array<
		FanOutGenerationItem & {
			idempotencyKey: string;
			itemKey: string;
		}
	>;
	strategy: typeof CANVAS_BATCH_STRATEGY;
};

/**
 * K1 chooses independent Core quote/submit calls. This helper freezes only the
 * UI-facing ledger identity; it does not add a batch endpoint or durable store.
 */
export function createFanOutGenerationLedger(
	batchKey: string,
	items: FanOutGenerationItem[],
): FanOutGenerationLedger {
	if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$/u.test(batchKey)) {
		throw new Error("batchKey must be a stable identifier.");
	}
	if (items.length === 0) {
		throw new Error("A fan-out batch requires a count between 1 and 15.");
	}
	if (items.length > 15) {
		throw new Error("A fan-out batch requires a count between 1 and 15.");
	}
	return {
		batchKey,
		confirmation: "aggregate-N-quotes-once",
		items: items.map((item, index) => {
			if (!item.operation) {
				throw new Error("Every fan-out item requires an operation.");
			}
			const itemKey = `${batchKey}:item:${index + 1}`;
			return {
				...item,
				idempotencyKey: `canvas-generation:${itemKey}`,
				itemKey,
			};
		}),
		strategy: CANVAS_BATCH_STRATEGY,
	};
}
