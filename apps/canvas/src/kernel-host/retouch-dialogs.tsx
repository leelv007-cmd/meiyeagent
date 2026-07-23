"use client";

import { Button, Input, InputNumber, Modal, Segmented, Slider } from "antd";
import {
	Brush,
	Check,
	Eraser,
	Grid2x2,
	ImagePlus,
	Lock,
	LockOpen,
	RotateCcw,
	WandSparkles,
	X,
} from "lucide-react";
import {
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	cropDisplayAspectRatio,
	moveRetouchCrop,
	type RetouchCropHandle,
	type RetouchCropRect,
	resizeRetouchCrop,
} from "./retouch-crop";
import type { RetouchGenerationKind } from "./retouch-generation";

export type RetouchDialogKind = "angle" | "crop" | "mask" | "split" | "upscale";

export type RetouchDialogRequest = {
	dataUrl: string;
	kind: RetouchDialogKind;
	nodeId: string;
};

export type { RetouchCropRect } from "./retouch-crop";

export type RetouchUpscaleParams = {
	algorithm: "bilinear" | "high" | "nearest";
	targetLongEdge: number;
};

export type RetouchSplitParams = {
	columns: number;
	rows: number;
};

export type RetouchAngleDialogParams = {
	cameraDistance: number;
	horizontalAngle: number;
	pitchAngle: number;
	wideAngle: boolean;
};

export type RetouchMaskEditPayload = {
	maskDataUrl: string;
	prompt: string;
};

type RetouchDialogsProps = {
	onClose: () => void;
	onConfirmAngle: (nodeId: string, params: RetouchAngleDialogParams) => void;
	onConfirmCrop: (nodeId: string, crop: RetouchCropRect) => void;
	onConfirmMask: (nodeId: string, payload: RetouchMaskEditPayload) => void;
	onConfirmSplit: (nodeId: string, params: RetouchSplitParams) => void;
	onConfirmUpscale: (nodeId: string, params: RetouchUpscaleParams) => void;
	request: RetouchDialogRequest | null;
};

/**
 * K3 host-owned retouch controls. They deliberately do not extend a ported
 * toolbar or exact-copy dialog, so K1 copy-manifest bytes remain authoritative.
 */
export function RetouchDialogs({
	onClose,
	onConfirmAngle,
	onConfirmCrop,
	onConfirmMask,
	onConfirmSplit,
	onConfirmUpscale,
	request,
}: RetouchDialogsProps) {
	if (!request) return null;

	switch (request.kind) {
		case "crop":
			return (
				<CropDialog
					dataUrl={request.dataUrl}
					key={`${request.kind}:${request.nodeId}:${request.dataUrl}`}
					onClose={onClose}
					onConfirm={(crop) => onConfirmCrop(request.nodeId, crop)}
				/>
			);
		case "mask":
			return (
				<MaskDialog
					dataUrl={request.dataUrl}
					key={`${request.kind}:${request.nodeId}:${request.dataUrl}`}
					onClose={onClose}
					onConfirm={(payload) => onConfirmMask(request.nodeId, payload)}
				/>
			);
		case "upscale":
			return (
				<UpscaleDialog
					dataUrl={request.dataUrl}
					key={`${request.kind}:${request.nodeId}:${request.dataUrl}`}
					onClose={onClose}
					onConfirm={(params) => onConfirmUpscale(request.nodeId, params)}
				/>
			);
		case "split":
			return (
				<SplitDialog
					dataUrl={request.dataUrl}
					key={`${request.kind}:${request.nodeId}:${request.dataUrl}`}
					onClose={onClose}
					onConfirm={(params) => onConfirmSplit(request.nodeId, params)}
				/>
			);
		case "angle":
			return (
				<AngleDialog
					dataUrl={request.dataUrl}
					key={`${request.kind}:${request.nodeId}:${request.dataUrl}`}
					onClose={onClose}
					onConfirm={(params) => onConfirmAngle(request.nodeId, params)}
				/>
			);
	}
}

