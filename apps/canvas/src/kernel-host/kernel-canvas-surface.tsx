// biome-ignore-all lint/a11y/noNoninteractiveTabindex: canvas node groups must be keyboard-focusable while containing nested media controls.
"use client";

import Image from "next/image";
import {
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { CanvasNodeContextMenu } from "@/src/vendor/vozeb/app/(user)/canvas/components/canvas-context-menu";
import { Minimap } from "@/src/vendor/vozeb/app/(user)/canvas/components/canvas-mini-map";
import { CanvasNode } from "@/src/vendor/vozeb/app/(user)/canvas/components/canvas-node";
import { CanvasZoomControls } from "@/src/vendor/vozeb/app/(user)/canvas/components/canvas-zoom-controls";
import { VozebCanvas } from "@/src/vendor/vozeb/app/(user)/canvas/components/vozeb-canvas";
import type { ContextMenuState } from "@/src/vendor/vozeb/app/(user)/canvas/types";
import type { KernelNode, KernelSessionGraph } from "./graph-bridge";
import {
	adjustTextFontSize,
	type CanvasPoint,
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
	redoSessionHistory,
	removeCanvasSelection,
	selectNodesInMarquee,
	toggleNodeFreeResize,
	undoSessionHistory,
	updateTextNode,
} from "./kernel-canvas-interactions";
import { createKernelNode, toVozebNode } from "./kernel-node-adapter";
import { deliveryUrl } from "./media-adapter";
import { PortedConnectionPath } from "./ported/canvas-connections";
import { K2CanvasToolbar } from "./ported/k2-canvas-toolbar";
import { KernelNodeHoverToolbar } from "./ported/kernel-node-hover-toolbar";

export type KernelCanvasSurfaceProps = {
	adoptedNodeIds?: string[];
	graph: KernelSessionGraph;
	onChange: (next: KernelSessionGraph) => void;
	onAngleSelected?: (nodeId: string) => void;
	onCropSelected?: (nodeId: string) => void;
	onImportFiles?: (
		files: File[],
		position: CanvasPoint,
	) => Promise<void> | void;
	onOpenAssets?: () => void;
	onMaskEditSelected?: (nodeId: string) => void;
	onReversePromptSelected?: (nodeId: string) => void;
	onRetryFrozenJob?: (input: {
		jobId: string;
		nodeId: string;
	}) => Promise<void> | void;
	onSelectNodes?: (ids: string[]) => void;
	onSplitSelected?: (nodeId: string) => void;
	onUpload?: () => void;
	onUpscaleSelected?: (nodeId: string) => void;
	onViewportChange?: (viewport: KernelSessionGraph["viewport"]) => void;
	selectedNodeIds?: string[];
};

const CANVAS_NODE_CLIPBOARD_MIME = "application/x-meiye-canvas-node-ids";
const MAX_EXTERNAL_TEXT_LENGTH = 20_000;

type ClipboardDataLike = {
	files: ArrayLike<File>;
	getData: (type: string) => string;
};

export type CanvasClipboardPayload =
	| { kind: "files"; files: File[] }
	| { kind: "internal"; nodeIds: string[] }
	| { kind: "text"; text: string };

export function canvasClipboardPayload(
	clipboard: ClipboardDataLike | null | undefined,
	knownNodeIds: readonly string[],
): CanvasClipboardPayload | null {
	if (!clipboard) return null;
	const internalNodeIds = readInternalClipboardNodeIds(
		clipboard.getData(CANVAS_NODE_CLIPBOARD_MIME),
		knownNodeIds,
	);
	if (internalNodeIds.length > 0) {
		return { kind: "internal", nodeIds: internalNodeIds };
	}
	const files = Array.from(clipboard.files);
	if (files.length > 0) return { files, kind: "files" };
	const text = clipboard.getData("text/plain").replaceAll("\u0000", "").trim();
	if (!text) return null;
	return { kind: "text", text: text.slice(0, MAX_EXTERNAL_TEXT_LENGTH) };
}

export function imagePreviewAssetId(
	node: Pick<KernelNode, "data" | "type">,
): string | undefined {
	const assetId = node.data.assetId;
	return node.type === "image" && typeof assetId === "string" && assetId.trim()
		? assetId
		: undefined;
}

function readInternalClipboardNodeIds(
	value: string,
	knownNodeIds: readonly string[],
): string[] {
	try {
		const parsed = JSON.parse(value) as unknown;
		if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
			return [];
		const payload = parsed as { kind?: unknown; nodeIds?: unknown };
		if (
			payload.kind !== "meiye.canvas.nodes.v1" ||
			!Array.isArray(payload.nodeIds)
		) {
			return [];
		}
		const known = new Set(knownNodeIds);
		const selected = new Set<string>();
		return payload.nodeIds.filter((nodeId): nodeId is string => {
			if (
				typeof nodeId !== "string" ||
				!known.has(nodeId) ||
				selected.has(nodeId)
			) {
				return false;
			}

			selected.add(nodeId);
			return true;
		});
	} catch {
		return [];
	}
}

function isTextEditingTarget(target: EventTarget | null) {
	return (
		target instanceof HTMLElement &&
		(target.isContentEditable ||
			target instanceof HTMLInputElement ||
			target instanceof HTMLTextAreaElement ||
			target instanceof HTMLSelectElement)
	);
}

function serialiseCanvasNodeClipboard(nodeIds: readonly string[]) {
	return JSON.stringify({ kind: "meiye.canvas.nodes.v1", nodeIds });
}

/**
 * Infinite pan/zoom canvas host surface.
 * Exact-copied Vozeb render/retouch modules live under vendor/; this host is the
 * SaaS-safe mount that keeps BackendPort as the only domain seam.
 */
export function KernelCanvasSurface({
	adoptedNodeIds = [],
	graph,
	onChange,
	onAngleSelected,
	onCropSelected,
	onImportFiles,
	onOpenAssets,
	onMaskEditSelected,
	onReversePromptSelected,
	onRetryFrozenJob,
	onSelectNodes,
	onSplitSelected,
	onUpload,
	onUpscaleSelected,
	onViewportChange,
	selectedNodeIds = [],
}: KernelCanvasSurfaceProps) {
	const surfaceRef = useRef<HTMLDivElement>(null);
	const historyRef = useRef(createSessionHistory(graph));
	const lastEmittedGraphRef = useRef<KernelSessionGraph | null>(null);
	const dragHistoryRecordedRef = useRef(false);
	const clipboardNodeIdsRef = useRef<string[]>([]);
	const pasteIndexRef = useRef(0);
	const hoverLeaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
	const [historyAvailability, setHistoryAvailability] = useState({
		canRedo: false,
		canUndo: false,
	});
	const [selectedConnectionId, setSelectedConnectionId] = useState<
		string | null
	>(null);
	const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
	const [clearConfirmationOpen, setClearConfirmationOpen] = useState(false);
	const [clientChromeReady, setClientChromeReady] = useState(false);
	const [interactionMessage, setInteractionMessage] = useState<string | null>(
		null,
	);
	const [isMiniMapOpen, setIsMiniMapOpen] = useState(true);
	const [previewAssetId, setPreviewAssetId] = useState<string | null>(null);
	const [backgroundMode, setBackgroundMode] =
		useState<CanvasBackgroundMode>("lines");
	const [showImageInfo, setShowImageInfo] = useState(true);
	const [viewportSize, setViewportSize] = useState({ height: 1, width: 1 });
	const [connectionDrag, setConnectionDrag] = useState<{
		current: CanvasPoint;
		sourceNodeId: string;
		start: CanvasPoint;
	} | null>(null);
	const [connectionCreate, setConnectionCreate] = useState<{
		clientX: number;
		clientY: number;
		position: CanvasPoint;
		sourceNodeId: string;
	} | null>(null);
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
		const next = connectCanvasNodes(
			graph,
			first,
			second,
			`edge-${crypto.randomUUID()}`,
		);
		if (next !== graph) emitGraph(next);
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
	const pasteTextAt = useCallback(
		(text: string, position: CanvasPoint) => {
			const node = createKernelNode(
				"text",
				position,
				`text-${crypto.randomUUID()}`,
			);
			node.data = { text };
			emitGraph({ ...graph, nodes: [...graph.nodes, node] });
			onSelectNodes?.([node.id]);
			setSelectedConnectionId(null);
			setContextMenu(null);
		},
		[emitGraph, graph, onSelectNodes],
	);
	const openImagePreview = useCallback(
		(node: KernelNode) => {
			const assetId = imagePreviewAssetId(node);
			if (!assetId) return;
			onSelectNodes?.([node.id]);
			setSelectedConnectionId(null);
			setPreviewAssetId(assetId);
		},
		[onSelectNodes],
	);
	const retryFrozenJob = useCallback(
		(node: KernelNode) => {
			const jobId =
				typeof node.data.jobId === "string" && node.data.jobId.trim()
					? node.data.jobId
					: null;
			if (!jobId) {
				setInteractionMessage("该失败节点没有可恢复的固定任务。");
				return;
			}
			if (!onRetryFrozenJob) {
				setInteractionMessage("当前画布暂不支持恢复该固定任务。");
				return;
			}
			setInteractionMessage(null);
			void Promise.resolve()
				.then(() => onRetryFrozenJob({ jobId, nodeId: node.id }))
				.catch(() =>
					setInteractionMessage("固定任务状态刷新失败，请稍后重试。"),
				);
		},
		[onRetryFrozenJob],
	);
	const clearCanvas = useCallback(() => {
		if (graph.nodes.length === 0) {
			setClearConfirmationOpen(false);
			return;
		}
		emitGraph({ ...graph, edges: [], nodes: [] });
		onSelectNodes?.([]);
		setSelectedConnectionId(null);
		setContextMenu(null);
		setPreviewAssetId(null);
		setClearConfirmationOpen(false);
	}, [emitGraph, graph, onSelectNodes]);
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
			if (isTextEditingTarget(event.target)) return;
			if (command === "copy") {
				clipboardNodeIdsRef.current = [...selectedNodeIds];
				return;
			}
			if (command === "paste") return;
			event.preventDefault();
			if (command === "undo") undo();
			else if (command === "redo") redo();
			else if (command === "select-all") {
				onSelectNodes?.(graph.nodes.map((node) => node.id));
				setSelectedConnectionId(null);
			} else if (command === "delete") deleteSelection();
			else {
				onSelectNodes?.([]);
				setSelectedConnectionId(null);
				setContextMenu(null);
				setClearConfirmationOpen(false);
				setInteractionMessage(null);
				setPreviewAssetId(null);
			}
		};
		window.addEventListener("keydown", handleCanvasKey);
		return () => window.removeEventListener("keydown", handleCanvasKey);
	}, [
		deleteSelection,
		graph.nodes,
		onSelectNodes,
		redo,
		selectedNodeIds,
		undo,
	]);

	useEffect(() => {
		const handleCopy = (event: ClipboardEvent) => {
			if (isTextEditingTarget(event.target)) return;
			const nodeIds = selectedNodeIds.filter((nodeId) =>
				graph.nodes.some((node) => node.id === nodeId),
			);
			if (nodeIds.length === 0) return;
			clipboardNodeIdsRef.current = nodeIds;
			event.preventDefault();
			event.clipboardData?.setData(
				CANVAS_NODE_CLIPBOARD_MIME,
				serialiseCanvasNodeClipboard(nodeIds),
			);
		};
		window.addEventListener("copy", handleCopy);
		return () => window.removeEventListener("copy", handleCopy);
	}, [graph.nodes, selectedNodeIds]);

	useEffect(() => {
		const handlePaste = (event: ClipboardEvent) => {
			if (isTextEditingTarget(event.target)) return;
			const payload = canvasClipboardPayload(
				event.clipboardData,
				graph.nodes.map((node) => node.id),
			);
			const center = visibleCenter();
			if (payload?.kind === "internal") {
				event.preventDefault();
				duplicateAt(payload.nodeIds, {
					x: center.x + pasteIndexRef.current * 24,
					y: center.y + pasteIndexRef.current * 24,
				});
				return;
			}
			if (payload?.kind === "files") {
				event.preventDefault();
				if (!onImportFiles) {
					setInteractionMessage("当前画布无法导入该文件。");
					return;
				}
				void Promise.resolve()
					.then(() => onImportFiles(payload.files, center))
					.catch(() => setInteractionMessage("素材导入失败，请稍后重试。"));
				return;
			}
			if (payload?.kind === "text") {
				event.preventDefault();
				pasteTextAt(payload.text, center);
				return;
			}
			if (clipboardNodeIdsRef.current.length === 0) return;
			event.preventDefault();
			duplicateAt(clipboardNodeIdsRef.current, {
				x: center.x + pasteIndexRef.current * 24,
				y: center.y + pasteIndexRef.current * 24,
			});
		};
		window.addEventListener("paste", handlePaste);
		return () => window.removeEventListener("paste", handlePaste);
	}, [duplicateAt, graph.nodes, onImportFiles, pasteTextAt, visibleCenter]);

	useEffect(() => {
		if (!dragging) return;
		const move = (event: PointerEvent) => {
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
		const finish = () => {
			setDragging(null);
			dragHistoryRecordedRef.current = false;
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", finish, { once: true });
		return () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", finish);
		};
	}, [dragging, emitGraph, graph]);

	useEffect(() => {
		if (!connectionDrag) return;
		const move = (event: PointerEvent) => {
			const bounds = surfaceRef.current?.getBoundingClientRect();
			if (!bounds) return;
			setConnectionDrag((current) =>
				current
					? {
							...current,
							current: clientPointToWorld(
								{ x: event.clientX, y: event.clientY },
								bounds,
								graph.viewport,
							),
						}
					: null,
			);
		};
		const finish = (event: PointerEvent) => {
			const bounds = surfaceRef.current?.getBoundingClientRect();
			const target = document
				.elementFromPoint(event.clientX, event.clientY)
				?.closest<HTMLElement>("[data-node-id]")?.dataset.nodeId;
			if (target && target !== connectionDrag.sourceNodeId) {
				const next = connectCanvasNodes(
					graph,
					connectionDrag.sourceNodeId,
					target,
					`edge-${crypto.randomUUID()}`,
				);
				if (next !== graph) emitGraph(next);
			} else if (bounds) {
				setConnectionCreate({
					clientX: event.clientX,
					clientY: event.clientY,
					position: clientPointToWorld(
						{ x: event.clientX, y: event.clientY },
						bounds,
						graph.viewport,
					),
					sourceNodeId: connectionDrag.sourceNodeId,
				});
			}
			setConnectionDrag(null);
		};
		window.addEventListener("pointermove", move);
		window.addEventListener("pointerup", finish, { once: true });
		return () => {
			window.removeEventListener("pointermove", move);
			window.removeEventListener("pointerup", finish);
		};
	}, [connectionDrag, emitGraph, graph]);
	const commitTextEdit = (nodeId: string, text: string) => {
		const nodes = updateTextNode(graph.nodes, nodeId, text);
		if (nodes !== graph.nodes) emitGraph({ ...graph, nodes });
	};
	const keepHover = useCallback((nodeId: string) => {
		if (hoverLeaveTimerRef.current) {
			clearTimeout(hoverLeaveTimerRef.current);
			hoverLeaveTimerRef.current = null;
		}
		setHoverNodeId(nodeId);
	}, []);
	const leaveHover = useCallback(() => {
		if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current);
		hoverLeaveTimerRef.current = setTimeout(() => {
			setHoverNodeId(null);
			hoverLeaveTimerRef.current = null;
		}, 180);
	}, []);
	useEffect(
		() => () => {
			if (hoverLeaveTimerRef.current) clearTimeout(hoverLeaveTimerRef.current);
		},
		[],
	);
	const hoverKernelNode = useMemo(
		() => graph.nodes.find((node) => node.id === hoverNodeId) ?? null,
		[graph.nodes, hoverNodeId],
	);
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
	const addNode = (type: "audio" | "config" | "image" | "text" | "video") => {
		const center = visibleCenter();
		const node = createKernelNode(
			type,
			{ x: center.x - 170, y: center.y - 120 },
			`${type}-${crypto.randomUUID()}`,
		);
		emitGraph({ ...graph, nodes: [...graph.nodes, node] });
		onSelectNodes?.([node.id]);
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
					裁剪
				</button>
				<button
					disabled={!selectedImageId || !onMaskEditSelected}
					type="button"
					onClick={() => {
						if (selectedImageId) onMaskEditSelected?.(selectedImageId);
					}}
				>
					局部编辑
				</button>
				<button
					disabled={!selectedImageId || !onUpscaleSelected}
					type="button"
					onClick={() => {
						if (selectedImageId) onUpscaleSelected?.(selectedImageId);
					}}
				>
					2K放大
				</button>
				<button
					disabled={!selectedImageId || !onSplitSelected}
					type="button"
					onClick={() => {
						if (selectedImageId) onSplitSelected?.(selectedImageId);
					}}
				>
					2×2切分
				</button>
				<button
					disabled={!selectedImageId || !onAngleSelected}
					type="button"
					onClick={() => {
						if (selectedImageId) onAngleSelected?.(selectedImageId);
					}}
				>
					AI多角度
				</button>
				<button
					disabled={!selectedImageId || !onReversePromptSelected}
					type="button"
					onClick={() => {
						if (selectedImageId) onReversePromptSelected?.(selectedImageId);
					}}
				>
					反推提示词
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
					backgroundMode={backgroundMode}
					containerRef={surfaceRef}
					onCanvasDeselect={() => {
						onSelectNodes?.([]);
						setSelectedConnectionId(null);
						setContextMenu(null);
					}}
					onCanvasMouseDown={beginMarquee}
					onDrop={(event) => {
						const files = Array.from(event.dataTransfer.files);
						const bounds = surfaceRef.current?.getBoundingClientRect();
						if (!bounds || files.length === 0) return;
						event.preventDefault();
						void onImportFiles?.(
							files,
							clientPointToWorld(
								{ x: event.clientX, y: event.clientY },
								bounds,
								graph.viewport,
							),
						);
					}}
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
										onContextMenu={(event) => {
											setSelectedConnectionId(edge.id);
											onSelectNodes?.([]);
											setContextMenu({
												connectionId: edge.id,
												type: "connection",
												x: event.clientX,
												y: event.clientY,
											});
										}}
										to={toVozebNode(to, deliveryUrl)}
									/>
								</g>
							);
						})}
						{connectionDrag ? (
							<path
								d={`M ${connectionDrag.start.x} ${connectionDrag.start.y} C ${connectionDrag.start.x + 60} ${connectionDrag.start.y}, ${connectionDrag.current.x - 60} ${connectionDrag.current.y}, ${connectionDrag.current.x} ${connectionDrag.current.y}`}
								fill="none"
								stroke="#2f80ff"
								strokeDasharray="6 4"
								strokeWidth={2}
							/>
						) : null}
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
										isConnecting={Boolean(connectionDrag)}
										isConnectionTarget={
											Boolean(connectionDrag) &&
											connectionDrag?.sourceNodeId !== node.id
										}
										isFocusRelated={related}
										isRelated={related}
										isSelected={selected.has(node.id)}
										mentionReferences={[]}
										onConnectStart={(event, nodeId, handleType) => {
											event.preventDefault();
											event.stopPropagation();
											const source = graph.nodes.find(
												(candidate) => candidate.id === nodeId,
											);
											if (!source) return;
											const start = {
												x:
													handleType === "source"
														? source.x + source.width
														: source.x,
												y: source.y + source.height / 2,
											};
											setConnectionDrag({
												current: start,
												sourceNodeId: nodeId,
												start,
											});
											setConnectionCreate(null);
										}}
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
										onHoverEnd={leaveHover}
										onHoverStart={(nodeId) => keepHover(nodeId)}
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
										onRetry={() => retryFrozenJob(node)}
										onViewImage={() => openImagePreview(node)}
										renderNodeContent={(candidate) => (
											<div className="kernel-config-node">
												<strong>生成配置</strong>
												<span>
													{candidate.metadata?.prompt || "选择节点后配置生成"}
												</span>
											</div>
										)}
										scale={graph.viewport.scale}
										showImageInfo={showImageInfo}
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
					<>
						<CanvasZoomControls
							isMiniMapOpen={isMiniMapOpen}
							onReset={() => updateViewport({ scale: 1, x: 0, y: 0 })}
							onScaleChange={changeScale}
							onToggleMiniMap={() => setIsMiniMapOpen((open) => !open)}
							scale={graph.viewport.scale}
						/>
						<K2CanvasToolbar
							backgroundMode={backgroundMode}
							onAddNode={addNode}
							onBackgroundModeChange={setBackgroundMode}
							onClear={() => setClearConfirmationOpen(graph.nodes.length > 0)}
							onDelete={() => deleteSelection()}
							onOpenAssets={() => onOpenAssets?.()}
							onShowImageInfoChange={setShowImageInfo}
							onUpload={() => onUpload?.()}
							selectedCount={selectedNodeIds.length}
							showImageInfo={showImageInfo}
						/>
					</>
				) : null}
				{interactionMessage ? (
					<output
						className="absolute left-1/2 top-4 z-[90] -translate-x-1/2 rounded-full bg-black/80 px-3 py-2 text-sm text-white shadow-lg"
						data-canvas-interaction-message="true"
					>
						{interactionMessage}
					</output>
				) : null}
				{previewAssetId ? (
					<div
						aria-label="图片大图预览"
						aria-modal="true"
						className="fixed inset-0 z-[100] grid place-items-center bg-black/75 p-6"
						data-image-preview="true"
						role="dialog"
					>
						<div className="relative max-h-full max-w-5xl rounded-2xl bg-black p-3 shadow-2xl">
							<button
								aria-label="关闭图片预览"
								className="absolute right-2 top-2 z-10 rounded-full bg-black/70 px-3 py-1 text-sm text-white"
								type="button"
								onClick={() => setPreviewAssetId(null)}
							>
								关闭
							</button>
							<Image
								alt="图片大图预览"
								className="max-h-[80vh] max-w-[88vw] rounded-xl object-contain"
								height={1200}
								src={deliveryUrl(previewAssetId)}
								unoptimized
								width={1600}
							/>
						</div>
					</div>
				) : null}
				{clearConfirmationOpen ? (
					<div
						aria-labelledby="clear-canvas-title"
						aria-modal="true"
						className="fixed inset-0 z-[100] grid place-items-center bg-black/50 p-6"
						data-canvas-clear-confirmation="true"
						role="dialog"
					>
						<div className="w-full max-w-sm rounded-2xl bg-white p-5 text-slate-900 shadow-2xl">
							<strong id="clear-canvas-title">确认清空画布？</strong>
							<p className="mt-2 text-sm text-slate-600">
								将移除当前草稿中的全部节点和连线，可通过撤销恢复。
							</p>
							<div className="mt-4 flex justify-end gap-2">
								<button
									type="button"
									onClick={() => setClearConfirmationOpen(false)}
								>
									取消
								</button>
								<button
									className="rounded-lg bg-red-600 px-3 py-2 text-white"
									type="button"
									onClick={clearCanvas}
								>
									确认清空
								</button>
							</div>
						</div>
					</div>
				) : null}
				{clientChromeReady && hoverKernelNode ? (
					<KernelNodeHoverToolbar
						kernelNode={hoverKernelNode}
						node={toVozebNode(hoverKernelNode, deliveryUrl)}
						viewport={{
							k: graph.viewport.scale,
							x: graph.viewport.x,
							y: graph.viewport.y,
						}}
						onCrop={
							onCropSelected
								? (nodeId) => {
										onCropSelected(nodeId);
									}
								: undefined
						}
						onSplit={
							onSplitSelected
								? (nodeId) => {
										onSplitSelected(nodeId);
									}
								: undefined
						}
						onUpscale={
							onUpscaleSelected
								? (nodeId) => {
										onUpscaleSelected(nodeId);
									}
								: undefined
						}
						onDelete={(nodeId) => {
							deleteSelection([nodeId], null);
							setHoverNodeId(null);
						}}
						onDownload={(nodeId) => {
							const target = graph.nodes.find((node) => node.id === nodeId);
							const assetId =
								typeof target?.data.assetId === "string"
									? target.data.assetId
									: null;
							if (!assetId || typeof window === "undefined") return;
							window.open(deliveryUrl(assetId, { download: true }), "_blank");
						}}
						onFontDelta={(nodeId, delta) => {
							const nodes = adjustTextFontSize(graph.nodes, nodeId, delta);
							if (nodes !== graph.nodes) emitGraph({ ...graph, nodes });
						}}
						onKeep={keepHover}
						onLeave={leaveHover}
						onRetry={(nodeId) => {
							const node = graph.nodes.find(
								(candidate) => candidate.id === nodeId,
							);
							if (node) retryFrozenJob(node);
						}}
						onToggleFreeResize={(nodeId) => {
							const nodes = toggleNodeFreeResize(graph.nodes, nodeId);
							if (nodes !== graph.nodes) emitGraph({ ...graph, nodes });
						}}
						onView={(nodeId) => {
							const node = graph.nodes.find(
								(candidate) => candidate.id === nodeId,
							);
							if (node) openImagePreview(node);
						}}
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
				{connectionCreate ? (
					<div
						className="fixed z-[90] flex gap-1 rounded-xl border bg-black/90 p-2 shadow-2xl"
						data-connection-create-menu="true"
						style={{
							left: connectionCreate.clientX,
							top: connectionCreate.clientY,
						}}
					>
						{(["text", "image", "video", "audio", "config"] as const).map(
							(type) => (
								<button
									key={type}
									type="button"
									onClick={() => {
										const node = createKernelNode(
											type,
											connectionCreate.position,
											`${type}-${crypto.randomUUID()}`,
										);
										const withNode = {
											...graph,
											nodes: [...graph.nodes, node],
										};
										emitGraph(
											connectCanvasNodes(
												withNode,
												connectionCreate.sourceNodeId,
												node.id,
												`edge-${crypto.randomUUID()}`,
											),
										);
										onSelectNodes?.([node.id]);
										setConnectionCreate(null);
									}}
								>
									{type === "text"
										? "文字"
										: type === "image"
											? "图片"
											: type === "video"
												? "视频"
												: type === "audio"
													? "音频"
													: "生成配置"}
								</button>
							),
						)}
					</div>
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
