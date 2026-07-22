"use client";

import {
	cropDataUrl,
	type ImageCropRect,
	type ImageSplitParams,
	type ImageSplitPiece,
	type ImageUpscaleParams,
	MAX_UPSCALE_LONG_EDGE,
	splitDataUrl,
	upscaleDataUrl,
} from "../vendor/vozeb/app/(user)/canvas/utils/canvas-image-data.js";
import type { KernelEdge, KernelNode } from "./graph-bridge";
import {
	buildImageNodeFromAsset,
	deliveryUrl,
	fileToBase64,
	persistBlobAsOwnedAsset,
} from "./media-adapter";
import type { CanvasCaller } from "./project-persistence";

type Cropper = (dataUrl: string, crop?: ImageCropRect) => Promise<string>;
type Upscaler = (
	dataUrl: string,
	params: ImageUpscaleParams,
) => Promise<string>;
type Splitter = (
	dataUrl: string,
	params: ImageSplitParams,
) => Promise<ImageSplitPiece[]>;

type SourceImageNode = Pick<
	KernelNode,
	"data" | "height" | "id" | "type" | "width" | "x" | "y"
>;

const MAX_SPLIT_AXIS = 12;
const DEFAULT_UPSCALE: ImageUpscaleParams = {
	algorithm: "high",
	targetLongEdge: 2048,
};
const DEFAULT_SPLIT: ImageSplitParams = { columns: 2, rows: 2 };

export function normalizeUpscaleParams(
	params?: Partial<ImageUpscaleParams>,
): ImageUpscaleParams {
	const algorithm =
		params?.algorithm === "nearest" ||
		params?.algorithm === "bilinear" ||
		params?.algorithm === "high"
			? params.algorithm
			: DEFAULT_UPSCALE.algorithm;
	const rawTarget = Number(params?.targetLongEdge);
	const targetLongEdge = Number.isFinite(rawTarget)
		? Math.min(MAX_UPSCALE_LONG_EDGE, Math.max(1, Math.round(rawTarget)))
		: DEFAULT_UPSCALE.targetLongEdge;
	return { algorithm, targetLongEdge };
}

export function normalizeSplitParams(
	params?: Partial<ImageSplitParams>,
): ImageSplitParams {
	return {
		columns: clampSplitAxis(params?.columns ?? DEFAULT_SPLIT.columns),
		rows: clampSplitAxis(params?.rows ?? DEFAULT_SPLIT.rows),
	};
}

/** Pure grid math for split child layout (no DOM). */
export function layoutSplitChildren(
	source: Pick<SourceImageNode, "height" | "width" | "x" | "y">,
	params: ImageSplitParams,
): Array<{
	column: number;
	height: number;
	row: number;
	width: number;
	x: number;
	y: number;
}> {
	const { columns, rows } = normalizeSplitParams(params);
	const gap = 16;
	const childWidth = Math.max(48, Math.floor(source.width / columns));
	const childHeight = Math.max(48, Math.floor(source.height / rows));
	const originX = source.x + source.width + 48;
	const originY = source.y;
	const pieces: Array<{
		column: number;
		height: number;
		row: number;
		width: number;
		x: number;
		y: number;
	}> = [];
	for (let row = 0; row < rows; row += 1) {
		for (let column = 0; column < columns; column += 1) {
			pieces.push({
				column,
				height: childHeight,
				row,
				width: childWidth,
				x: originX + column * (childWidth + gap),
				y: originY + row * (childHeight + gap),
			});
		}
	}
	return pieces;
}