function CropDialog({
	dataUrl,
	onClose,
	onConfirm,
}: {
	dataUrl: string;
	onClose: () => void;
	onConfirm: (crop: RetouchCropRect) => void;
}) {
	const boxRef = useRef<HTMLDivElement>(null);
	const [crop, setCrop] = useState<RetouchCropRect>(defaultCrop);
	const [locked, setLocked] = useState(false);
	const [lockedAspectRatio, setLockedAspectRatio] = useState<number | null>(
		null,
	);
	const image = useImageDimensions(dataUrl);

	const beginDrag = (
		mode: "move" | "resize",
		event: ReactPointerEvent,
		handle?: RetouchCropHandle,
	) => {
		const box = boxRef.current?.getBoundingClientRect();
		if (!box) return;
		event.preventDefault();
		event.stopPropagation();
		const start = { crop, x: event.clientX, y: event.clientY };
		const aspectRatio = locked
			? (lockedAspectRatio ?? cropDisplayAspectRatio(start.crop, box))
			: null;
		const move = (moveEvent: PointerEvent) => {
			const dx = (moveEvent.clientX - start.x) / box.width;
			const dy = (moveEvent.clientY - start.y) / box.height;
			setCrop(
				mode === "move"
					? moveRetouchCrop(start.crop, dx, dy)
					: resizeRetouchCrop({
							aspectRatio,
							box,
							crop: start.crop,
							dx,
							dy,
							handle: handle ?? "se",
						}),
			);
		};
		const stop = () => {
			document.removeEventListener("pointermove", move);
			document.removeEventListener("pointerup", stop);
		};
		document.addEventListener("pointermove", move);
		document.addEventListener("pointerup", stop);
	};

	const cropSize = image
		? {
				height: Math.max(1, Math.round(crop.height * image.height)),
				width: Math.max(1, Math.round(crop.width * image.width)),
			}
		: null;

	return (
		<Modal
			centered
			destroyOnHidden
			footer={null}
			open
			title="裁剪图片"
			width={780}
			onCancel={onClose}
		>
			<div className="space-y-4">
				<div className="flex justify-center">
					<div
						className="relative inline-block max-w-full select-none overflow-hidden rounded-lg bg-black"
						ref={boxRef}
					>
						{/* biome-ignore lint/performance/noImgElement: private OwnedAsset data URL preview. */}
						<img
							alt=""
							className="block max-h-[62vh] max-w-full opacity-90"
							draggable={false}
							src={dataUrl}
						/>
						<CropMask crop={crop} />
						<div
							className="absolute cursor-move border-2 border-white shadow-[0_0_0_1px_rgba(0,0,0,.3),0_0_28px_rgba(0,0,0,.28)]"
							style={cropStyle(crop)}
							onPointerDown={(event) => beginDrag("move", event)}
						>
							<div className="pointer-events-none absolute inset-x-0 top-1/3 border-t border-white/50" />
							<div className="pointer-events-none absolute inset-x-0 top-2/3 border-t border-white/50" />
							<div className="pointer-events-none absolute inset-y-0 left-1/3 border-l border-white/50" />
							<div className="pointer-events-none absolute inset-y-0 left-2/3 border-l border-white/50" />
							{cropHandles.map((handle) => (
								<button
									aria-label="调整裁剪框"
									className="absolute size-3 rounded-full border border-black bg-white"
									key={handle}
									style={cropHandleStyle(handle)}
									type="button"
									onPointerDown={(event) => beginDrag("resize", event, handle)}
								/>
							))}
						</div>
					</div>
				</div>
				<div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border px-3 py-2">
					<div className="flex flex-wrap gap-3 text-sm opacity-80">
						<span>
							裁剪尺寸{" "}
							{cropSize ? `${cropSize.width} × ${cropSize.height}` : "读取中"}
						</span>
						{image ? (
							<span>
								原图 {image.width} × {image.height}
							</span>
						) : null}
					</div>
					<Button
						icon={
							locked ? (
								<Lock className="size-4" />
							) : (
								<LockOpen className="size-4" />
							)
						}
						onClick={() => {
							if (locked) {
								setLocked(false);
								setLockedAspectRatio(null);
								return;
							}
							const box = boxRef.current?.getBoundingClientRect();
							if (!box) return;
							setLockedAspectRatio(cropDisplayAspectRatio(crop, box));
							setLocked(true);
						}}
					>
						{locked ? "锁定比例" : "自由比例"}
					</Button>
				</div>
				<div className="flex justify-end gap-2">
					<Button
						onClick={() => {
							setCrop(defaultCrop);
							setLocked(false);
							setLockedAspectRatio(null);
						}}
					>
						重置
					</Button>
					<Button icon={<X className="size-4" />} onClick={onClose}>
						取消
					</Button>
					<Button
						icon={<Check className="size-4" />}
						type="primary"
						onClick={() => onConfirm(crop)}
					>
						确认裁剪
					</Button>
				</div>
			</div>
		</Modal>
	);
}

