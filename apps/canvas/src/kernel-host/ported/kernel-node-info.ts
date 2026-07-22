/**
 * Desensitized node info projection (G24).
 * Never surfaces raw ids, asset keys, delivery URLs, or binary payloads.
 */

export type NodeInfoRow = {
	label: string;
	value: string;
};

export type DesensitizedNodeInfo = {
	/** Merchant-facing key/value rows for the info tab. */
	rows: NodeInfoRow[];
	/** JSON tab payload — already redacted. */
	json: string;
};

export type NodeInfoInput = {
	bytes?: number;
	errorDetails?: string;
	freeResize?: boolean;
	height: number;
	prompt?: string;
	status?: string;
	type: string;
	width: number;
	x: number;
	y: number;
};

const TYPE_LABELS: Record<string, string> = {
	audio: "音频",
	config: "生成配置",
	image: "图片",
	text: "文本",
	video: "视频",
};

const STATUS_LABELS: Record<string, string> = {
	error: "失败",
	idle: "待命",
	loading: "生成中",
	success: "成功",
};

/** Keys that must never appear in merchant-facing JSON. */
export const NODE_INFO_REDACT_KEYS = new Set([
	"assetId",
	"content",
	"id",
	"jobId",
	"remoteUrl",
	"seedId",
	"serverUrl",
	"storageKey",
	"title",
	"workspaceId",
]);

export function nodeTypeLabel(type: string): string {
	return TYPE_LABELS[type] ?? "节点";
}

export function nodeStatusLabel(status: string | undefined): string {
	if (!status) return STATUS_LABELS.idle;
	return STATUS_LABELS[status] ?? status;
}

export function formatByteSize(bytes: number | undefined): string | null {
	if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes <= 0) {
		return null;
	}
	const units = ["B", "KB", "MB", "GB"] as const;
	let value = bytes;
	let unitIndex = 0;
	while (value >= 1024 && unitIndex < units.length - 1) {
		value /= 1024;
		unitIndex += 1;
	}
	const rounded =
		value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1);
	return `${rounded} ${units[unitIndex]}`;
}

export function buildDesensitizedNodeInfo(
	input: NodeInfoInput,
): DesensitizedNodeInfo {
	const rows: NodeInfoRow[] = [
		{ label: "类型", value: nodeTypeLabel(input.type) },
		{
			label: "尺寸",
			value: `${Math.round(input.width)} × ${Math.round(input.height)}`,
		},
		{
			label: "位置",
			value: `${Math.round(input.x)}, ${Math.round(input.y)}`,
		},
		{ label: "状态", value: nodeStatusLabel(input.status) },
	];

	if (input.type === "image") {
		rows.push({
			label: "比例",
			value: input.freeResize ? "自由比例" : "锁定比例",
		});
	}

	const prompt = input.prompt?.trim();
	if (prompt) {
		rows.push({ label: "提示词", value: prompt });
	}

	const sizeLabel = formatByteSize(input.bytes);
	if (sizeLabel) {
		rows.push({ label: "文件大小", value: sizeLabel });
	}

	if (input.errorDetails?.trim()) {
		rows.push({ label: "错误", value: input.errorDetails.trim() });
	}

	const jsonPayload = {
		type: input.type,
		width: Math.round(input.width),
		height: Math.round(input.height),
		position: {
			x: Math.round(input.x),
			y: Math.round(input.y),
		},
		status: input.status ?? "idle",
		...(input.type === "image"
			? { freeResize: Boolean(input.freeResize) }
			: {}),
		...(prompt ? { prompt } : {}),
		...(sizeLabel ? { bytes: input.bytes } : {}),
		...(input.errorDetails?.trim()
			? { errorDetails: input.errorDetails.trim() }
			: {}),
	};

	return {
		json: JSON.stringify(jsonPayload, null, 2),
		rows,
	};
}

/**
 * Redact an arbitrary node-like object for the JSON tab.
 * Drops sensitive keys and replaces embedded data URLs / long base64.
 */
export function desensitizeNodeJson(value: unknown): string {
	return JSON.stringify(
		value,
		(key, current) => {
			// Drop identity / storage handles entirely — no placeholder that could leak shape.
			if (
				key === "assetId" ||
				key === "id" ||
				key === "jobId" ||
				key === "seedId" ||
				key === "title" ||
				key === "workspaceId"
			) {
				return undefined;
			}
			if (
				key === "content" ||
				key === "remoteUrl" ||
				key === "serverUrl" ||
				key === "storageKey"
			) {
				return typeof current === "string" && current.length > 0
					? "[redacted]"
					: undefined;
			}
			if (typeof current === "string") {
				if (current.startsWith("data:")) return "[redacted media]";
				if (current.length > 240 && /^[A-Za-z0-9+/=]+$/u.test(current)) {
					return "[redacted payload]";
				}
				if (
					/\/api\/canvas\/getAssetDelivery/u.test(current) ||
					/[?&]assetId=/u.test(current)
				) {
					return "[redacted delivery]";
				}
			}
			return current;
		},
		2,
	);
}
