import type { KernelNode, KernelSessionGraph } from "./graph-bridge";

export type CanvasPoint = { x: number; y: number };

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
	if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "z") {
		return null;
	}
	return event.shiftKey ? "redo" : "undo";
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
		selectionOnPointerDown: !hasModifier && !alreadySelected ? [nodeId] : null,
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
