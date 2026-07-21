import type { CanvasCaller } from "./project-persistence";

export type ArtifactDerivation =
	| "crop"
	| "mask"
	| "retouch"
	| "split"
	| "upscale";

export type PersistedCanvasAsset = {
	contentType: string;
	id: string;
	name?: string;
};

/** Delivery URL pattern for OwnedAsset playback/download via BackendPort. */
export function deliveryUrl(
	assetId: string,
	options: { download?: boolean } = {},
): string {
	return `/api/canvas/getAssetDelivery?assetId=${encodeURIComponent(assetId)}${options.download ? "&download=1" : ""}`;
}

export async function fileToBase64(file: Blob): Promise<string> {
	const buffer = await file.arrayBuffer();
	const bytes = new Uint8Array(buffer);
	let binary = "";
	for (let index = 0; index < bytes.length; index += 0x8000) {
		binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
	}
	return btoa(binary);
}

export async function persistBlobAsOwnedAsset(
	callCanvas: CanvasCaller,
	input: {
		bytesBase64: string;
		contentType: string;
		derivation?: ArtifactDerivation;
		fileName: string;
		legacyStorageKey?: string;
		parentAssetId?: string;
	},
): Promise<PersistedCanvasAsset> {
	return callCanvas("persistLocalCanvasArtifact", {
		bytesBase64: input.bytesBase64,
		contentType: input.contentType,
		derivation: input.derivation ?? "retouch",
		fileName: input.fileName,
		...(input.legacyStorageKey
			? { legacyStorageKey: input.legacyStorageKey }
			: {}),
		...(input.parentAssetId ? { parentAssetId: input.parentAssetId } : {}),
	});
}

export function buildImageNodeFromAsset(
	assetId: string,
	options: {
		height?: number;
		id?: string;
		width?: number;
		x?: number;
		y?: number;
	} = {},
) {
	const width = options.width ?? 200;
	const height = options.height ?? 160;
	const x = options.x ?? 80;
	const y = options.y ?? 80;
	return {
		data: {
			assetId,
			height,
			width,
			x,
			y,
		},
		height,
		id: options.id ?? `image-${crypto.randomUUID()}`,
		type: "image" as const,
		width,
		x,
		y,
	};
}