function MaskDialog({
	dataUrl,
	onClose,
	onConfirm,
}: {
	dataUrl: string;
	onClose: () => void;
	onConfirm: (payload: RetouchMaskEditPayload) => void;
}) {
	const image = useImageDimensions(dataUrl);
	const maskCanvasRef = useRef<HTMLCanvasElement>(null);
	const previewCanvasRef = useRef<HTMLCanvasElement>(null);
	const drawingRef = useRef<{ active: boolean; last: CanvasPoint | null }>({
		active: false,
		last: null,
	});
	const [prompt, setPrompt] = useState("");
	const [brushSize, setBrushSize] = useState(100);
	const [mode, setMode] = useState<"erase" | "paint">("paint");
	const [error, setError] = useState("");

	const draw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		const mask = maskCanvasRef.current;
		const context = mask?.getContext("2d");
		if (!mask || !context) return;
		const point = canvasPoint(mask, event.clientX, event.clientY);
		context.globalCompositeOperation =
			mode === "paint" ? "source-over" : "destination-out";
		context.fillStyle = "#000";
		context.lineCap = "round";
		context.lineJoin = "round";
		context.lineWidth = brushSize;
		context.strokeStyle = "#000";
		drawMaskStroke(context, drawingRef.current.last ?? point, point, brushSize);
		renderMaskPreview(mask, previewCanvasRef.current);
		drawingRef.current.last = point;
		if (mode === "paint") setError("");
	};

	const startDraw = (event: ReactPointerEvent<HTMLCanvasElement>) => {
		event.preventDefault();
		event.currentTarget.setPointerCapture(event.pointerId);
		drawingRef.current = { active: true, last: null };
		draw(event);
	};

	const stopDraw = () => {
		drawingRef.current = { active: false, last: null };
		const mask = maskCanvasRef.current;
		if (mask) renderMaskPreview(mask, previewCanvasRef.current);
	};

	const submit = () => {
		const mask = maskCanvasRef.current;
		const nextPrompt = prompt.trim();
		if (!nextPrompt) {
			setError("请输入修改要求");
			return;
		}
		if (!mask || !canvasHasPaint(mask)) {
			setError("请先涂抹局部区域");
			return;
		}
		onConfirm({ maskDataUrl: buildEditMask(mask), prompt: nextPrompt });
	};

	return (
		<Modal
			centered
			destroyOnHidden
			footer={null}
			open
			title="局部遮罩编辑"
			width={980}
			onCancel={onClose}
		>
			<div className="grid gap-5 lg:grid-cols-[minmax(360px,1fr)_320px]">
				<div className="flex min-h-[360px] items-center justify-center rounded-xl border p-0">
					<div className="relative inline-block max-w-full select-none overflow-hidden rounded-lg">
						{/* biome-ignore lint/performance/noImgElement: private OwnedAsset data URL preview. */}
						<img
							alt=""
							className="block max-h-[68vh] max-w-full"
							draggable={false}
							src={dataUrl}
						/>
						{image ? (
							<>
								<canvas
									className="hidden"
									height={image.height}
									ref={maskCanvasRef}
									width={image.width}
								/>
								<canvas
									className="absolute inset-0 h-full w-full cursor-crosshair touch-none"
									height={image.height}
									ref={previewCanvasRef}
									width={image.width}
									onPointerCancel={stopDraw}
									onPointerDown={startDraw}
									onPointerMove={(event) => {
										if (drawingRef.current.active) draw(event);
									}}
									onPointerUp={stopDraw}
								/>
							</>
						) : null}
					</div>
				</div>
				<div className="flex min-h-[360px] flex-col gap-5">
					<div>
						<h2 className="text-xl font-semibold">局部遮罩编辑</h2>
						<div className="mt-2 text-sm opacity-60">
							{image ? `${image.width} × ${image.height}px` : "读取中"}
						</div>
					</div>
					<div className="grid grid-cols-2 gap-2">
						<Button
							icon={<Brush className="size-4" />}
							type={mode === "paint" ? "primary" : "default"}
							onClick={() => setMode("paint")}
						>
							画笔
						</Button>
						<Button
							icon={<Eraser className="size-4" />}
							type={mode === "erase" ? "primary" : "default"}
							onClick={() => setMode("erase")}
						>
							擦除
						</Button>
					</div>
					<div className="space-y-2">
						<div className="flex justify-between text-sm">
							<span>笔刷大小</span>
							<span>{brushSize}px</span>
						</div>
						<Slider
							max={160}
							min={8}
							step={2}
							value={brushSize}
							onChange={setBrushSize}
						/>
					</div>
					<div className="space-y-2">
						<div className="text-sm">修改要求</div>
						<Input.TextArea
							placeholder="例如：把选中区域改成金属材质，保持原图光影"
							rows={6}
							status={error && !prompt.trim() ? "error" : undefined}
							value={prompt}
							onChange={(event) => {
								setPrompt(event.target.value);
								setError("");
							}}
						/>
						{error ? <div className="text-xs text-red-500">{error}</div> : null}
					</div>
					<div className="mt-auto flex justify-between gap-2">
						<Button
							icon={<RotateCcw className="size-4" />}
							onClick={() => {
								clearCanvas(maskCanvasRef.current);
								clearCanvas(previewCanvasRef.current);
								setError("");
							}}
						>
							重置
						</Button>
						<div className="flex gap-2">
							<Button icon={<X className="size-4" />} onClick={onClose}>
								取消
							</Button>
							<Button
								icon={<WandSparkles className="size-4" />}
								type="primary"
								onClick={submit}
							>
								AI 修改
							</Button>
						</div>
					</div>
				</div>
			</div>
		</Modal>
	);
}

