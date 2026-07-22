import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
	canStartNodeDrag,
	canvasKeyboardCommand,
	captureNodePositions,
	clientPointToWorld,
	commitSessionHistory,
	connectCanvasNodes,
	copySelectionAtPoint,
	createSessionHistory,
	hasSameCanvasContent,
	moveNodesFromOrigin,
	nodePointerSelection,
	normalizeConnectionDirection,
	redoSessionHistory,
	removeCanvasSelection,
	resizeNodeFromCorner,
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
	assert.match(markup, /data-canvas-no-zoom="true"/u);
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
	assert.doesNotMatch(imageMarkup, /data-canvas-no-zoom/u);
});

test("K2 production surface mounts the approved rich node for all five node types", () => {
	const markup = renderToStaticMarkup(
		createElement(KernelCanvasSurface, {
			graph: {
				edges: [],
				nodes: ["image", "text", "config", "video", "audio"].map(
					(type, index) => ({
						data: type === "text" ? { text: "会员日焕新文案" } : {},
						height: 160,
						id: `${type}-1`,
						type,
						width: 240,
						x: index * 260,
						y: 0,
					}),
				),
				viewport: { scale: 1, x: 0, y: 0 },
			},
			onChange: () => undefined,
		}),
	);

	assert.equal(markup.match(/node-element/g)?.length, 5);
	assert.doesNotMatch(
		markup,
		/<fieldset[^>]*data-node-id="[^"]+"[^>]*pointer-events:none/u,
	);
	assert.match(markup, /用文本生图/u);
	assert.match(markup, /空图片节点/u);
	assert.match(markup, /生成配置/u);
	assert.match(markup, /空视频节点/u);
	assert.match(markup, /空音频节点/u);
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

test("K2 routes the complete canvas shortcut set without hijacking plain keys", () => {
	const keyboard = (
		key: string,
		options: Partial<{
			ctrlKey: boolean;
			metaKey: boolean;
			shiftKey: boolean;
		}> = {},
	) =>
		canvasKeyboardCommand({
			ctrlKey: false,
			key,
			metaKey: false,
			shiftKey: false,
			...options,
		});

	assert.equal(keyboard("z", { metaKey: true }), "undo");
	assert.equal(keyboard("Z", { ctrlKey: true, shiftKey: true }), "redo");
	assert.equal(keyboard("a", { metaKey: true }), "select-all");
	assert.equal(keyboard("c", { ctrlKey: true }), "copy");
	assert.equal(keyboard("v", { metaKey: true }), "paste");
	assert.equal(keyboard("Delete"), "delete");
	assert.equal(keyboard("Backspace"), "delete");
	assert.equal(keyboard("Escape"), "escape");
	assert.equal(keyboard("a"), null);
	assert.equal(keyboard("Enter", { metaKey: true }), null);
});

test("K2 resize clamps four-corner geometry and preserves media aspect ratio", () => {
	const node = {
		data: {},
		height: 200,
		id: "image-1",
		type: "image",
		width: 400,
		x: 100,
		y: 80,
	};

	assert.deepEqual(
		resizeNodeFromCorner(node, "top-left", { x: 500, y: 500 }, false),
		{ ...node, height: 160, width: 220, x: 280, y: 120 },
	);
	assert.deepEqual(
		resizeNodeFromCorner(node, "bottom-right", { x: -100, y: 40 }, true),
		{ ...node, height: 160, width: 320 },
	);
});

test("K2 normalizes connections from the visually left node to the right node", () => {
	const nodes = [
		{
			data: {},
			height: 100,
			id: "right",
			type: "image",
			width: 200,
			x: 500,
			y: 0,
		},
		{
			data: {},
			height: 100,
			id: "left",
			type: "text",
			width: 200,
			x: 40,
			y: 0,
		},
	];

	assert.deepEqual(normalizeConnectionDirection(nodes, "right", "left"), {
		source: "left",
		target: "right",
	});
	assert.deepEqual(normalizeConnectionDirection(nodes, "left", "right"), {
		source: "left",
		target: "right",
	});
	assert.equal(normalizeConnectionDirection(nodes, "left", "left"), null);
});

test("K2 appends one normalized connection and rejects duplicates", () => {
	const graph = {
		edges: [],
		nodes: [
			{
				data: {},
				height: 80,
				id: "right",
				type: "image",
				width: 80,
				x: 200,
				y: 0,
			},
			{ data: {}, height: 80, id: "left", type: "text", width: 80, x: 0, y: 0 },
		],
		viewport: { scale: 1, x: 0, y: 0 },
	};
	const connected = connectCanvasNodes(graph, "right", "left", "edge-new");
	assert.deepEqual(connected.edges, [
		{ id: "edge-new", source: "left", target: "right" },
	]);
	assert.equal(
		connectCanvasNodes(connected, "left", "right", "edge-duplicate"),
		connected,
	);
});

test("K2 copy keeps internal edges and relocates the group around the canvas anchor", () => {
	const graph = {
		edges: [
			{ id: "inside", source: "a", target: "b" },
			{ id: "outside", source: "b", target: "c" },
		],
		nodes: [
			{
				data: { text: "A" },
				height: 100,
				id: "a",
				type: "text",
				width: 100,
				x: 0,
				y: 0,
			},
			{
				data: { assetId: "asset-1" },
				height: 100,
				id: "b",
				type: "image",
				width: 100,
				x: 200,
				y: 0,
			},
			{
				data: {},
				height: 100,
				id: "c",
				type: "config",
				width: 100,
				x: 400,
				y: 0,
			},
		],
		viewport: { scale: 1, x: 0, y: 0 },
	};

	const copied = copySelectionAtPoint(
		graph,
		["a", "b"],
		{ x: 500, y: 400 },
		"copy-1",
	);
	assert.deepEqual(copied.selectedNodeIds, ["a-copy-1", "b-copy-1"]);
	assert.deepEqual(
		copied.graph.nodes.slice(-2).map(({ id, x, y }) => ({ id, x, y })),
		[
			{ id: "a-copy-1", x: 350, y: 350 },
			{ id: "b-copy-1", x: 550, y: 350 },
		],
	);
	assert.deepEqual(copied.graph.edges.at(-1), {
		id: "inside-copy-1",
		source: "a-copy-1",
		target: "b-copy-1",
	});
	assert.equal(copied.graph.edges.length, 3);
});

test("K2 deletion removes selected nodes, incident edges, or one connection", () => {
	const graph = {
		edges: [
			{ id: "a-b", source: "a", target: "b" },
			{ id: "b-c", source: "b", target: "c" },
		],
		nodes: [
			{ data: {}, height: 80, id: "a", type: "text", width: 80, x: 0, y: 0 },
			{ data: {}, height: 80, id: "b", type: "image", width: 80, x: 100, y: 0 },
			{ data: {}, height: 80, id: "c", type: "video", width: 80, x: 200, y: 0 },
		],
		viewport: { scale: 1, x: 0, y: 0 },
	};

	assert.deepEqual(removeCanvasSelection(graph, ["b"], null), {
		...graph,
		edges: [],
		nodes: [graph.nodes[0], graph.nodes[2]],
	});
	assert.deepEqual(removeCanvasSelection(graph, [], "a-b"), {
		...graph,
		edges: [graph.edges[1]],
	});
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
	assert.doesNotMatch(markup, /canvas-zoom-controls/u);
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
		/<[^>]+data-edge-source="source-1"[^>]*data-edge-target="target-1"/u,
	);
	assert.match(markup, /data-connection-id="edge-1"/u);
});

test("Command marquee selects intersecting nodes in world coordinates", () => {
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
