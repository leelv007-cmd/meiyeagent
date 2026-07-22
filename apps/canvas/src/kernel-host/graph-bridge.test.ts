import assert from "node:assert/strict";
import test from "node:test";
import {
	emptyKernelGraph,
	fromKernelGraph,
	type KernelSessionGraph,
	normalizeEdge,
	toKernelGraph,
} from "./graph-bridge.js";

type CanvasGraphFixture = {
	edges: Array<{ id?: string; source: string; target: string; type?: string }>;
	nodes: Array<{
		data: Record<string, number | string>;
		id: string;
		type: string;
	}>;
	schemaVersion: 1;
};

test("toKernelGraph lifts layout from data and preserves asset/job/text/prompt", () => {
	const graph: CanvasGraphFixture = {
		edges: [{ source: "a", target: "b", type: "derive" }],
		nodes: [
			{
				data: {
					assetId: "asset-1",
					height: 180,
					jobId: "job-1",
					prompt: "neon salon",
					text: "caption",
					width: 240,
					x: 12,
					y: 34,
				},
				id: "a",
				type: "image",
			},
			{
				data: { text: "hello" },
				id: "b",
				type: "text",
			},
		],
		schemaVersion: 1,
	};

	const kernel = toKernelGraph(graph, { scale: 1.5, x: 10, y: 20 });
	assert.equal(kernel.viewport.scale, 1.5);
	assert.equal(kernel.nodes[0]?.x, 12);
	assert.equal(kernel.nodes[0]?.y, 34);
	assert.equal(kernel.nodes[0]?.width, 240);
	assert.equal(kernel.nodes[0]?.height, 180);
	assert.equal(kernel.nodes[0]?.data.assetId, "asset-1");
	assert.equal(kernel.nodes[0]?.data.jobId, "job-1");
	assert.equal(kernel.nodes[0]?.data.prompt, "neon salon");
	assert.equal(kernel.nodes[0]?.data.text, "caption");
	assert.equal(kernel.edges[0]?.id, "edge-a-b-0");
	assert.equal(kernel.edges[0]?.source, "a");
	assert.equal(kernel.edges[0]?.target, "b");
	assert.equal(kernel.edges[0]?.type, "derive");
});

test("fromKernelGraph strips viewport and writes x/y/width/height into data", () => {
	const kernel: KernelSessionGraph = {
		edges: [{ id: "e1", source: "n1", target: "n2" }],
		nodes: [
			{
				data: {
					assetId: "asset-9",
					jobId: "job-9",
					prompt: "keep-me",
					text: "body",
				},
				height: 100,
				id: "n1",
				type: "image",
				width: 120,
				x: 5,
				y: 6,
			},
			{
				data: { text: "note" },
				height: 80,
				id: "n2",
				type: "text",
				width: 160,
				x: 200,
				y: 40,
			},
		],
		viewport: { scale: 2, x: 99, y: 88 },
	};

	const graph = fromKernelGraph(kernel);
	assert.equal(graph.schemaVersion, 1);
	assert.deepEqual(Object.keys(graph).sort(), [
		"edges",
		"nodes",
		"schemaVersion",
	]);
	assert.equal(graph.nodes[0]?.data.x, 5);
	assert.equal(graph.nodes[0]?.data.y, 6);
	assert.equal(graph.nodes[0]?.data.width, 120);
	assert.equal(graph.nodes[0]?.data.height, 100);
	assert.equal(graph.nodes[0]?.data.assetId, "asset-9");
	assert.equal(graph.nodes[0]?.data.jobId, "job-9");
	assert.equal(graph.nodes[0]?.data.prompt, "keep-me");
	assert.equal(graph.nodes[0]?.data.text, "body");
	assert.equal(graph.edges[0]?.source, "n1");
	assert.equal(graph.edges[0]?.target, "n2");
});

test("round-trip preserves domain fields and edge endpoints", () => {
	const original: CanvasGraphFixture = {
		edges: [{ id: "edge-1", source: "img", target: "txt" }],
		nodes: [
			{
				data: { assetId: "a1", jobId: "j1", prompt: "p", x: 1, y: 2 },
				id: "img",
				type: "image",
			},
			{
				data: { text: "t", x: 3, y: 4 },
				id: "txt",
				type: "text",
			},
		],
		schemaVersion: 1,
	};
	const back = fromKernelGraph(toKernelGraph(original));
	assert.equal(back.nodes[0]?.data.assetId, "a1");
	assert.equal(back.nodes[0]?.data.jobId, "j1");
	assert.equal(back.nodes[0]?.data.prompt, "p");
	assert.equal(back.nodes[1]?.data.text, "t");
	assert.equal(back.edges[0]?.source, "img");
	assert.equal(back.edges[0]?.target, "txt");
});

test("normalizeEdge accepts fromNodeId/toNodeId and from/to aliases", () => {
	assert.deepEqual(
		normalizeEdge({ fromNodeId: "a", id: "c1", toNodeId: "b" }, 0),
		{ id: "c1", source: "a", target: "b" },
	);
	assert.deepEqual(normalizeEdge({ from: "x", to: "y" }, 2), {
		id: "edge-x-y-2",
		source: "x",
		target: "y",
	});
	assert.equal(normalizeEdge({ source: "only" }, 0), null);
});

test("emptyKernelGraph is empty with identity viewport", () => {
	assert.deepEqual(emptyKernelGraph(), {
		edges: [],
		nodes: [],
		viewport: { scale: 1, x: 0, y: 0 },
	});
});
