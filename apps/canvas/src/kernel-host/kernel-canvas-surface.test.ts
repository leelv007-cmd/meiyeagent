import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	canStartNodeDrag,
	captureNodePositions,
	clientPointToWorld,
	commitSessionHistory,
	createSessionHistory,
	hasSameCanvasContent,
	moveNodesFromOrigin,
	nodePointerSelection,
	redoSessionHistory,
	selectNodesInMarquee,
	sessionHistoryCommand,
	undoSessionHistory,
	updateTextNode,
} from "./kernel-canvas-interactions.js";
import { KernelCanvasSurface } from "./kernel-canvas-surface.js";

test("media nodes use a focusable non-button container with isolated controls", () => {
	const markup = renderToStaticMarkup(
		createElement(KernelCanvasSurface, {
			graph: {
				edges: [],
				nodes: [
					{
						data: { assetId: "audio-asset-1" },
						height: 160,
						id: "audio-1",
						type: "audio",
						width: 200,
						x: 0,
						y: 0,
					},
				],
				viewport: { scale: 1, x: 0, y: 0 },
			},
			onChange: () => undefined,
		}),
	);

	assert.match(
		markup,
		/<fieldset[^>]*tabindex="0"[^>]*data-node-id="audio-1"/u,
	);
	assert.match(markup, /data-canvas-media-controls="true"/u);
	assert.doesNotMatch(markup, /<button[^>]*data-node-id="audio-1"/u);

	const imageMarkup = renderToStaticMarkup(
		createElement(KernelCanvasSurface, {
			graph: {
				edges: [],
				nodes: [
					{
						data: { assetId: "image-asset-1" },
						height: 160,
						id: "image-1",
						type: "image",
						width: 200,
						x: 0,
						y: 0,
					},
				],
				viewport: { scale: 1, x: 0, y: 0 },
			},
			onChange: () => undefined,
		}),
	);
	assert.doesNotMatch(imageMarkup, /data-canvas-media-controls/u);
});

test("dragging a selected node moves the whole selected group", () => {
	const nodes = [
		{ data: {}, height: 80, id: "a", type: "text", width: 80, x: 20, y: 30 },
		{ data: {}, height: 80, id: "b", type: "image", width: 80, x: 90, y: 120 },
		{ data: {}, height: 80, id: "c", type: "image", width: 80, x: 200, y: 220 },
	];
	const origins = captureNodePositions(nodes, ["a", "b"]);
	const moved = moveNodesFromOrigin(nodes, origins, { x: 25, y: -10 });

	assert.deepEqual(
		moved.map(({ id, x, y }) => ({ id, x, y })),
		[
			{ id: "a", x: 45, y: 20 },
			{ id: "b", x: 115, y: 110 },
			{ id: "c", x: 200, y: 220 },
		],
	);
});

test("modifier pointerdown preserves selection and prepares the expected drag group", () => {
	assert.equal(canStartNodeDrag(0), true);
	assert.equal(canStartNodeDrag(1), false);
	assert.equal(canStartNodeDrag(2), false);
	assert.deepEqual(nodePointerSelection(["a"], "b", true), {
		dragIds: ["a", "b"],
		selectionOnPointerDown: null,
	});
	assert.deepEqual(nodePointerSelection(["a"], "b", false), {
		dragIds: ["b"],
		selectionOnPointerDown: ["b"],
	});
	assert.deepEqual(nodePointerSelection(["a", "b"], "b", false), {
		dragIds: ["a", "b"],
		selectionOnPointerDown: null,
	});
});

