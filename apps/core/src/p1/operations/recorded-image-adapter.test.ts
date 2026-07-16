import assert from "node:assert/strict";
import test from "node:test";

import { RecordedImageGenerationAdapter } from "./adapters.js";

test("fixture image preview does not render internal model or recorded identifiers", async () => {
	const result = await new RecordedImageGenerationAdapter({
		autoComplete: true,
	}).submit({
		actorId: "owner-a",
		dataClass: [],
		operation: "generate",
		origin: { kind: "layout_work", id: "work-a", revisionId: "work-a-r1" },
		prompt: "Generate a neutral fixture preview.",
		requestedModelId: "gpt-image-2",
		workspaceId: "workspace-a",
	});

	assert.equal(result.status, "completed");
	const encodedSvg = result.outputAssetUrl?.replace("data:image/svg+xml,", "");
	assert.ok(encodedSvg);
	const svg = decodeURIComponent(encodedSvg);
	assert.doesNotMatch(svg, /gpt-image-2|recorded/iu);
	assert.doesNotMatch(svg, /<text\b/iu);
});
