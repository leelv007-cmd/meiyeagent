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
import { CanvasNodeContextMenu } from "@/src/vendor/vozeb/app/(user)/canvas/components/canvas-context-menu";
import { Minimap } from "@/src/vendor/vozeb/app/(user)/canvas/components/canvas-mini-map";
import { CanvasNode } from "@/src/vendor/vozeb/app/(user)/canvas/components/canvas-node";
import { CanvasZoomControls } from "@/src/vendor/vozeb/app/(user)/canvas/components/canvas-zoom-controls";
import { VozebCanvas } from "@/src/vendor/vozeb/app/(user)/canvas/components/vozeb-canvas";
import type { ContextMenuState } from "@/src/vendor/vozeb/app/(user)/canvas/types";
import type { KernelEdge, KernelSessionGraph } from "./graph-bridge";
import {
	type CanvasPoint,
	canStartNodeDrag,
	canvasKeyboardCommand,
	captureNodePositions,
	clientPointToWorld,
	commitSessionHistory,
	copySelectionAtPoint,
	createSessionHistory,
	hasSameCanvasContent,
	moveNodesFromOrigin,
	nodePointerSelection,
	normalizeConnectionDirection,
	redoSessionHistory,
	removeCanvasSelection,
	selectNodesInMarquee,
	undoSessionHistory,
	updateTextNode,
} from "./kernel-canvas-interactions";
import { toVozebNode } from "./kernel-node-adapter";
import { deliveryUrl } from "./media-adapter";
import { PortedConnectionPath } from "./ported/canvas-connections";

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
	const historyRef = useRef(createSessionHistory(graph));
	const lastEmittedGraphRef = useRef<KernelSessionGraph | null>(null);
	const dragHistoryRecordedRef = useRef(false);
	const clipboardNodeIdsRef = useRef<string[]>([]);
	const pasteIndexRef = useRef(0);
	const [historyAvailability, setHistoryAvailability] = useState({
		canRedo: false,
		canUndo: false,
	});
	const [selectedConnectionId, setSelectedConnectionId] = useState<
		string | null
	>(null);
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
	const [clientChromeReady, setClientChromeReady] = useState(false);
	const [isMiniMapOpen, setIsMiniMapOpen] = useState(true);
	const [viewportSize, setViewportSize] = useState({ height: 1, width: 1 });
	const [dragging, setDragging] = useState<{
		origins: Record<string, CanvasPoint>;
		startClient: CanvasPoint;
	} | null>(null);
	const [marquee, setMarquee] = useState<{
		current: CanvasPoint;
		existingIds: string[];
		start: CanvasPoint;
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
		setClientChromeReady(true);
	}, []);

	useEffect(() => {
		const surface = surfaceRef.current;
		if (!surface) return;
		const publishSize = () => {
			const bounds = surface.getBoundingClientRect();
			setViewportSize({
				height: Math.max(1, bounds.height),
				width: Math.max(1, bounds.width),
			});
		};
		publishSize();
		if (typeof ResizeObserver === "undefined") return;
		const observer = new ResizeObserver(publishSize);
		observer.observe(surface);
		return () => observer.disconnect();
	}, []);

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
		const [first, second] = selectedNodeIds;
		if (!first || !second) return;
		const direction = normalizeConnectionDirection(graph.nodes, first, second);
		if (!direction) return;
		const { source, target } = direction;
		const id = `edge-${source}-${target}`;
		if (
			graph.edges.some(
				(edge) => edge.source === source && edge.target === target,
			)
		) {
			return;
		}
		const edge: KernelEdge = { id, source, target };
		emitGraph({ ...graph, edges: [...graph.edges, edge] });
	};
	const duplicateAt = useCallback(
		(ids: string[], anchor: CanvasPoint) => {
			pasteIndexRef.current += 1;
			const copied = copySelectionAtPoint(
				graph,
				ids,
				anchor,
				`copy-${pasteIndexRef.current}`,
			);
			if (copied.graph === graph) return;
			emitGraph(copied.graph);
			onSelectNodes?.(copied.selectedNodeIds);
			setSelectedConnectionId(null);
		},
		[emitGraph, graph, onSelectNodes],
	);
	const visibleCenter = useCallback(() => {
		const bounds = surfaceRef.current?.getBoundingClientRect();
		if (!bounds) return { x: 0, y: 0 };
		return clientPointToWorld(
			{ x: bounds.left + bounds.width / 2, y: bounds.top + bounds.height / 2 },
			bounds,
			graph.viewport,
		);
	}, [graph.viewport]);
	const deleteSelection = useCallback(
		(nodeIds = selectedNodeIds, connectionId = selectedConnectionId) => {
			const next = removeCanvasSelection(graph, nodeIds, connectionId);
			if (next !== graph) emitGraph(next);
			onSelectNodes?.([]);
			setSelectedConnectionId(null);
			setContextMenu(null);
		},
		[emitGraph, graph, onSelectNodes, selectedConnectionId, selectedNodeIds],
	);

	useEffect(() => {
		const handleCanvasKey = (event: KeyboardEvent) => {
			const command = canvasKeyboardCommand(event);
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
			if (command === "undo") undo();
			else if (command === "redo") redo();
			else if (command === "select-all") {
				onSelectNodes?.(graph.nodes.map((node) => node.id));
				setSelectedConnectionId(null);
			} else if (command === "copy") {
				clipboardNodeIdsRef.current = [...selectedNodeIds];
			} else if (command === "paste") {
				const center = visibleCenter();
				duplicateAt(clipboardNodeIdsRef.current, {
					x: center.x + pasteIndexRef.current * 24,
					y: center.y + pasteIndexRef.current * 24,
				});
			} else if (command === "delete") deleteSelection();
			else {
				onSelectNodes?.([]);
				setSelectedConnectionId(null);
				setContextMenu(null);
			}
		};
		window.addEventListener("keydown", handleCanvasKey);
		return () => window.removeEventListener("keydown", handleCanvasKey);
	}, [
		deleteSelection,
		duplicateAt,
		graph.nodes,
		onSelectNodes,
		redo,
		selectedNodeIds,
		undo,
		visibleCenter,
	]);
	const commitTextEdit = (nodeId: string, text: string) => {
		const nodes = updateTextNode(graph.nodes, nodeId, text);
		if (nodes !== graph.nodes) emitGraph({ ...graph, nodes });
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
	const beginMarquee = (event: ReactPointerEvent<HTMLDivElement>) => {
		if (event.button !== 0 || (!event.ctrlKey && !event.metaKey)) return;
		const bounds = surfaceRef.current?.getBoundingClientRect();
		if (!bounds) return;
		const start = clientPointToWorld(
			{ x: event.clientX, y: event.clientY },
			bounds,
			graph.viewport,
		);
		setMarquee({ current: start, existingIds: selectedNodeIds, start });
	};
	const changeScale = (scale: number) => {
		const currentScale = graph.viewport.scale || 1;
		const worldCenter = {
			x: (viewportSize.width / 2 - graph.viewport.x) / currentScale,
			y: (viewportSize.height / 2 - graph.viewport.y) / currentScale,
		};
		updateViewport({
			scale,
			x: viewportSize.width / 2 - worldCenter.x * scale,
			y: viewportSize.height / 2 - worldCenter.y * scale,
		});
	};

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
				onPointerLeave={endPointer}
				onPointerMove={onPointerMove}
				onPointerUp={endPointer}
			>
				<VozebCanvas
					backgroundMode="lines"
					containerRef={surfaceRef}
					onCanvasDeselect={() => {
						onSelectNodes?.([]);
						setSelectedConnectionId(null);
						setContextMenu(null);
					}}
					onCanvasMouseDown={beginMarquee}
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
							const from = graph.nodes.find((node) => node.id === edge.source);
							const to = graph.nodes.find((node) => node.id === edge.target);
							if (!from || !to) return null;
							return (
								<g
									key={edge.id}
									data-edge-source={edge.source}
									data-edge-target={edge.target}
								>
									<PortedConnectionPath
										active={selectedConnectionId === edge.id}
										connection={{
											fromNodeId: edge.source,
											id: edge.id,
											toNodeId: edge.target,
										}}
										from={toVozebNode(from, deliveryUrl)}
										onSelect={() => {
											setSelectedConnectionId(edge.id);
											onSelectNodes?.([]);
										}}
										onContextMenu={(event) =>
											setContextMenu({
												connectionId: edge.id,
												type: "connection",
												x: event.clientX,
												y: event.clientY,
											})
										}
										to={toVozebNode(to, deliveryUrl)}
									/>
								</g>
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
						{graph.nodes.map((node) => {
							const richNode = toVozebNode(node, deliveryUrl);
							const related = graph.edges.some(
								(edge) =>
									(selected.has(edge.source) && edge.target === node.id) ||
									(selected.has(edge.target) && edge.source === node.id),
							);
							return (
								<fieldset
									key={node.id}
									aria-label={`${richNode.title}节点`}
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
								>
									<CanvasNode
										data={{ ...richNode, position: { x: 0, y: 0 } }}
										isConnecting={false}
										isConnectionTarget={false}
										isFocusRelated={related}
										isRelated={related}
										isSelected={selected.has(node.id)}
										mentionReferences={[]}
										onConnectStart={() => undefined}
										onContentChange={(nodeId, content) =>
											commitTextEdit(nodeId, content)
										}
										onContextMenu={(event, nodeId) => {
											event.preventDefault();
											event.stopPropagation();
											onSelectNodes?.([nodeId]);
											setSelectedConnectionId(null);
											setContextMenu({
												nodeId,
												type: "node",
												x: event.clientX,
												y: event.clientY,
											});
										}}
										onGenerateImage={() => onSelectNodes?.([node.id])}
										onHoverEnd={() => undefined}
										onHoverStart={() => undefined}
										onMouseDown={(event) => {
											if (!canStartNodeDrag(event.button)) return;
											event.stopPropagation();
											const pointerSelection = nodePointerSelection(
												selectedNodeIds,
												node.id,
												event.metaKey || event.ctrlKey || event.shiftKey,
											);
											if (pointerSelection.selectionOnPointerDown) {
												onSelectNodes?.(
													pointerSelection.selectionOnPointerDown,
												);
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
										onResize={(_nodeId, width, height, position) => {
											emitGraph({
												...graph,
												nodes: graph.nodes.map((candidate) =>
													candidate.id === node.id
														? {
																...candidate,
																height,
																width,
																x: node.x + (position?.x ?? 0),
																y: node.y + (position?.y ?? 0),
															}
														: candidate,
												),
											});
										}}
										onRetry={() =>
											emitGraph({
												...graph,
												nodes: graph.nodes.map((candidate) =>
													candidate.id === node.id
														? {
																...candidate,
																data: { ...candidate.data, status: "idle" },
															}
														: candidate,
												),
											})
										}
										onViewImage={() => onSelectNodes?.([node.id])}
										renderNodeContent={(candidate) => (
											<div className="kernel-config-node">
												<strong>生成配置</strong>
												<span>
													{candidate.metadata?.prompt || "选择节点后配置生成"}
												</span>
											</div>
										)}
										scale={graph.viewport.scale}
										showImageInfo={true}
										showPanel={false}
									/>
									{adopted.has(node.id) ? (
										<em className="kernel-adopted-badge">已采用</em>
									) : null}
								</fieldset>
							);
						})}
					</div>
				</VozebCanvas>
				{clientChromeReady && isMiniMapOpen ? (
					<Minimap
						nodes={graph.nodes.map((node) => toVozebNode(node, deliveryUrl))}
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
						viewportSize={viewportSize}
					/>
				) : null}
				{clientChromeReady ? (
					<CanvasZoomControls
						isMiniMapOpen={isMiniMapOpen}
						onReset={() => updateViewport({ scale: 1, x: 0, y: 0 })}
						onScaleChange={changeScale}
						onToggleMiniMap={() => setIsMiniMapOpen((open) => !open)}
						scale={graph.viewport.scale}
					/>
				) : null}
				{contextMenu ? (
					<CanvasNodeContextMenu
						menu={contextMenu}
						onClose={() => setContextMenu(null)}
						onDelete={() => {
							if (contextMenu.type === "node") {
								deleteSelection([contextMenu.nodeId], null);
							} else {
								deleteSelection([], contextMenu.connectionId);
							}
						}}
						onDuplicate={() => {
							if (contextMenu.type !== "node") return;
							const bounds = surfaceRef.current?.getBoundingClientRect();
							if (!bounds) return;
							duplicateAt(
								[contextMenu.nodeId],
								clientPointToWorld(
									{ x: contextMenu.x, y: contextMenu.y },
									bounds,
									graph.viewport,
								),
							);
							setContextMenu(null);
						}}
					/>
				) : null}
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