function UpscaleDialog({
	dataUrl,
	onClose,
	onConfirm,
}: {
	dataUrl: string;
	onClose: () => void;
	onConfirm: (params: RetouchUpscaleParams) => void;
}) {
	const image = useImageDimensions(dataUrl);
	const [params, setParams] = useState<RetouchUpscaleParams>(defaultUpscale);
	const sourceLongEdge = image ? Math.max(image.width, image.height) : 0;
	const canUpscale = Boolean(image && sourceLongEdge < params.targetLongEdge);

	return (
		<Modal
			centered
			destroyOnHidden
			footer={null}
			open
			title="图片放大"
			width={780}
			onCancel={onClose}
		>
			<div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_320px]">
				<div className="rounded-xl border p-4">
					<div className="grid min-h-[280px] place-items-center rounded-lg bg-black/5">
						{/* biome-ignore lint/performance/noImgElement: private OwnedAsset data URL preview. */}
						<img
							alt=""
							className="max-h-[320px] max-w-full rounded-lg object-contain"
							draggable={false}
							src={dataUrl}
						/>
					</div>
					<div className="mt-3 text-sm">
						原图 {image ? `${image.width} × ${image.height}px` : "读取中"}
					</div>
				</div>
				<div className="space-y-6 py-2">
					<div className="space-y-2">
						<div>目标像素</div>
						<Segmented
							block
							options={upscaleTargets.map((target) => ({
								disabled: Boolean(image && sourceLongEdge >= target.value),
								label: target.label,
								value: target.value,
							}))}
							value={params.targetLongEdge}
							onChange={(value) =>
								setParams((current) => ({
									...current,
									targetLongEdge: Number(value),
								}))
							}
						/>
					</div>
					<div className="space-y-2">
						<div>放大算法</div>
						<Segmented
							block
							options={upscaleAlgorithms}
							value={params.algorithm}
							onChange={(value) =>
								setParams((current) => ({
									...current,
									algorithm: value as RetouchUpscaleParams["algorithm"],
								}))
							}
						/>
					</div>
					{image ? (
						<div className="rounded-xl border px-4 py-3 text-sm">
							输出尺寸 {scaledSize(image, params.targetLongEdge).width} ×{" "}
							{scaledSize(image, params.targetLongEdge).height}px
						</div>
					) : null}
					<Button
						disabled={!canUpscale}
						icon={<ImagePlus className="size-4" />}
						size="large"
						type="primary"
						onClick={() => onConfirm(params)}
					>
						生成放大图
					</Button>
				</div>
			</div>
		</Modal>
	);
}