test("session history supports undo, redo, and branch replacement", () => {
	let history = createSessionHistory("initial");
	history = commitSessionHistory(history, "edited");
	assert.equal(history.canUndo, true);

	history = undoSessionHistory(history);
	assert.equal(history.present, "initial");
	assert.equal(history.canRedo, true);

	history = redoSessionHistory(history);
	assert.equal(history.present, "edited");

	history = undoSessionHistory(history);
	history = commitSessionHistory(history, "replacement");
	assert.equal(history.present, "replacement");
	assert.equal(history.canRedo, false);
	assert.equal(
		sessionHistoryCommand({
			ctrlKey: true,
			key: "z",
			metaKey: false,
			shiftKey: false,
		}),
		"undo",
	);
	assert.equal(
		sessionHistoryCommand({
			ctrlKey: false,
			key: "Z",
			metaKey: true,
			shiftKey: true,
		}),
		"redo",
	);
	assert.equal(
		sessionHistoryCommand({
			ctrlKey: false,
			key: "z",
			metaKey: false,
			shiftKey: false,
		}),
		null,
	);
	assert.equal(
		hasSameCanvasContent(
			{ edges: [], nodes: [], viewport: { scale: 1, x: 0, y: 0 } },
			{ edges: [], nodes: [], viewport: { scale: 2, x: 200, y: 100 } },
		),
		true,
	);
});

test("canvas exposes undo and redo controls", () => {
	const markup = renderToStaticMarkup(
		createElement(KernelCanvasSurface, {
			graph: { edges: [], nodes: [], viewport: { scale: 1, x: 0, y: 0 } },
			onChange: () => undefined,
		}),
	);
	assert.match(markup, /data-canvas-undo="true"[^>]*>撤销</u);
	assert.match(markup, /data-canvas-redo="true"[^>]*>重做</u);
});

test("text node editing writes the new value back without changing other nodes", () => {
	const nodes = [
		{
			data: { text: "before" },
			height: 80,
			id: "text-1",
			type: "text",
			width: 80,
			x: 20,
			y: 30,
		},
		{
			data: { assetId: "asset-1" },
			height: 80,
			id: "image-1",
			type: "image",
			width: 80,
			x: 90,
			y: 120,
		},
	];
	const updated = updateTextNode(nodes, "text-1", "after");

	assert.equal(updated[0]?.data.text, "after");
	assert.equal(updated[1], nodes[1]);
	assert.equal(updateTextNode(updated, "text-1", "after"), updated);

	const markup = renderToStaticMarkup(
		createElement(KernelCanvasSurface, {
			graph: { edges: [], nodes, viewport: { scale: 1, x: 0, y: 0 } },
			onChange: () => undefined,
		}),
	);
	assert.match(
		markup,
		/data-node-text-editable="true"[^>]*data-node-id="text-1"/u,
	);
});

test("rendered edges expose stable source and target projections", () => {
	const markup = renderToStaticMarkup(
		createElement(KernelCanvasSurface, {
			graph: {
				edges: [{ id: "edge-1", source: "source-1", target: "target-1" }],
				nodes: [
					{
						data: {},
						height: 80,
						id: "source-1",
						type: "text",
						width: 80,
						x: 20,
						y: 30,
					},
					{
						data: {},
						height: 80,
						id: "target-1",
						type: "image",
						width: 80,
						x: 180,
						y: 30,
					},
				],
				viewport: { scale: 1, x: 0, y: 0 },
			},
			onChange: () => undefined,
		}),
	);

	assert.match(
		markup,
		/<path[^>]*data-edge-source="source-1"[^>]*data-edge-target="target-1"/u,
	);
});

test("Shift marquee selects intersecting nodes in world coordinates", () => {
	assert.deepEqual(
		clientPointToWorld(
			{ x: 250, y: 180 },
			{ left: 10, top: 20 },
			{ scale: 2, x: 40, y: 20 },
		),
		{ x: 100, y: 70 },
	);

	const selected = selectNodesInMarquee(
		[
			{
				data: {},
				height: 80,
				id: "inside",
				type: "text",
				width: 80,
				x: 20,
				y: 20,
			},
			{
				data: {},
				height: 80,
				id: "edge",
				type: "image",
				width: 80,
				x: 90,
				y: 90,
			},
			{
				data: {},
				height: 40,
				id: "outside",
				type: "image",
				width: 40,
				x: 180,
				y: 180,
			},
		],
		{ x: 0, y: 0 },
		{ x: 100, y: 100 },
		["already-selected"],
	);

	assert.deepEqual(selected, ["already-selected", "inside", "edge"]);
});
