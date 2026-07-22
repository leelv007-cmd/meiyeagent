import assert from "node:assert/strict";
import test from "node:test";
import {
	createCanvasSessionState,
	withCanvasViewport,
	withSelectedCanvasNodes,
} from "./ported/canvas-session-store.js";

test("ported Canvas session state stays local and immutable by caller input", () => {
	const selected = ["node-1"];
	const session = createCanvasSessionState({
		selectedNodeIds: selected,
		viewport: { scale: 1.5, x: 12, y: 24 },
	});
	selected.push("mutated-after-create");

	assert.deepEqual(session, {
		activePanel: "runtime",
		selectedNodeIds: ["node-1"],
		toolbar: { backgroundMode: "lines" },
		viewport: { scale: 1.5, x: 12, y: 24 },
	});
	assert.deepEqual(withSelectedCanvasNodes(session, ["node-2"]), {
		...session,
		selectedNodeIds: ["node-2"],
	});
	assert.deepEqual(
		withCanvasViewport(session, { scale: 2, x: 0, y: -18 }).viewport,
		{ scale: 2, x: 0, y: -18 },
	);
});
