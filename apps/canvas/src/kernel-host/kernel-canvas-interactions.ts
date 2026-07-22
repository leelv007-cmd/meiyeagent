import type { KernelNode, KernelSessionGraph } from "./graph-bridge";

export type CanvasPoint = { x: number; y: number };
export type CanvasResizeCorner =
	| "bottom-left"
	| "bottom-right"
	| "top-left"
	| "top-right";

export type CanvasSessionHistory<T> = {
	canRedo: boolean;
	canUndo: boolean;
	future: T[];
	past: T[];
	present: T;
};

function sessionHistory<T>(
	past: T[],
	present: T,
	future: T[],
): CanvasSessionHistory<T> {
	return {
		canRedo: future.length > 0,
		canUndo: past.length > 0,
		future,
		past,
		present,
	};
}

export function createSessionHistory<T>(present: T) {
	return sessionHistory<T>([], present, []);
}

export function commitSessionHistory<T>(
	history: CanvasSessionHistory<T>,
	next: T,
) {
	return sessionHistory([...history.past, history.present], next, []);
}

export function undoSessionHistory<T>(history: CanvasSessionHistory<T>) {
	const previous = history.past.at(-1);
	if (previous === undefined) return history;
	return sessionHistory(history.past.slice(0, -1), previous, [
		history.present,
		...history.future,
	]);
}

export function redoSessionHistory<T>(history: CanvasSessionHistory<T>) {
	const [next, ...future] = history.future;
	if (next === undefined) return history;
	return sessionHistory([...history.past, history.present], next, future);
}

export function sessionHistoryCommand(event: {
	ctrlKey: boolean;
	key: string;
	metaKey: boolean;
	shiftKey: boolean;
}) {
	const command = canvasKeyboardCommand(event);
	return command === "undo" || command === "redo" ? command : null;
}

export type CanvasKeyboardCommand =
	| "copy"
	| "delete"
	| "escape"
	| "paste"
	| "redo"
	| "select-all"
	| "undo";

export function canvasKeyboardCommand(event: {
	ctrlKey: boolean;
	key: string;
	metaKey: boolean;
	shiftKey: boolean;
}): CanvasKeyboardCommand | null {
	const key = event.key.toLowerCase();
	const hasCommandModifier = event.metaKey || event.ctrlKey;
	if (hasCommandModifier && key === "z") {
		return event.shiftKey ? "redo" : "undo";
	}
	if (hasCommandModifier && key === "a") return "select-all";
	if (hasCommandModifier && key === "c") return "copy";
	if (hasCommandModifier && key === "v") return "paste";
	if (!hasCommandModifier && (key === "delete" || key === "backspace")) {
		return "delete";
	}
	if (!hasCommandModifier && key === "escape") return "escape";
	return null;
}

export function hasSameCanvasContent(
	left: KernelSessionGraph,
	right: KernelSessionGraph,
) {
	return (
		JSON.stringify(left.nodes) === JSON.stringify(right.nodes) &&
		JSON.stringify(left.edges) === JSON.stringify(right.edges)
	);
}

export function clientPointToWorld(
	point: CanvasPoint,
	bounds: { left: number; top: number },
	viewport: KernelSessionGraph["viewport"],
): CanvasPoint {
	const scale = viewport.scale || 1;
	return {
		x: (point.x - bounds.left - viewport.x) / scale,
		y: (point.y - bounds.top - viewport.y) / scale,
	};
}

export function selectNodesInMarquee(
	nodes: KernelNode[],
	start: CanvasPoint,
	end: CanvasPoint,
	existingIds: string[] = [],
) {
	const left = Math.min(start.x, end.x);
	const right = Math.max(start.x, end.x);
	const top = Math.min(start.y, end.y);
	const bottom = Math.max(start.y, end.y);
	const selected = new Set(existingIds);
	for (const node of nodes) {
		const intersects =
			node.x <= right &&
			node.x + node.width >= left &&
			node.y <= bottom &&
			node.y + node.height >= top;
		if (intersects) selected.add(node.id);
	}
	return [...selected];
}

export function captureNodePositions(nodes: KernelNode[], ids: string[]) {
	const selected = new Set(ids);
	return Object.fromEntries(
		nodes
			.filter((node) => selected.has(node.id))
			.map((node) => [node.id, { x: node.x, y: node.y }]),
	) as Record<string, CanvasPoint>;
}

export function canStartNodeDrag(button: number) {
	return button === 0;
}

export function nodePointerSelection(
	selectedNodeIds: string[],
	nodeId: string,
	hasModifier: boolean,
) {
	const alreadySelected = selectedNodeIds.includes(nodeId);
	return {
		dragIds:
			hasModifier && !alreadySelected
				? [...selectedNodeIds, nodeId]
				: alreadySelected
					? selectedNodeIds
					: [nodeId],
		selectionOnPointerDown:
			hasModifier && !alreadySelected
				? [...selectedNodeIds, nodeId]
				: !hasModifier && !alreadySelected
					? [nodeId]
					: null,
	};
}