function SplitDialog({
	dataUrl,
	onClose,
	onConfirm,
}: {
	dataUrl: string;
	onClose: () => void;
	onConfirm: (params: RetouchSplitParams) => void;
}) {
	const image = useImageDimensions(dataUrl);
	const [params, setParams] = useState<RetouchSplitParams>(defaultSplit);

	const update = (key: keyof RetouchSplitParams, value: number | null) => {
		setParams((current) => ({ ...current, [key]: clampGrid(value) }));
	};

	return (
		<Modal
			centered
			destroyOnHidden
			footer={null}
			open
			title="切分图片"
			width={780}
			onCancel={onClose}
		>
			<div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_280px]">
				<div className="rounded-xl border p-4">
					<div className="relative inline-block max-w-full overflow-hidden rounded-lg bg-black">
						{/* biome-ignore lint/performance/noImgElement: private OwnedAsset data URL preview. */}
						<img
							alt=""
							className="block max-h-[340px] max-w-full"
							draggable={false}
							src={dataUrl}
						/>
						<SplitGrid {...params} />
					</div>
					<div className="mt-3 text-sm">
						{image ? `原图 ${image.width} × ${image.height}px` : "读取中"}
					</div>
				</div>
				<div className="space-y-5 py-2">
					<NumberField
						label="行数"
						value={params.rows}
						onChange={(value) => update("rows", value)}
					/>
					<NumberField
						label="列数"
						value={params.columns}
						onChange={(value) => update("columns", value)}
					/>
					<div className="rounded-xl border px-4 py-3 text-sm">
						子节点 {params.rows * params.columns} 个
					</div>
					<Button
						className="w-full"
						icon={<Grid2x2 className="size-4" />}
						size="large"
						type="primary"
						onClick={() => onConfirm(params)}
					>
						生成子节点
					</Button>
				</div>
			</div>
		</Modal>
	);
}