export async function cropOwnedImageAsset(
	callCanvas: CanvasCaller,
	input: {
		crop?: ImageCropRect;
		cropper?: Cropper;
		fetcher?: typeof fetch;
		nextEdgeId?: () => string;
		nextNodeId?: () => string;
		sourceNode: SourceImageNode;
	},
) {
	const source = await readSourceImage(input);
	const croppedDataUrl = await (input.cropper ?? cropDataUrl)(
		source.dataUrl,
		input.crop,
	);
	const cropped = parseImageDataUrl(croppedDataUrl);
	const asset = await persistBlobAsOwnedAsset(callCanvas, {
		bytesBase64: cropped.bytesBase64,
		contentType: cropped.contentType,
		derivation: "crop",
		fileName: `${safeFileStem(source.assetId)}-crop.${extensionFor(cropped.contentType)}`,
		parentAssetId: source.assetId,
	});
	if (!asset.id?.trim()) throw new Error("DERIVED_ASSET_REQUIRED");

	const node = buildImageNodeFromAsset(asset.id, {
		height: input.sourceNode.height,
		id: input.nextNodeId?.() ?? `image-${crypto.randomUUID()}`,
		width: input.sourceNode.width,
		x: input.sourceNode.x + input.sourceNode.width + 48,
		y: input.sourceNode.y,
	});
	const edge: KernelEdge = {
		id: input.nextEdgeId?.() ?? `edge-${input.sourceNode.id}-${node.id}-crop`,
		source: input.sourceNode.id,
		target: node.id,
		type: "derive",
	};
	return { asset, edge, node };
}

export async function upscaleOwnedImageAsset(
	callCanvas: CanvasCaller,
	input: {
		fetcher?: typeof fetch;
		nextEdgeId?: () => string;
		nextNodeId?: () => string;
		params?: Partial<ImageUpscaleParams>;
		sourceNode: SourceImageNode;
		upscaler?: Upscaler;
	},
) {
	const params = normalizeUpscaleParams(input.params);
	const source = await readSourceImage(input);
	const upscaledDataUrl = await (input.upscaler ?? upscaleDataUrl)(
		source.dataUrl,
		params,
	);
	const upscaled = parseImageDataUrl(upscaledDataUrl);
	const asset = await persistBlobAsOwnedAsset(callCanvas, {
		bytesBase64: upscaled.bytesBase64,
		contentType: upscaled.contentType,
		derivation: "upscale",
		fileName: `${safeFileStem(source.assetId)}-upscale-${params.targetLongEdge}.${extensionFor(upscaled.contentType)}`,
		parentAssetId: source.assetId,
	});
	if (!asset.id?.trim()) throw new Error("DERIVED_ASSET_REQUIRED");

	// Keep canvas card size; pixels live on the OwnedAsset, not the node chrome.
	const node = buildImageNodeFromAsset(asset.id, {
		height: input.sourceNode.height,
		id: input.nextNodeId?.() ?? `image-${crypto.randomUUID()}`,
		width: input.sourceNode.width,
		x: input.sourceNode.x + input.sourceNode.width + 48,
		y: input.sourceNode.y,
	});
	const edge: KernelEdge = {
		id:
			input.nextEdgeId?.() ?? `edge-${input.sourceNode.id}-${node.id}-upscale`,
		source: input.sourceNode.id,
		target: node.id,
		type: "derive",
	};
	return { asset, edge, node, params };
}

