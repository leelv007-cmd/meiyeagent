import type {
	CanvasEdge,
	CanvasGraph,
	CanvasNode,
} from "@meiye/core/pro-studio";

/** Vozeb-like session graph used by the kernel host surface (not domain fact). */
export type KernelNode = {
	data: Record<string, unknown>;
	height: number;
	id: string;
	type: string;
	width: number;
	x: number;
	y: number;
};

export type KernelEdge = {
	id: string;
	source: string;
	target: string;
	type?: string;
};

export type KernelSessionGraph = {
	edges: KernelEdge[];
	nodes: KernelNode[];
	/** UI-session only — never persisted as domain authority. */
	viewport: { scale: number; x: number; y: number };
};

const DEFAULT_W = 220;
const DEFAULT_H = 140;

/** Fields that must survive round-trips between Core and kernel graphs. */
const PRESERVED_DATA_KEYS = ["assetId", "jobId", "text", "prompt"] as const;

function asRecord(value: unknown): Record<string, unknown> {
	if (value && typeof value === "object" && !Array.isArray(value)) {
		return value as Record<string, unknown>;
	}
	return {};
}

function num(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

type LooseEdge = {
	from?: unknown;
	fromNodeId?: unknown;
	id?: unknown;
	source?: unknown;
	target?: unknown;
	to?: unknown;
	toNodeId?: unknown;
	type?: unknown;
};

/** Normalize edge endpoints from source/target, from/to, or fromNodeId/toNodeId. */
export function normalizeEdge(
	edge: LooseEdge,
	index: number,
): KernelEdge | null {
	const source = edge.source ?? edge.from ?? edge.fromNodeId;
	const target = edge.target ?? edge.to ?? edge.toNodeId;
	if (typeof source !== "string" || source.length === 0) return null;
	if (typeof target !== "string" || target.length === 0) return null;
	const id =
		typeof edge.id === "string" && edge.id.length > 0
			? edge.id
			: `edge-${source}-${target}-${index}`;
	return {
		id,
		source,
		target,
		...(typeof edge.type === "string" && edge.type.length > 0
			? { type: edge.type }
			: {}),
	};
}

/** Core CanvasGraph → kernel session graph (layout from data or grid). */
export function toKernelGraph(
	graph: CanvasGraph,
	viewport: KernelSessionGraph["viewport"] = { scale: 1, x: 0, y: 0 },
): KernelSessionGraph {
	const nodes: KernelNode[] = graph.nodes.map((node, index) => {
		const data = asRecord(node.data);
		const col = index % 4;
		const row = Math.floor(index / 4);
		return {
			data: { ...data },
			height: num(data.height, DEFAULT_H),
			id: node.id,
			type: node.type,
			width: num(data.width, DEFAULT_W),
			x: num(data.x, 48 + col * (DEFAULT_W + 48)),
			y: num(data.y, 48 + row * (DEFAULT_H + 48)),
		};
	});
	const edges: KernelEdge[] = graph.edges
		.map((edge, index) => normalizeEdge(edge, index))
		.filter((edge): edge is KernelEdge => edge !== null);
	return { edges, nodes, viewport };
}

/** Kernel session graph → Core CanvasGraph (viewport/chat dropped; layout into data). */
export function fromKernelGraph(kernel: KernelSessionGraph): CanvasGraph {
	const nodes: CanvasNode[] = kernel.nodes.map((node) => {
		const prior = asRecord(node.data);
		const data: Record<string, unknown> = {
			...prior,
			height: node.height,
			width: node.width,
			x: node.x,
			y: node.y,
		};
		for (const key of PRESERVED_DATA_KEYS) {
			if (key in prior) data[key] = prior[key];
		}
		return {
			data: data as CanvasNode["data"],
			id: node.id,
			type: node.type,
		};
	});
	const edges: CanvasEdge[] = kernel.edges
		.map((edge, index) => normalizeEdge(edge, index))
		.filter((edge): edge is KernelEdge => edge !== null)
		.map((edge) => ({
			id: edge.id,
			source: edge.source,
			target: edge.target,
			...(edge.type ? { type: edge.type } : {}),
		}));
	return { edges, nodes, schemaVersion: 1 };
}

export function emptyKernelGraph(): KernelSessionGraph {
	return {
		edges: [],
		nodes: [],
		viewport: { scale: 1, x: 0, y: 0 },
	};
}
