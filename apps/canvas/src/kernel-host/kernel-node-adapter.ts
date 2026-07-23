import { NODE_DEFAULT_SIZE } from "@/src/vendor/vozeb/app/(user)/canvas/constants";
import {
	type CanvasNodeData,
	type CanvasNodeStatus,
	CanvasNodeType,
} from "@/src/vendor/vozeb/app/(user)/canvas/types";
import type { KernelNode } from "./graph-bridge";

export function createKernelNode(
	typeValue: string,
	position: { x: number; y: number },
	id: string,
): KernelNode {
	const type = canvasNodeType(typeValue);
	const size = NODE_DEFAULT_SIZE[type];
	return {
		data: type === CanvasNodeType.Text ? { text: "" } : {},
		height: size.height,
		id,
		type,
		width: size.width,
		x: position.x,
		y: position.y,
	};
}

const TYPE_LABELS: Record<CanvasNodeType, string> = {
	[CanvasNodeType.Audio]: "音频",
	[CanvasNodeType.Config]: "生成配置",
	[CanvasNodeType.Image]: "图片",
	[CanvasNodeType.Text]: "文字",
	[CanvasNodeType.Video]: "视频",
};

function canvasNodeType(value: string): CanvasNodeType {
	return Object.values(CanvasNodeType).includes(value as CanvasNodeType)
		? (value as CanvasNodeType)
		: CanvasNodeType.Text;
}

function canvasNodeStatus(value: unknown): CanvasNodeStatus {
	if (value === "completed" || value === "succeeded" || value === "success") {
		return "success";
	}
	if (value === "failed" || value === "error") return "error";
	if (value === "pending" || value === "running" || value === "loading") {
		return "loading";
	}
	return "idle";
}

function finite(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? value
		: undefined;
}

export function toVozebNode(
	node: KernelNode,
	ownedAssetUrl: (assetId: string) => string,
): CanvasNodeData {
	const type = canvasNodeType(node.type);
	const defaults = NODE_DEFAULT_SIZE[type];
	const assetId =
		typeof node.data.assetId === "string" ? node.data.assetId : undefined;
	const durableText =
		typeof node.data.text === "string"
			? node.data.text
			: typeof node.data.prompt === "string"
				? node.data.prompt
				: "";
	const streamPreview =
		typeof node.data.streamPreview === "string" ? node.data.streamPreview : "";
	const text = durableText || streamPreview;
	return {
		height: node.height > 0 ? node.height : defaults.height,
		id: node.id,
		metadata: {
			...(assetId ? { content: ownedAssetUrl(assetId) } : { content: text }),
			...(finite(node.data.bytes) !== undefined
				? { bytes: finite(node.data.bytes) }
				: {}),
			...(finite(node.data.fontSize) !== undefined
				? { fontSize: finite(node.data.fontSize) }
				: {}),
			...(typeof node.data.freeResize === "boolean"
				? { freeResize: node.data.freeResize }
				: {}),
			...(typeof node.data.mimeType === "string"
				? { mimeType: node.data.mimeType }
				: {}),
			...(finite(node.data.naturalHeight) !== undefined
				? { naturalHeight: finite(node.data.naturalHeight) }
				: {}),
			...(finite(node.data.naturalWidth) !== undefined
				? { naturalWidth: finite(node.data.naturalWidth) }
				: {}),
			...(typeof node.data.prompt === "string"
				? { prompt: node.data.prompt }
				: {}),
			status: canvasNodeStatus(node.data.status),
			...(canvasNodeStatus(node.data.status) === "error"
				? { errorDetails: "生成失败，请重试" }
				: {}),
		},
		position: { x: node.x, y: node.y },
		title: TYPE_LABELS[type],
		type,
		width: node.width > 0 ? node.width : defaults.width,
	};
}