export async function splitOwnedImageAsset(
	callCanvas: CanvasCaller,
	input: {
		fetcher?: typeof fetch;
		nextEdgeId?: (index: number) => string;
		nextNodeId?: (index: number) => string;
		params?: Partial<ImageSplitParams>;
		sourceNode: SourceImageNode;
		splitter?: Splitter;
	},
) {
	const params = normalizeSplitParams(input.params);
	if (params.rows * params.columns < 2) {
		throw new Error("SPLIT_REQUIRES_MULTIPLE_PIECES");
	}
	const source = await readSourceImage(input);
	const pieces = await (input.splitter ?? splitDataUrl)(source.dataUrl, params);
	if (pieces.length === 0) throw new Error("SPLIT_PRODUCED_NO_PIECES");

	const layouts = layoutSplitChildren(input.sourceNode, params);
	const results: Array<{
		asset: Awaited<ReturnType<typeof persistBlobAsOwnedAsset>>;
		edge: KernelEdge;
		node: ReturnType<typeof buildImageNodeFromAsset>;
		piece: { column: number; row: number };
	}> = [];

	for (const [index, piece] of pieces.entries()) {
		const parsed = parseImageDataUrl(piece.dataUrl);
		const asset = await persistBlobAsOwnedAsset(callCanvas, {
			bytesBase64: parsed.bytesBase64,
			contentType: parsed.contentType,
			derivation: "split",
			fileName: `${safeFileStem(source.assetId)}-split-r${piece.row}-c${piece.column}.${extensionFor(parsed.contentType)}`,
			parentAssetId: source.assetId,
		});
		if (!asset.id?.trim()) throw new Error("DERIVED_ASSET_REQUIRED");

		const layout = layouts[index] ?? {
			column: piece.column,
			height: input.sourceNode.height,
			row: piece.row,
			width: input.sourceNode.width,
			x: input.sourceNode.x + input.sourceNode.width + 48 + index * 32,
			y: input.sourceNode.y,
		};
		const node = buildImageNodeFromAsset(asset.id, {
			height: layout.height,
			id: input.nextNodeId?.(index) ?? `image-${crypto.randomUUID()}`,
			width: layout.width,
			x: layout.x,
			y: layout.y,
		});
		const edge: KernelEdge = {
			id:
				input.nextEdgeId?.(index) ??
				`edge-${input.sourceNode.id}-${node.id}-split`,
			source: input.sourceNode.id,
			target: node.id,
			type: "derive",
		};
		results.push({
			asset,
			edge,
			node,
			piece: { column: piece.column, row: piece.row },
		});
	}

	return { params, pieces: results };
}

async function readSourceImage(input: {
	fetcher?: typeof fetch;
	sourceNode: SourceImageNode;
}) {
	const sourceAssetId =
		typeof input.sourceNode.data.assetId === "string"
			? input.sourceNode.data.assetId.trim()
			: "";
	if (!sourceAssetId) throw new Error("SOURCE_ASSET_REQUIRED");
	if (input.sourceNode.type !== "image" || !input.sourceNode.id.trim()) {
		throw new Error("SOURCE_IMAGE_NODE_REQUIRED");
	}

	const response = await (input.fetcher ?? fetch)(deliveryUrl(sourceAssetId), {
		cache: "no-store",
		credentials: "same-origin",
	});
	if (!response.ok) throw new Error("SOURCE_ASSET_DELIVERY_FAILED");
	const sourceBlob = await response.blob();
	const sourceContentType = imageContentType(
		response.headers.get("content-type") ?? sourceBlob.type,
	);
	const dataUrl = `data:${sourceContentType};base64,${await fileToBase64(sourceBlob)}`;
	return { assetId: sourceAssetId, dataUrl };
}

function clampSplitAxis(value: number) {
	const n = Math.round(Number(value));
	if (!Number.isFinite(n)) return 1;
	return Math.min(MAX_SPLIT_AXIS, Math.max(1, n));
}

function imageContentType(value: string) {
	const contentType = value.split(";", 1)[0]?.trim().toLowerCase();
	if (
		contentType !== "image/jpeg" &&
		contentType !== "image/png" &&
		contentType !== "image/webp"
	) {
		throw new Error("SOURCE_IMAGE_CONTENT_TYPE_REQUIRED");
	}
	return contentType;
}

function parseImageDataUrl(dataUrl: string) {
	const match =
		/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+={0,2})$/u.exec(
			dataUrl,
		);
	if (!match?.[1] || !match[2]) {
		throw new Error("DERIVED_IMAGE_DATA_URL_INVALID");
	}
	return {
		bytesBase64: match[2],
		contentType: imageContentType(match[1]),
	};
}

function extensionFor(contentType: string) {
	return contentType === "image/jpeg"
		? "jpg"
		: contentType === "image/webp"
			? "webp"
			: "png";
}

function safeFileStem(assetId: string) {
	return assetId.replace(/[^A-Za-z0-9._-]+/gu, "-").slice(0, 120) || "asset";
}
