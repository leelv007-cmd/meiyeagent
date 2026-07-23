import assert from "node:assert/strict";
import test from "node:test";
import { CANVAS_PROMPT_SEEDS } from "../shared/prompt-seeds.js";
import { listCanvasPromptSeeds } from "./prompt-catalog.js";

test("maps every product-owned seed into a governed catalog item", () => {
	const items = listCanvasPromptSeeds();
	assert.equal(items.length, CANVAS_PROMPT_SEEDS.length);
	assert.deepEqual(
		items.map((item) => item.id),
		CANVAS_PROMPT_SEEDS.map((seed) => seed.id),
	);
	assert.deepEqual(
		Object.fromEntries(items.map((item) => [item.id, item.prompt])),
		Object.fromEntries(
			CANVAS_PROMPT_SEEDS.map((seed) => [seed.id, seed.prompt]),
		),
	);
});

test("assigns image seeds the visual capability category so they stay insertable", () => {
	// Every documented seed is image.generate, which the resource workflow maps
	// to image.generate via the "视觉" marker (see resource-workflow.promptCapabilities).
	for (const item of listCanvasPromptSeeds()) {
		assert.equal(item.category, "视觉");
	}
});

test("derives a human title from the prompt and never leaks the internal file name", () => {
	const byId = new Map(CANVAS_PROMPT_SEEDS.map((seed) => [seed.id, seed]));
	for (const item of listCanvasPromptSeeds()) {
		const seed = byId.get(item.id);
		assert.ok(seed);
		assert.ok(item.title.length > 0);
		assert.notEqual(item.title, seed.fileName);
		// The title is the prompt's leading clause: it is real merchant-facing copy.
		assert.ok(seed.prompt.startsWith(item.title));
		assert.doesNotMatch(item.title, /[a-z]{2,}-[a-z]/u);
	}
});