function AngleDialog({
	dataUrl,
	onClose,
	onConfirm,
}: {
	dataUrl: string;
	onClose: () => void;
	onConfirm: (params: RetouchAngleDialogParams) => void;
}) {
	const [params, setParams] = useState<RetouchAngleDialogParams>(defaultAngle);

	const update = <Key extends keyof RetouchAngleDialogParams>(
		key: Key,
		value: RetouchAngleDialogParams[Key],
	) => setParams((current) => ({ ...current, [key]: value }));

	return (
		<Modal
			centered
			destroyOnHidden
			footer={null}
			open
			title="AI 多角度"
			width={860}
			onCancel={onClose}
		>
			<div className="grid gap-6 md:grid-cols-[minmax(260px,1fr)_360px]">
				<div className="flex min-h-[300px] flex-col justify-between rounded-xl border p-4">
					<div className="grid flex-1 place-items-center">
						{/* biome-ignore lint/performance/noImgElement: private OwnedAsset data URL preview. */}
						<img
							alt=""
							className="size-48 rounded-2xl object-cover shadow-2xl"
							draggable={false}
							src={dataUrl}
							style={{ transform: anglePreviewTransform(params) }}
						/>
					</div>
					<Button
						className="w-fit"
						icon={<RotateCcw className="size-4" />}
						onClick={() => setParams(defaultAngle)}
					>
						重置
					</Button>
				</div>
				<div className="space-y-6 py-2">
					<AngleSlider
						label="左右角度"
						max={60}
						min={-60}
						step={1}
						suffix="°"
						value={params.horizontalAngle}
						onChange={(value) => update("horizontalAngle", value)}
					/>
					<AngleSlider
						label="俯仰角度"
						max={45}
						min={-45}
						step={1}
						suffix="°"
						value={params.pitchAngle}
						onChange={(value) => update("pitchAngle", value)}
					/>
					<AngleSlider
						label="镜头距离"
						max={10}
						min={1}
						step={0.1}
						value={params.cameraDistance}
						onChange={(value) => update("cameraDistance", value)}
					/>
					<div className="grid grid-cols-[88px_1fr] items-center gap-4">
						<span>广角镜头</span>
						<Segmented
							options={[
								{ label: "标准", value: "standard" },
								{ label: "广角", value: "wide" },
							]}
							value={params.wideAngle ? "wide" : "standard"}
							onChange={(value) => update("wideAngle", value === "wide")}
						/>
					</div>
					<Button
						icon={<WandSparkles className="size-4" />}
						size="large"
						type="primary"
						onClick={() => onConfirm(params)}
					>
						AI 生成
					</Button>
				</div>
			</div>
		</Modal>
	);
}

export type RetouchQuoteRequest = {
	kind: RetouchGenerationKind;
	label: string;
	priceRevision: string;
};

export function RetouchQuoteDialog({
	busy = false,
	onClose,
	onConfirm,
	request,
}: {
	busy?: boolean;
	onClose: () => void;
	onConfirm: () => void;
	request: RetouchQuoteRequest | null;
}) {
	if (!request) return null;
	return (
		<Modal
			centered
			closable={!busy}
			footer={null}
			keyboard={!busy}
			maskClosable={!busy}
			open
			title={`${request.label}报价确认`}
			onCancel={onClose}
		>
			<div className="space-y-4" data-retouch-quote-kind={request.kind}>
				<p>
					报价已固定。确认后将提交一个可恢复的生成任务；完成后可在生成记录中插入为新子节点。
				</p>
				<p className="text-sm opacity-65">计费版本：{request.priceRevision}</p>
				<div className="flex justify-end gap-2">
					<Button disabled={busy} onClick={onClose}>
						取消
					</Button>
					<Button loading={busy} type="primary" onClick={onConfirm}>
						确认提交
					</Button>
				</div>
			</div>
		</Modal>
	);
}

type CanvasPoint = { x: number; y: number };

const cropHandles: RetouchCropHandle[] = [
	"nw",
	"n",
	"ne",
	"e",
	"se",
	"s",
	"sw",
	"w",
];
const defaultCrop: RetouchCropRect = {
	height: 0.76,
	width: 0.76,
	x: 0.12,
	y: 0.12,
};
const defaultUpscale: RetouchUpscaleParams = {
	algorithm: "high",
	targetLongEdge: 2048,
};
const defaultSplit: RetouchSplitParams = { columns: 2, rows: 2 };
const defaultAngle: RetouchAngleDialogParams = {
	cameraDistance: 4.8,
	horizontalAngle: 0,
	pitchAngle: 9,
	wideAngle: false,
};
const upscaleTargets = [
	{ label: "1K · 1024px", value: 1024 },
	{ label: "2K · 2048px", value: 2048 },
	{ label: "4K · 4096px", value: 4096 },
];
const upscaleAlgorithms = [
	{ label: "高清插值", value: "high" },
	{ label: "双线性", value: "bilinear" },
	{ label: "最近邻", value: "nearest" },
];

