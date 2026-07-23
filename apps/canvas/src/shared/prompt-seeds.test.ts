import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import test from "node:test";
import {
	CANVAS_PROMPT_SEED_MANIFEST,
	CANVAS_PROMPT_SEEDS,
} from "./prompt-seeds.js";

test("ships exactly the 40 product-provided image.generate prompts", async () => {
	const markdown = await readFile(
		resolve(
			process.cwd(),
			"../../docs/design/seed-visual-pack-prompts-2026-07-14.md",
		),
		"utf8",
	);
	const documented = new Map<string, string>();
	for (const line of markdown.split("\n")) {
		const cells = line
			.split("|")
			.slice(1, -1)
			.map((cell) => cell.trim());
		if (/^[A-I]\d+$/u.test(cells[0] ?? "")) {
			documented.set(cells[0], cells.at(-1) ?? "");
		}
	}

	assert.equal(CANVAS_PROMPT_SEEDS.length, 40);
	assert.equal(documented.size, 40);
	assert.equal(new Set(CANVAS_PROMPT_SEEDS.map((seed) => seed.id)).size, 40);
	assert.ok(
		CANVAS_PROMPT_SEEDS.every((seed) => seed.operation === "image.generate"),
	);
	assert.ok(
		CANVAS_PROMPT_SEEDS.every(
			(seed) =>
				seed.catalogVersion === CANVAS_PROMPT_SEED_MANIFEST.catalogVersion &&
				seed.owner === CANVAS_PROMPT_SEED_MANIFEST.owner &&
				seed.source === CANVAS_PROMPT_SEED_MANIFEST.source &&
				seed.a3EvidenceStatus === CANVAS_PROMPT_SEED_MANIFEST.a3EvidenceStatus,
		),
	);
	assert.deepEqual(
		Object.fromEntries(
			CANVAS_PROMPT_SEEDS.map((seed) => [seed.id, seed.prompt]),
		),
		Object.fromEntries(documented),
	);
});

test("resolves the A3 gate to a product-owned disposition with evidence", () => {
	assert.equal(CANVAS_PROMPT_SEED_MANIFEST.a3EvidenceStatus, "product-owned");
	assert.notEqual(CANVAS_PROMPT_SEED_MANIFEST.a3EvidenceStatus, "pending");
	assert.match(CANVAS_PROMPT_SEED_MANIFEST.a3Evidence, /a3-authorization/u);
	assert.ok(
		CANVAS_PROMPT_SEEDS.every(
			(seed) =>
				seed.a3EvidenceStatus === "product-owned" &&
				seed.a3Evidence === CANVAS_PROMPT_SEED_MANIFEST.a3Evidence,
		),
	);
});
