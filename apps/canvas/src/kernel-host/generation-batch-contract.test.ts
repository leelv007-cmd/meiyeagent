import assert from "node:assert/strict";
import test from "node:test";
import {
	CANVAS_BATCH_STRATEGY,
	createFanOutGenerationLedger,
} from "./generation-batch-contract.js";

test("K1 fan-out ledger uses one aggregate confirmation and deterministic item keys", () => {
	const first = createFanOutGenerationLedger("batch-42", [
		{ nodeId: "node-image", operation: "image.generate" },
		{ nodeId: "node-text", operation: "text.respond" },
	]);
	const second = createFanOutGenerationLedger("batch-42", [
		{ nodeId: "node-image", operation: "image.generate" },
		{ nodeId: "node-text", operation: "text.respond" },
	]);

	assert.equal(CANVAS_BATCH_STRATEGY, "fan-out");
	assert.equal(first.confirmation, "aggregate-N-quotes-once");
	assert.deepEqual(first, second);
	assert.deepEqual(
		first.items.map((item) => [item.itemKey, item.idempotencyKey]),
		[
			["batch-42:item:1", "canvas-generation:batch-42:item:1"],
			["batch-42:item:2", "canvas-generation:batch-42:item:2"],
		],
	);
});

test("K1 fan-out ledger permits multiple outputs for one source item and caps the batch at 15", () => {
	assert.throws(() => createFanOutGenerationLedger("batch-1", []));
	const repeatedSource = createFanOutGenerationLedger("batch-1", [
		{ nodeId: "node-1", operation: "image.generate" },
		{ nodeId: "node-1", operation: "image.generate" },
	]);
	assert.deepEqual(
		repeatedSource.items.map((item) => item.itemKey),
		["batch-1:item:1", "batch-1:item:2"],
	);
	assert.throws(
		() =>
			createFanOutGenerationLedger(
				"batch-16",
				Array.from({ length: 16 }, () => ({
					operation: "image.generate",
				})),
			),
		/count between 1 and 15/u,
	);
});