function useImageDimensions(dataUrl: string) {
	const [dimensions, setDimensions] = useState<{
		height: number;
		width: number;
	} | null>(null);

	useEffect(() => {
		let active = true;
		setDimensions(null);
		const image = new Image();
		const settle = () => {
			if (!active) return;
			setDimensions({
				height: image.naturalHeight || 1024,
				width: image.naturalWidth || 1024,
			});
		};
		image.onerror = settle;
		image.onload = settle;
		image.src = dataUrl;
		return () => {
			active = false;
		};
	}, [dataUrl]);

	return dimensions;
}

function CropMask({ crop }: { crop: RetouchCropRect }) {
	return (
		<>
			<div
				className="absolute inset-x-0 top-0 bg-black/55"
				style={{ height: `${crop.y * 100}%` }}
			/>
			<div
				className="absolute inset-x-0 bottom-0 bg-black/55"
				style={{ height: `${(1 - crop.y - crop.height) * 100}%` }}
			/>
			<div
				className="absolute bg-black/55"
				style={{
					height: `${crop.height * 100}%`,
					left: 0,
					top: `${crop.y * 100}%`,
					width: `${crop.x * 100}%`,
				}}
			/>
			<div
				className="absolute bg-black/55"
				style={{
					height: `${crop.height * 100}%`,
					right: 0,
					top: `${crop.y * 100}%`,
					width: `${(1 - crop.x - crop.width) * 100}%`,
				}}
			/>
		</>
	);
}

function NumberField({
	label,
	onChange,
	value,
}: {
	label: string;
	onChange: (value: number | null) => void;
	value: number;
}) {
	return (
		<div className="block space-y-2">
			<span>{label}</span>
			<InputNumber
				className="w-full"
				max={12}
				min={1}
				precision={0}
				value={value}
				onChange={onChange}
			/>
		</div>
	);
}

function SplitGrid({ columns, rows }: RetouchSplitParams) {
	return (
		<div className="pointer-events-none absolute inset-0">
			{Array.from({ length: columns - 1 }, (_, index) => index + 1).map(
				(position) => (
					<div
						className="absolute inset-y-0 border-l border-white/90"
						key={`column-${position}`}
						style={{ left: `${(position / columns) * 100}%` }}
					/>
				),
			)}
			{Array.from({ length: rows - 1 }, (_, index) => index + 1).map(
				(position) => (
					<div
						className="absolute inset-x-0 border-t border-white/90"
						key={`row-${position}`}
						style={{ top: `${(position / rows) * 100}%` }}
					/>
				),
			)}
		</div>
	);
}

function AngleSlider({
	label,
	max,
	min,
	onChange,
	step,
	suffix = "",
	value,
}: {
	label: string;
	max: number;
	min: number;
	onChange: (value: number) => void;
	step: number;
	suffix?: string;
	value: number;
}) {
	return (
		<div className="grid grid-cols-[88px_1fr_72px] items-center gap-4">
			<span>{label}</span>
			<Slider
				max={max}
				min={min}
				step={step}
				value={value}
				onChange={onChange}
			/>
			<span className="text-right">
				{Number.isInteger(value) ? value : value.toFixed(1)}
				{suffix}
			</span>
		</div>
	);
}

function cropStyle(crop: RetouchCropRect) {
	return {
		height: `${crop.height * 100}%`,
		left: `${crop.x * 100}%`,
		top: `${crop.y * 100}%`,
		width: `${crop.width * 100}%`,
	};
}

