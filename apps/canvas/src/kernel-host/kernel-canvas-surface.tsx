// biome-ignore-all lint/a11y/noNoninteractiveTabindex: canvas node groups must be keyboard-focusable while containing nested media controls.
"use client";

import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { VozebCanvas } from "@/src/vendor/vozeb/app/(user)/canvas/components/vozeb-canvas";
import type {
	KernelEdge,
	KernelNode,
	KernelSessionGraph,
} from "./graph-bridge";
import {
	type CanvasPoint,
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
} from "./kernel-canvas-interactions";
import { KernelNodeMedia } from "./kernel-node-media";

export type KernelCanvasSurfaceProps = {
	adoptedNodeIds?: string[];
	graph: KernelSessionGraph;
	onChange: (next: KernelSessionGraph) => void;
	onCropSelected?: (nodeId: string) => void;
	onSelectNodes?: (ids: string[]) => void;
	onViewportChange?: (viewport: KernelSessionGraph["viewport"]) => void;
	selectedNodeIds?: string[];
};

/**
 * Infinite pan/zoom canvas host surface.
 * Exact-copied Vozeb render/retouch modules live under vendor/; this host is the
 * SaaS-safe mount that keeps BackendPort as the only domain seam.
 */
export function KernelCanvasSurface({
	adoptedNodeIds = [],
	graph,
	onChange,
	onCropSelected,
	onSelectNodes,
	onViewportChange,
	selectedNodeIds = [],
}: KernelCanvasSurfaceProps) {
	const surfaceRef = useRef<HTMLDivElement>(null);
	const textEditorRef = useRef<HTMLTextAreaElement>(null);
	const historyRef = useRef(createSessionHistory(graph));
	const lastEmittedGraphRef = useRef<KernelSessionGraph | null>(null);
	const dragHistoryRecordedRef = useRef(false);
	const [historyAvailability, setHistoryAvailability] = useState({
		canRedo: false,
		canUndo: false,
	});
	const [dragging, setDragging] = useState<{
		origins: Record<string, CanvasPoint>;
		startClient: CanvasPoint;
	} | null>(null);
	const [marquee, setMarquee] = useState<{
		current: CanvasPoint;
		existingIds: string[];
		start: CanvasPoint;
	} | null>(null);
	const [textEditor, setTextEditor] = useState<{
		id: string;
		value: string;
	} | null>(null);
	const adopted = useMemo(() => new Set(adoptedNodeIds), [adoptedNodeIds]);
	const selected = useMemo(() => new Set(selectedNodeIds), [selectedNodeIds]);

	const publishHistoryAvailability = useCallback(() => {
		setHistoryAvailability({
			canRedo: historyRef.current.canRedo,
			canUndo: historyRef.current.canUndo,
		});
	}, []);

	const emitGraph = useCallback(
		(next: KernelSessionGraph, recordHistory = true) => {
			historyRef.current = recordHistory
				? commitSessionHistory(historyRef.current, next)
				: { ...historyRef.current, present: next };
			lastEmittedGraphRef.current = next;
			publishHistoryAvailability();
			onChange(next);
		},
		[onChange, publishHistoryAvailability],
	);

	const undo = useCallback(() => {
		const viewport = historyRef.current.present.viewport;
		const next = undoSessionHistory(historyRef.current);
		if (next === historyRef.current) return;
		const present = { ...next.present, viewport };
		historyRef.current = { ...next, present };
		lastEmittedGraphRef.current = present;
		publishHistoryAvailability();
		onChange(present);
	}, [onChange, publishHistoryAvailability]);

	const redo = useCallback(() => {
		const viewport = historyRef.current.present.viewport;
		const next = redoSessionHistory(historyRef.current);
		if (next === historyRef.current) return;
		const present = { ...next.present, viewport };
		historyRef.current = { ...next, present };
		lastEmittedGraphRef.current = present;
		publishHistoryAvailability();
		onChange(present);
	}, [onChange, publishHistoryAvailability]);

	useEffect(() => {
		if (historyRef.current.present === graph) return;
		if (
			lastEmittedGraphRef.current === graph ||
			hasSameCanvasContent(historyRef.current.present, graph)
		) {
			historyRef.current = { ...historyRef.current, present: graph };
		} else {
			historyRef.current = createSessionHistory(graph);
		}
		lastEmittedGraphRef.current = null;
		publishHistoryAvailability();
	}, [graph, publishHistoryAvailability]);

	useEffect(() => {
		const handleHistoryKey = (event: KeyboardEvent) => {
			const command = sessionHistoryCommand(event);
			if (!command) return;
			const target = event.target;
			if (
				target instanceof HTMLElement &&
				(target.isContentEditable ||
					target instanceof HTMLInputElement ||
					target instanceof HTMLTextAreaElement ||
					target instanceof HTMLSelectElement)
			) {
				return;
			}
			event.preventDefault();
			if (command === "redo") redo();
			else undo();
		};
		window.addEventListener("keydown", handleHistoryKey);
		return () => window.removeEventListener("keydown", handleHistoryKey);
	}, [redo, undo]);

	useEffect(() => {
		if (!textEditor) return;
		textEditorRef.current?.focus();
		textEditorRef.current?.select();
	}, [textEditor]);

	const updateViewport = useCallback(
		(viewport: KernelSessionGraph["viewport"]) => {
			if (onViewportChange) onViewportChange(viewport);
			else onChange({ ...graph, viewport });
		},
		[graph, onChange, onViewportChange],
	);

	const onPointerMove = (event: ReactPointerEvent) => {
		if (marquee) {
			const bounds = surfaceRef.current?.getBoundingClientRect();
			if (!bounds) return;
			setMarquee({
				...marquee,
				current: clientPointToWorld(
					{ x: event.clientX, y: event.clientY },
					bounds,
					graph.viewport,
				),
			});
			return;
		}
		if (!dragging) return;
		const scale = graph.viewport.scale || 1;
		emitGraph(
			{
				...graph,
				nodes: moveNodesFromOrigin(graph.nodes, dragging.origins, {
					x: (event.clientX - dragging.startClient.x) / scale,
					y: (event.clientY - dragging.startClient.y) / scale,
				}),
			},
			!dragHistoryRecordedRef.current,
		);
		dragHistoryRecordedRef.current = true;
	};

	const endPointer = () => {
		if (marquee) {
			onSelectNodes?.(
				selectNodesInMarquee(
					graph.nodes,
					marquee.start,
					marquee.current,
					marquee.existingIds,
				),
			);
			setMarquee(null);
		}
		setDragging(null);
		dragHistoryRecordedRef.current = false;
	};

	const connectSelected = () => {
		if (selectedNodeIds.length !== 2) return;
		const [source, target] = selectedNodeIds;
		if (!source || !target) return;
		const id = `edge-${source}-${target}`;
		if (graph.edges.some((edge) => edge.id === id)) return;
		const edge: KernelEdge = { id, source, target };
		emitGraph({ ...graph, edges: [...graph.edges, edge] });
	};
	const commitTextEdit = (nodeId: string, text: string) => {
		const nodes = updateTextNode(graph.nodes, nodeId, text);
		if (nodes !== graph.nodes) emitGraph({ ...graph, nodes });
		setTextEditor(null);
	};
	const selectedImageId =
		selectedNodeIds.length === 1 &&
		graph.nodes.some(
			(node) =>
				node.id === selectedNodeIds[0] &&
				node.type === "image" &&
				typeof node.data.assetId === "string",
		)
			? selectedNodeIds[0]
			: undefined;

	return (
		<div className="kernel-surface-root">
			<div className="kernel-surface-tools">
				<button
					data-canvas-undo="true"
					disabled={!historyAvailability.canUndo}
					type="button"
					onClick={undo}
				>
					撤销
				</button>
				<button
					data-canvas-redo="true"
					disabled={!historyAvailability.canRedo}
					type="button"
					onClick={redo}
				>
					重做
				</button>
				<button type="button" onClick={connectSelected}>
					连接选中
				</button>
				<button
					disabled={!selectedImageId}
					type="button"
					onClick={() => {
						if (selectedImageId) onCropSelected?.(selectedImageId);
					}}
				>
					方形裁切
				</button>
				<span>
					缩放 {(graph.viewport.scale * 100).toFixed(0)}% · 节点{" "}
					{graph.nodes.length}
				</span>
			</div>
			<div
				className="kernel-surface"
				data-canvas-marquee-surface="true"
				onPointerDownCapture={(event) => {
					if (event.button !== 0 || !event.shiftKey) return;
					const target = event.target instanceof Element ? event.target : null;
					if (target?.closest("[data-node-id]")) return;
					const bounds = surfaceRef.current?.getBoundingClientRect();
					if (!bounds) return;
					event.preventDefault();
					event.stopPropagation();
					event.currentTarget.setPointerCapture(event.pointerId);
					const start = clientPointToWorld(
						{ x: event.clientX, y: event.clientY },
						bounds,
						graph.viewport,
					);
					setMarquee({
						current: start,
						existingIds: selectedNodeIds,
						start,
					});
				}}
				onPointerLeave={endPointer}
				onPointerMove={onPointerMove}
				onPointerUp={endPointer}
			>
				<VozebCanvas
					backgroundMode="lines"
					containerRef={surfaceRef}
					onCanvasDeselect={() => onSelectNodes?.([])}
					onViewportChange={(viewport) =>
						updateViewport({
							scale: viewport.k,
							x: viewport.x,
							y: viewport.y,
						})
					}
					viewport={{
						k: graph.viewport.scale,
						x: graph.viewport.x,
						y: graph.viewport.y,
					}}
				>
					<svg className="kernel-edges" aria-hidden>
						<title>节点连线</title>
						{graph.edges.map((edge) => {
							const from = graph.nodes.find((n) => n.id === edge.source);
							const to = graph.nodes.find((n) => n.id === edge.target);
							if (!from || !to) return null;
							const x1 = from.x + from.width;
							const y1 = from.y + from.height / 2;
							const x2 = to.x;
							const y2 = to.y + to.height / 2;
							return (
								<path
									key={edge.id}
									data-edge-source={edge.source}
									data-edge-target={edge.target}
									d={`M ${x1} ${y1} C ${x1 + 40} ${y1}, ${x2 - 40} ${y2}, ${x2} ${y2}`}
									fill="none"
									stroke="rgba(244,114,182,.7)"
									strokeWidth={2}
								/>
							);
						})}
					</svg>
					<div className="kernel-world">
						{marquee ? (
							<div
								className="kernel-selection-marquee"
								data-selection-marquee="true"
								style={{
									height: Math.abs(marquee.current.y - marquee.start.y),
									left: Math.min(marquee.start.x, marquee.current.x),
									top: Math.min(marquee.start.y, marquee.current.y),
									width: Math.abs(marquee.current.x - marquee.start.x),
								}}
							/>
						) : null}
						{graph.nodes.map((node) => (
							<fieldset
								key={node.id}
								aria-label={`${node.type} 节点`}
								tabIndex={0}
								className={[
									"kernel-node",
									selected.has(node.id) ? "is-selected" : "",
									adopted.has(node.id) ? "is-adopted" : "",
								]
									.filter(Boolean)
									.join(" ")}
								data-node-text-editable={
									typeof node.data.text === "string" ? "true" : undefined
								}
								data-node-id={node.id}
								style={{
									height: node.height,
									left: node.x,
									top: node.y,
									width: node.width,
								}}
								onClick={(event) => {
									event.stopPropagation();
									const target =
										event.target instanceof Element ? event.target : null;
									if (target?.closest("[data-canvas-media-controls]")) return;
									const multi =
										event.metaKey || event.ctrlKey || event.shiftKey;
									if (multi) {
										const next = selected.has(node.id)
											? selectedNodeIds.filter((id) => id !== node.id)
											: [...selectedNodeIds, node.id];
										onSelectNodes?.(next);
									} else {
										onSelectNodes?.([node.id]);
									}
								}}
								onKeyDown={(event) => {
									if (event.target !== event.currentTarget) return;
									if (event.key !== "Enter" && event.key !== " ") return;
									event.preventDefault();
									onSelectNodes?.([node.id]);
								}}
								onDoubleClick={(event) => {
									if (typeof node.data.text !== "string") return;
									event.stopPropagation();
									setTextEditor({ id: node.id, value: node.data.text });
								}}
								onPointerDown={(event) => {
									if (!canStartNodeDrag(event.button)) return;
									event.stopPropagation();
									const target =
										event.target instanceof Element ? event.target : null;
									if (target?.closest("[data-canvas-media-controls]")) return;
									const pointerSelection = nodePointerSelection(
										selectedNodeIds,
										node.id,
										event.metaKey || event.ctrlKey || event.shiftKey,
									);
									if (pointerSelection.selectionOnPointerDown) {
										onSelectNodes?.(pointerSelection.selectionOnPointerDown);
									}
									dragHistoryRecordedRef.current = false;
									setDragging({
										origins: captureNodePositions(
											graph.nodes,
											pointerSelection.dragIds,
										),
										startClient: { x: event.clientX, y: event.clientY },
									});
								}}
							>
								<header>
									<strong>{node.type}</strong>
									{adopted.has(node.id) ? <em>已采用</em> : null}
								</header>
								{textEditor?.id === node.id ? (
									<textarea
										aria-label="编辑文本节点"
										data-node-text-editor={node.id}
										ref={textEditorRef}
										value={textEditor.value}
										onBlur={() => commitTextEdit(node.id, textEditor.value)}
										onChange={(event) =>
											setTextEditor({ id: node.id, value: event.target.value })
										}
										onClick={(event) => event.stopPropagation()}
										onDoubleClick={(event) => event.stopPropagation()}
										onKeyDown={(event) => {
											event.stopPropagation();
											if (event.key === "Escape") {
												setTextEditor(null);
											} else if (event.key === "Enter" && !event.shiftKey) {
												event.preventDefault();
												event.currentTarget.blur();
											}
										}}
										onPointerDown={(event) => event.stopPropagation()}
									/>
								) : (
									<NodeBody node={node} />
								)}
							</fieldset>
						))}
					</div>
				</VozebCanvas>
				{graph.nodes.length === 0 ? (
					<div className="kernel-empty-hint">
						<strong>开始你的 Pro Studio 创作</strong>
						<span>添加素材或文字节点，自由编排创作过程</span>
					</div>
				) : null}
			</div>
		</div>
	);
}

function NodeBody({ node }: { node: KernelNode }) {
	if (
		(node.type === "image" || node.type === "video" || node.type === "audio") &&
		typeof node.data.assetId === "string"
	) {
		if (node.type === "image") {
			return <KernelNodeMedia assetId={node.data.assetId} type="image" />;
		}
		return (
			<div data-canvas-media-controls="true">
				<KernelNodeMedia assetId={node.data.assetId} type={node.type} />
			</div>
		);
	}
	if (typeof node.data.text === "string") {
		return <p>{node.data.text}</p>;
	}
	if (typeof node.data.prompt === "string") {
		return <p className="muted">{node.data.prompt}</p>;
	}
	if (typeof node.data.jobId === "string") {
		return (
			<p className="muted">
				job {String(node.data.jobId).slice(0, 8)} ·{" "}
				{String(node.data.status ?? "")}
			</p>
		);
	}
	return <p className="muted">{node.id.slice(0, 8)}</p>;
}
