import {
	Eraser,
	FolderOpen,
	Image,
	Info,
	Music2,
	Palette,
	Settings2,
	Trash2,
	Type,
	Upload,
	Video,
} from "lucide-react";
import type React from "react";
import { useState } from "react";
import { type CanvasBackgroundMode, canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type K2NodeType = "audio" | "config" | "image" | "text" | "video";

export function K2CanvasToolbar({
	backgroundMode,
	onAddNode,
	onBackgroundModeChange,
	onClear,
	onDelete,
	onOpenAssets,
	onShowImageInfoChange,
	onUpload,
	selectedCount,
	showImageInfo,
}: {
	backgroundMode: CanvasBackgroundMode;
	onAddNode: (type: K2NodeType) => void;
	onBackgroundModeChange: (mode: CanvasBackgroundMode) => void;
	onClear: () => void;
	onDelete: () => void;
	onOpenAssets: () => void;
	onShowImageInfoChange: (show: boolean) => void;
	onUpload: () => void;
	selectedCount: number;
	showImageInfo: boolean;
}) {
	const [appearanceOpen, setAppearanceOpen] = useState(false);
	const theme = canvasThemes[useThemeStore((state) => state.theme)];
	const buttonStyle = { color: theme.toolbar.item };
	return (
		<div
			className="pointer-events-none absolute bottom-5 left-1/2 z-50 -translate-x-1/2"
			data-k2-canvas-toolbar="true"
		>
			<div
				className="pointer-events-auto flex h-14 items-center gap-1 rounded-xl border px-2 shadow-lg backdrop-blur"
				style={{
					background: theme.toolbar.panel,
					borderColor: theme.toolbar.border,
				}}
			>
				<Tool
					icon={<Type />}
					label="文本"
					onClick={() => onAddNode("text")}
					style={buttonStyle}
				/>
				<Tool
					icon={<Image />}
					label="图片"
					onClick={() => onAddNode("image")}
					style={buttonStyle}
				/>
				<Tool
					icon={<Video />}
					label="视频"
					onClick={() => onAddNode("video")}
					style={buttonStyle}
				/>
				<Tool
					icon={<Music2 />}
					label="音频"
					onClick={() => onAddNode("audio")}
					style={buttonStyle}
				/>
				<Tool
					icon={<Settings2 />}
					label="生成配置"
					onClick={() => onAddNode("config")}
					style={buttonStyle}
				/>
				<Tool
					icon={<Upload />}
					label="上传素材"
					onClick={onUpload}
					style={buttonStyle}
				/>
				<Tool
					icon={<FolderOpen />}
					label="我的素材"
					onClick={onOpenAssets}
					style={buttonStyle}
				/>
				<Tool
					icon={<Palette />}
					label="画布外观"
					onClick={() => setAppearanceOpen((open) => !open)}
					style={buttonStyle}
				/>
				{selectedCount > 0 ? (
					<Tool
						icon={<Trash2 />}
						label="删除选中"
						onClick={onDelete}
						style={{ color: "#f87171" }}
					/>
				) : null}
				<Tool
					icon={<Eraser />}
					label="清空画布"
					onClick={onClear}
					style={{ color: "#f87171" }}
				/>
			</div>
			{appearanceOpen ? (
				<div
					className="pointer-events-auto absolute bottom-[72px] left-1/2 w-56 -translate-x-1/2 rounded-xl border p-3 shadow-xl"
					style={{
						background: theme.toolbar.panel,
						borderColor: theme.toolbar.border,
						color: theme.toolbar.item,
					}}
				>
					<strong className="text-sm">画布外观</strong>
					<div className="mt-2 flex gap-1">
						{(["dots", "lines", "blank"] as const).map((mode) => (
							<button
								key={mode}
								type="button"
								aria-pressed={backgroundMode === mode}
								onClick={() => onBackgroundModeChange(mode)}
							>
								{mode === "dots" ? "点" : mode === "lines" ? "线" : "空白"}
							</button>
						))}
					</div>
					<label className="mt-3 flex items-center justify-between gap-3 text-xs">
						<span className="inline-flex items-center gap-1">
							<Info className="size-3.5" />
							图片信息
						</span>
						<input
							type="checkbox"
							checked={showImageInfo}
							onChange={(event) => onShowImageInfoChange(event.target.checked)}
						/>
					</label>
				</div>
			) : null}
		</div>
	);
}

function Tool({
	icon,
	label,
	onClick,
	style,
}: {
	icon: React.ReactNode;
	label: string;
	onClick: () => void;
	style: React.CSSProperties;
}) {
	return (
		<button
			aria-label={label}
			className="flex size-8 items-center justify-center rounded-md [&_svg]:size-4"
			title={label}
			type="button"
			onClick={onClick}
			style={style}
		>
			{icon}
		</button>
	);
}