function cropHandleStyle(handle: RetouchCropHandle) {
	return {
		cursor: `${handle}-resize`,
		left: handle.includes("w")
			? "-6px"
			: handle.includes("e")
				? "calc(100% - 6px)"
				: "calc(50% - 6px)",
		top: handle.includes("n")
			? "-6px"
			: handle.includes("s")
				? "calc(100% - 6px)"
				: "calc(50% - 6px)",
	};
}

function canvasPoint(
	canvas: HTMLCanvasElement,
	clientX: number,
	clientY: number,
): CanvasPoint {
	const rect = canvas.getBoundingClientRect();
	return {
		x: ((clientX - rect.left) / Math.max(1, rect.width)) * canvas.width,
		y: ((clientY - rect.top) / Math.max(1, rect.height)) * canvas.height,
	};
}

function clearCanvas(canvas: HTMLCanvasElement | null) {
	const context = canvas?.getContext("2d");
	if (!canvas || !context) return;
	context.clearRect(0, 0, canvas.width, canvas.height);
}

function drawMaskStroke(
	context: CanvasRenderingContext2D,
	from: CanvasPoint,
	to: CanvasPoint,
	size: number,
) {
	if (from.x === to.x && from.y === to.y) {
		context.beginPath();
		context.arc(to.x, to.y, size / 2, 0, Math.PI * 2);
		context.fill();
		return;
	}
	context.beginPath();
	context.moveTo(from.x, from.y);
	context.lineTo(to.x, to.y);
	context.stroke();
}

function renderMaskPreview(
	mask: HTMLCanvasElement,
	preview: HTMLCanvasElement | null,
) {
	const context = preview?.getContext("2d");
	if (!preview || !context) return;
	context.clearRect(0, 0, preview.width, preview.height);
	context.fillStyle = "rgba(37, 99, 235, .38)";
	context.fillRect(0, 0, preview.width, preview.height);
	context.globalCompositeOperation = "destination-in";
	context.drawImage(mask, 0, 0);
	context.globalCompositeOperation = "source-over";
}

function canvasHasPaint(canvas: HTMLCanvasElement) {
	const context = canvas.getContext("2d");
	if (!context) return false;
	const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
	for (let index = 3; index < data.length; index += 4) {
		if (data[index] > 0) return true;
	}
	return false;
}

function buildEditMask(selection: HTMLCanvasElement) {
	const canvas = document.createElement("canvas");
	canvas.height = selection.height;
	canvas.width = selection.width;
	const context = canvas.getContext("2d");
	const selectionContext = selection.getContext("2d");
	if (!context || !selectionContext) return selection.toDataURL("image/png");
	context.fillStyle = "#fff";
	context.fillRect(0, 0, canvas.width, canvas.height);
	const source = selectionContext.getImageData(
		0,
		0,
		canvas.width,
		canvas.height,
	);
	const target = context.getImageData(0, 0, canvas.width, canvas.height);
	for (let index = 3; index < target.data.length; index += 4) {
		if (source.data[index] > 0) target.data[index] = 0;
	}
	context.putImageData(target, 0, 0);
	return canvas.toDataURL("image/png");
}

function scaledSize(
	image: { height: number; width: number },
	targetLongEdge: number,
) {
	const scale = targetLongEdge / Math.max(image.width, image.height);
	return {
		height: Math.max(1, Math.round(image.height * scale)),
		width: Math.max(1, Math.round(image.width * scale)),
	};
}

function clampGrid(value: number | null) {
	const numeric = Number(value);
	return Math.min(
		12,
		Math.max(1, Math.round(Number.isFinite(numeric) ? numeric : 1)),
	);
}

function anglePreviewTransform(params: RetouchAngleDialogParams) {
	const scale =
		1.08 - params.cameraDistance * 0.035 + (params.wideAngle ? -0.08 : 0);
	return `perspective(520px) rotateY(${params.horizontalAngle * -0.45}deg) rotateX(${params.pitchAngle * 0.35}deg) scale(${clamp(scale, 0.72, 1.08)})`;
}

function clamp(value: number, min: number, max: number) {
	return Math.min(max, Math.max(min, value));
}
