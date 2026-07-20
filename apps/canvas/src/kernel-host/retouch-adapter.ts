"use client";

import {
	cropDataUrl,
	type ImageCropRect,
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

export async function cropOwnedImageAsset(
	callCanvas: CanvasCaller,
	input: {
		crop?: ImageCropRect;
		cropper?: Cropper;
		fetcher?: typeof fetch;
		nextEdgeId?: () => string;
		nextNodeId?: () => string;
		sourceNode: Pick<
			KernelNode,
			"data" | "height" | "id" | "type" | "width" | "x" | "y"
		>;
	},
) {
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
	const sourceDataUrl = `data:${sourceContentType};base64,${await fileToBase64(sourceBlob)}`;
	const croppedDataUrl = await (input.cropper ?? cropDataUrl)(
		sourceDataUrl,
		input.crop,
	);
	const cropped = parseImageDataUrl(croppedDataUrl);
	const asset = await persistBlobAsOwnedAsset(callCanvas, {
		bytesBase64: cropped.bytesBase64,
		contentType: cropped.contentType,
		derivation: "crop",
		fileName: `${safeFileStem(sourceAssetId)}-crop.${extensionFor(cropped.contentType)}`,
		parentAssetId: sourceAssetId,
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
		throw new Error("CROPPED_IMAGE_DATA_URL_INVALID");
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
