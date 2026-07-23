"use client";

import { Modal, Segmented, Switch } from "antd";
import {
	Download,
	Ellipsis,
	Grid2x2,
	ImagePlus,
	Info,
	Lock,
	LockOpen,
	Maximize2,
	Minus,
	Plus,
	RefreshCw,
	Scissors,
	Trash2,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";
import type { CanvasNodeData } from "@/src/vendor/vozeb/app/(user)/canvas/types";
import type { KernelNode } from "../graph-bridge";
import {
	buildDesensitizedNodeInfo,
	type DesensitizedNodeInfo,
} from "../kernel-node-info";
import {
	defaultImageQuickToolIds,
	IMAGE_QUICK_TOOLS_STORAGE_KEY,
	type ImageQuickToolId,
	parseImageQuickToolsStorage,
	readImageQuickToolsConfig,
	serializeImageQuickToolsConfig,
} from "./image-quick-tools";

export type HoverViewport = { k: number; x: number; y: number };

export type KernelNodeHoverHandlers = {
	onCrop?: (nodeId: string) => void;
	onDelete: (nodeId: string) => void;
	onDownload?: (nodeId: string) => void;
	onFontDelta?: (nodeId: string, delta: number) => void;
	onRetry?: (nodeId: string) => void;
	onSplit?: (nodeId: string) => void;
	onToggleFreeResize?: (nodeId: string) => void;
	onUpscale?: (nodeId: string) => void;
	onView?: (nodeId: string) => void;
};

type ToolbarTool = {
	active?: boolean;
	danger?: boolean;
	id: string;
	label: string;
	onClick: () => void;
	title: string;
	icon: ReactNode;
};

type KernelNodeHoverToolbarProps = KernelNodeHoverHandlers & {
	kernelNode: KernelNode;
	node: CanvasNodeData;
	onKeep: (nodeId: string) => void;
	onLeave: () => void;
	viewport: HoverViewport;
};

const IMAGE_TOOL_META: Record<
	ImageQuickToolId,
	{ label: string; title: string }
> = {
	crop: { label: "裁剪", title: "方形裁切" },
	delete: { label: "删除", title: "移除节点" },
	download: { label: "下载", title: "下载图片" },
	info: { label: "信息", title: "查看节点信息" },
	resize: { label: "锁比例", title: "切换等比/自由比例" },
	split: { label: "切分", title: "2×2 网格切分" },
	upscale: { label: "放大", title: "2K 放大" },
	view: { label: "大图", title: "查看图片" },
};

export function KernelNodeHoverToolbar({
	kernelNode,
	node,
	onCrop,
	onDelete,
	onDownload,
	onFontDelta,
	onKeep,
	onLeave,
	onRetry,
	onSplit,
	onToggleFreeResize,
	onUpscale,
	onView,
	viewport,
}: KernelNodeHoverToolbarProps) {
	const toolbarRef = useRef<HTMLDivElement>(null);
	const [toolbarWidth, setToolbarWidth] = useState(0);
	const [viewportWidth, setViewportWidth] = useState(0);
	const [infoOpen, setInfoOpen] = useState(false);
	const [settingsOpen, setSettingsOpen] = useState(false);
	const [quickToolIds, setQuickToolIds] = useState<ImageQuickToolId[]>(
		defaultImageQuickToolIds,
	);
	const [showLabels, setShowLabels] = useState(true);
	const [draftIds, setDraftIds] = useState<ImageQuickToolId[]>(
		defaultImageQuickToolIds,
	);
	const [draftShowLabels, setDraftShowLabels] = useState(true);

	useEffect(() => {
		if (typeof window === "undefined") return;
		const stored = parseImageQuickToolsStorage(
			window.localStorage.getItem(IMAGE_QUICK_TOOLS_STORAGE_KEY),
		);
		setQuickToolIds(stored.ids);
		setShowLabels(stored.showLabels);
	}, []);

	// Reset dialogs when the hovered node identity changes.
	// biome-ignore lint/correctness/useExhaustiveDependencies: node.id is the intentional reset key
	useEffect(() => {
		setInfoOpen(false);
		setSettingsOpen(false);
	}, [node.id]);

	// Re-measure when toolbar contents change (tool set / labels / settings chrome).
	// biome-ignore lint/correctness/useExhaustiveDependencies: content deps intentionally re-sync metrics
	useEffect(() => {
		const toolbar = toolbarRef.current;
		if (!toolbar || typeof window === "undefined") return;
		const sync = () => {
			setToolbarWidth(toolbar.offsetWidth);
			setViewportWidth(window.innerWidth);
		};
		sync();
		const observer =
			typeof ResizeObserver !== "undefined" ? new ResizeObserver(sync) : null;
		observer?.observe(toolbar);
		window.addEventListener("resize", sync);
		return () => {
			observer?.disconnect();
			window.removeEventListener("resize", sync);
		};
	}, [node.id, quickToolIds, showLabels, settingsOpen]);

	const isImage = node.type === "image";
	const isText = node.type === "text";
	const hasMedia = Boolean(node.metadata?.content) && !isText;
	const hasImage = isImage && Boolean(node.metadata?.content);
	const canRetry = node.metadata?.status === "error";
	const freeResize = Boolean(node.metadata?.freeResize);

	const imageTools: ToolbarTool[] = useMemo(() => {
		if (!isImage) return [];
		const available: ToolbarTool[] = [
			{
				id: "info",
				icon: <Info className="size-4" />,
				label: "信息",
				onClick: () => setInfoOpen(true),
				title: "查看节点信息",
			},
			{
				danger: true,
				id: "delete",
				icon: <Trash2 className="size-4" />,
				label: "删除",
				onClick: () => onDelete(node.id),
				title: "移除节点",
			},
			...(hasImage && onDownload
				? [
						{
							id: "download",
							icon: <Download className="size-4" />,
							label: "下载",
							onClick: () => onDownload(node.id),
							title: "下载图片",
						} satisfies ToolbarTool,
					]
				: []),
			...(hasImage && onToggleFreeResize
				? [
						{
							active: freeResize,
							id: "resize",
							icon: freeResize ? (
								<LockOpen className="size-4" />
							) : (
								<Lock className="size-4" />
							),
							label: freeResize ? "自由比例" : "锁比例",
							onClick: () => onToggleFreeResize(node.id),
							title: freeResize ? "切换为等比缩放" : "切换为自由比例",
						} satisfies ToolbarTool,
					]
				: []),
			...(hasImage && onCrop
				? [
						{
							id: "crop",
							icon: <Scissors className="size-4" />,
							label: "裁剪",
							onClick: () => onCrop(node.id),
							title: "方形裁切",
						} satisfies ToolbarTool,
					]
				: []),
			...(hasImage && onUpscale
				? [
						{
							id: "upscale",
							icon: <ImagePlus className="size-4" />,
							label: "放大",
							onClick: () => onUpscale(node.id),
							title: "2K 放大",
						} satisfies ToolbarTool,
					]
				: []),
			...(hasImage && onSplit
				? [
						{
							id: "split",
							icon: <Grid2x2 className="size-4" />,
							label: "切分",
							onClick: () => onSplit(node.id),
							title: "2×2 网格切分",
						} satisfies ToolbarTool,
					]
				: []),
			...(hasImage && onView
				? [
						{
							id: "view",
							icon: <Maximize2 className="size-4" />,
							label: "大图",
							onClick: () => onView(node.id),
							title: "查看图片",
						} satisfies ToolbarTool,
					]
				: []),
		];
		const selected = new Set(quickToolIds);
		return available.filter((tool) =>
			selected.has(tool.id as ImageQuickToolId),
		);
	}, [
		freeResize,
		hasImage,
		isImage,
		node.id,
		onCrop,
		onDelete,
		onDownload,
		onSplit,
		onToggleFreeResize,
		onUpscale,
		onView,
		quickToolIds,
	]);

	const nonImageTools: ToolbarTool[] = useMemo(() => {
		if (isImage) return [];
		const tools: ToolbarTool[] = [
			{
				id: "info",
				icon: <Info className="size-4" />,
				label: "信息",
				onClick: () => setInfoOpen(true),
				title: "查看节点信息",
			},
			{
				danger: true,
				id: "delete",
				icon: <Trash2 className="size-4" />,
				label: "删除",
				onClick: () => onDelete(node.id),
				title: "移除节点",
			},
		];
		if (canRetry && onRetry) {
			tools.push({
				id: "retry",
				icon: <RefreshCw className="size-4" />,
				label: "重试",
				onClick: () => onRetry(node.id),
				title: "重新生成",
			});
		}
		if (hasMedia && onDownload) {
			tools.push({
				id: "download",
				icon: <Download className="size-4" />,
				label: "下载",
				onClick: () => onDownload(node.id),
				title: "下载媒体",
			});
		}
		if (isText && onFontDelta) {
			tools.push(
				{
					id: "decreaseFont",
					icon: <Minus className="size-4" />,
					label: "缩小",
					onClick: () => onFontDelta(node.id, -2),
					title: "减小字号",
				},
				{
					id: "increaseFont",
					icon: <Plus className="size-4" />,
					label: "放大",
					onClick: () => onFontDelta(node.id, 2),
					title: "增大字号",
				},
			);
		}
		return tools;
	}, [
		canRetry,
		hasMedia,
		isImage,
		isText,
		node.id,
		onDelete,
		onDownload,
		onFontDelta,
		onRetry,
	]);

	const toolbarTools = isImage ? imageTools : nonImageTools;

	const left = viewport.x + (node.position.x + node.width / 2) * viewport.k;
	const top = viewport.y + node.position.y * viewport.k - 14;
	const safeToolbarWidth = Math.min(
		toolbarWidth || 0,
		Math.max(0, (viewportWidth || 0) - 32),
	);
	const toolbarLeft =
		viewportWidth && safeToolbarWidth
			? Math.min(
					Math.max(left, safeToolbarWidth / 2 + 16),
					viewportWidth - safeToolbarWidth / 2 - 16,
				)
			: left;

	const openSettings = () => {
		onKeep(node.id);
		setDraftIds(quickToolIds);
		setDraftShowLabels(showLabels);
		setSettingsOpen(true);
	};

	const closeSettings = () => {
		setSettingsOpen(false);
		onLeave();
	};

	const saveSettings = () => {
		const config = readImageQuickToolsConfig({
			ids: draftIds,
			showLabels: draftShowLabels,
		});
		setQuickToolIds(config.ids);
		setShowLabels(config.showLabels);
		if (typeof window !== "undefined") {
			window.localStorage.setItem(
				IMAGE_QUICK_TOOLS_STORAGE_KEY,
				serializeImageQuickToolsConfig(config),
			);
		}
		closeSettings();
	};

	const toggleDraft = (id: ImageQuickToolId) => {
		setDraftIds((current) => {
			const next = new Set(current);
			if (next.has(id)) next.delete(id);
			else next.add(id);
			return readImageQuickToolsConfig({
				ids: [...next],
				showLabels: draftShowLabels,
			}).ids;
		});
	};

	const desensitized = useMemo(
		() =>
			buildDesensitizedNodeInfo({
				bytes:
					typeof kernelNode.data.bytes === "number"
						? kernelNode.data.bytes
						: undefined,
				errorDetails:
					typeof node.metadata?.errorDetails === "string"
						? node.metadata.errorDetails
						: undefined,
				freeResize,
				height: node.height,
				prompt:
					typeof node.metadata?.prompt === "string"
						? node.metadata.prompt
						: typeof kernelNode.data.prompt === "string"
							? kernelNode.data.prompt
							: typeof kernelNode.data.text === "string"
								? kernelNode.data.text
								: undefined,
				status: node.metadata?.status,
				type: node.type,
				width: node.width,
				x: kernelNode.x,
				y: kernelNode.y,
			}),
		[freeResize, kernelNode, node],
	);

	return (
		<>
			<div
				ref={toolbarRef}
				role="toolbar"
				aria-label="节点快捷工具"
				className="absolute z-[70] flex h-12 max-w-[calc(100vw-32px)] -translate-x-1/2 -translate-y-full items-center overflow-x-auto overflow-y-hidden rounded-[18px] border border-black/10 bg-white text-[15px] text-[#242529] shadow-[0_8px_28px_rgba(15,23,42,.12)]"
				data-kernel-hover-toolbar="true"
				data-node-id={node.id}
				style={{ left: toolbarLeft, top }}
				onMouseEnter={() => onKeep(node.id)}
				onMouseLeave={() => {
					if (!settingsOpen && !infoOpen) onLeave();
				}}
				onMouseDown={(event) => event.stopPropagation()}
				onPointerDown={(event) => event.stopPropagation()}
			>
				{toolbarTools.map((tool) => (
					<ToolbarAction key={tool.id} {...tool} showLabel={showLabels} />
				))}
				{isImage ? (
					<ToolbarAction
						active={settingsOpen}
						id="more"
						icon={<Ellipsis className="size-4" />}
						label="更多"
						onClick={openSettings}
						showLabel={showLabels}
						title="配置快捷工具"
					/>
				) : null}
			</div>

			<KernelNodeInfoModal
				info={desensitized}
				open={infoOpen}
				onClose={() => {
					setInfoOpen(false);
					onLeave();
				}}
			/>

			{isImage ? (
				<Modal
					centered
					className="canvas-image-toolbar-settings-modal"
					footer={
						<div className="flex items-center justify-between gap-3">
							<div className="flex items-center gap-2 text-sm">
								<span>显示按钮文字</span>
								<Switch
									aria-label="显示按钮文字"
									checked={draftShowLabels}
									onChange={setDraftShowLabels}
								/>
							</div>
							<div className="flex gap-2">
								<button type="button" onClick={closeSettings}>
									取消
								</button>
								<button type="button" onClick={saveSettings}>
									保存
								</button>
							</div>
						</div>
					}
					open={settingsOpen}
					title="自定义工具栏"
					width={560}
					onCancel={closeSettings}
				>
					<p className="mb-3 text-sm opacity-70">
						选择图片节点悬浮栏中显示的快捷工具（仅含当前可用能力）。
					</p>
					<div
						className="grid gap-2 md:grid-cols-2"
						data-image-toolbar-settings="true"
					>
						{(Object.keys(IMAGE_TOOL_META) as ImageQuickToolId[]).map((id) => {
							const meta = IMAGE_TOOL_META[id];
							const checked = draftIds.includes(id);
							return (
								<button
									key={id}
									type="button"
									aria-label={meta.title}
									aria-pressed={checked}
									className={`flex min-h-9 items-center gap-2 rounded-md border px-3 py-2 text-left text-sm ${checked ? "border-[#2f80ff] bg-[#2f80ff14]" : "border-black/10"}`}
									onClick={() => toggleDraft(id)}
								>
									<span>{checked ? "✓" : "○"}</span>
									<span>{meta.label}</span>
								</button>
							);
						})}
					</div>
				</Modal>
			) : null}
		</>
	);
}

export function KernelNodeInfoModal({
	info,
	open,
	onClose,
}: {
	info: DesensitizedNodeInfo;
	open: boolean;
	onClose: () => void;
}) {
	const [view, setView] = useState<"info" | "json">("info");

	useEffect(() => {
		if (open) setView("info");
	}, [open]);

	return (
		<Modal
			centered
			className="canvas-node-info-modal"
			footer={null}
			open={open}
			title={
				<div className="flex items-center justify-between gap-4 pr-8">
					<span>节点信息</span>
					<Segmented
						options={[
							{ label: "信息", value: "info" },
							{ label: "JSON", value: "json" },
						]}
						size="small"
						value={view}
						onChange={(value) => setView(value as "info" | "json")}
					/>
				</div>
			}
			onCancel={onClose}
		>
			<div
				className="h-[56vh] min-h-[280px] text-sm"
				data-kernel-node-info="true"
			>
				{view === "info" ? (
					<div className="h-full space-y-3 overflow-auto pr-1">
						{info.rows.map((row) => (
							<div
								key={row.label}
								className="grid grid-cols-[72px_minmax(0,1fr)] gap-3"
							>
								<span className="opacity-50">{row.label}</span>
								<span className="min-w-0 whitespace-pre-wrap break-words">
									{row.value}
								</span>
							</div>
						))}
					</div>
				) : (
					<pre
						className="h-full overflow-auto rounded-lg border border-black/10 bg-black/5 p-3 text-xs leading-5"
						data-kernel-node-info-json="true"
					>
						{info.json}
					</pre>
				)}
			</div>
		</Modal>
	);
}

function ToolbarAction({
	active = false,
	danger = false,
	icon,
	label,
	onClick,
	showLabel,
	title,
}: ToolbarTool & { showLabel: boolean }) {
	const hasText = showLabel && Boolean(label);
	return (
		<button
			type="button"
			aria-label={title}
			title={title}
			className={`group relative flex h-12 items-center whitespace-nowrap px-1.5 ${danger ? "text-[#ef4444]" : ""}`}
			onClick={onClick}
		>
			<span
				className={`flex h-9 items-center rounded-lg transition group-hover:bg-[#f0f0f1] ${hasText ? "gap-2 px-2.5" : "justify-center px-2"} ${active ? "bg-[#eeeeef]" : ""}`}
			>
				{icon}
				{hasText ? <span>{label}</span> : null}
			</span>
		</button>
	);
}