export function moveNodesFromOrigin(
	nodes: KernelNode[],
	origins: Record<string, CanvasPoint>,
	delta: CanvasPoint,
) {
	return nodes.map((node) => {
		const origin = origins[node.id];
		return origin
			? { ...node, x: origin.x + delta.x, y: origin.y + delta.y }
			: node;
	});
}

export function normalizeConnectionDirection(
	nodes: KernelNode[],
	firstId: string,
	secondId: string,
): { source: string; target: string } | null {
	if (firstId === secondId) return null;
	const first = nodes.find((node) => node.id === firstId);
	const second = nodes.find((node) => node.id === secondId);
	if (!first || !second) return null;
	const firstCenter = first.x + first.width / 2;
	const secondCenter = second.x + second.width / 2;
	return firstCenter <= secondCenter
		? { source: first.id, target: second.id }
		: { source: second.id, target: first.id };
}

export function connectCanvasNodes(
	graph: KernelSessionGraph,
	firstId: string,
	secondId: string,
	id: string,
): KernelSessionGraph {
	const direction = normalizeConnectionDirection(
		graph.nodes,
		firstId,
		secondId,
	);
	if (!direction) return graph;
	if (
		graph.edges.some(
			(edge) =>
				edge.source === direction.source && edge.target === direction.target,
		)
	) {
		return graph;
	}
	return {
		...graph,
		edges: [...graph.edges, { id, ...direction }],
	};
}

export function copySelectionAtPoint(
	graph: KernelSessionGraph,
	selectedNodeIds: string[],
	anchor: CanvasPoint,
	idSuffix: string,
): { graph: KernelSessionGraph; selectedNodeIds: string[] } {
	const selected = new Set(selectedNodeIds);
	const originals = graph.nodes.filter((node) => selected.has(node.id));
	if (originals.length === 0) return { graph, selectedNodeIds: [] };
	const left = Math.min(...originals.map((node) => node.x));
	const right = Math.max(...originals.map((node) => node.x + node.width));
	const top = Math.min(...originals.map((node) => node.y));
	const bottom = Math.max(...originals.map((node) => node.y + node.height));
	const offset = {
		x: anchor.x - (left + right) / 2,
		y: anchor.y - (top + bottom) / 2,
	};
	const idMap = new Map(
		originals.map((node) => [node.id, `${node.id}-${idSuffix}`]),
	);
	const copiedNodes = originals.map((node) => ({
		...node,
		data: { ...node.data },
		id: idMap.get(node.id) ?? node.id,
		x: node.x + offset.x,
		y: node.y + offset.y,
	}));
	const copiedEdges = graph.edges.flatMap((edge) => {
		const source = idMap.get(edge.source);
		const target = idMap.get(edge.target);
		return source && target
			? [{ ...edge, id: `${edge.id}-${idSuffix}`, source, target }]
			: [];
	});
	return {
		graph: {
			...graph,
			edges: [...graph.edges, ...copiedEdges],
			nodes: [...graph.nodes, ...copiedNodes],
		},
		selectedNodeIds: copiedNodes.map((node) => node.id),
	};
}

export function removeCanvasSelection(
	graph: KernelSessionGraph,
	selectedNodeIds: string[],
	selectedConnectionId: string | null,
): KernelSessionGraph {
	if (selectedNodeIds.length > 0) {
		const removed = new Set(selectedNodeIds);
		return {
			...graph,
			edges: graph.edges.filter(
				(edge) => !removed.has(edge.source) && !removed.has(edge.target),
			),
			nodes: graph.nodes.filter((node) => !removed.has(node.id)),
		};
	}
	if (!selectedConnectionId) return graph;
	return {
		...graph,
		edges: graph.edges.filter((edge) => edge.id !== selectedConnectionId),
	};
}

export function resizeNodeFromCorner(
	node: KernelNode,
	corner: CanvasResizeCorner,
	delta: CanvasPoint,
	keepRatio: boolean,
): KernelNode {
	const minWidth = 220;
	const minHeight = 160;
	const fromLeft = corner.includes("left");
	const fromTop = corner.includes("top");
	const right = node.x + node.width;
	const bottom = node.y + node.height;
	let width = Math.max(minWidth, node.width + (fromLeft ? -delta.x : delta.x));
	let height = Math.max(
		minHeight,
		node.height + (fromTop ? -delta.y : delta.y),
	);

	if (keepRatio) {
		const ratio = node.width / Math.max(1, node.height);
		if (Math.abs(delta.x) >= Math.abs(delta.y)) height = width / ratio;
		else width = height * ratio;
		if (height < minHeight) {
			height = minHeight;
			width = height * ratio;
		}
		if (width < minWidth) {
			width = minWidth;
			height = width / ratio;
		}
	}

	return {
		...node,
		height,
		width,
		x: fromLeft ? right - width : node.x,
		y: fromTop ? bottom - height : node.y,
	};
}

export function updateTextNode(
	nodes: KernelNode[],
	nodeId: string,
	text: string,
) {
	const current = nodes.find((node) => node.id === nodeId);
	if (!current || current.data.text === text) return nodes;
	return nodes.map((node) =>
		node.id === nodeId ? { ...node, data: { ...node.data, text } } : node,
	);
}
