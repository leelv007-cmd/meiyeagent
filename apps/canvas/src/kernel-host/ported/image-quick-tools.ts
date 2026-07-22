/**
 * Merchant-safe image hover toolbar customization (G25 + K3 pure retouch).
 * Catalog only includes tools the host can honor without multi-channel live:
 * crop / upscale / split are browser pure transforms + OwnedAsset lineage.
 * maskEdit / angle / reversePrompt stay out until GenerationJob paths land.
 */

export type ImageQuickToolId =
	| "info"
	| "delete"
	| "download"
	| "resize"
	| "crop"
	| "upscale"
	| "split"
	| "view";

export type ImageQuickToolsConfig = {
	ids: ImageQuickToolId[];
	showLabels: boolean;
};

/** Stable key shared with upstream shape so later exact-mount can reuse prefs. */
export const IMAGE_QUICK_TOOLS_STORAGE_KEY = "canvas-image-quick-tools-v6";

/** Full catalog of tools the host can actually run today. */
export const IMAGE_QUICK_TOOL_CATALOG: readonly ImageQuickToolId[] = [
	"info",
	"delete",
	"download",
	"resize",
	"crop",
	"upscale",
	"split",
	"view",
] as const;

export const defaultImageQuickToolIds: ImageQuickToolId[] = [
	"info",
	"delete",
	"download",
	"resize",
	"crop",
	"upscale",
	"split",
	"view",
];

const CATALOG_SET = new Set<string>(IMAGE_QUICK_TOOL_CATALOG);

export function normalizeImageQuickToolIds(value: unknown): ImageQuickToolId[] {
	if (!Array.isArray(value)) return [...defaultImageQuickToolIds];
	const selected = new Set(
		value.filter(
			(id): id is ImageQuickToolId =>
				typeof id === "string" && CATALOG_SET.has(id),
		),
	);
	// Preserve catalog order; drop unknown / K3-only ids silently.
	return IMAGE_QUICK_TOOL_CATALOG.filter((id) => selected.has(id));
}

export function readImageQuickToolsConfig(
	value: unknown,
): ImageQuickToolsConfig {
	if (Array.isArray(value)) {
		return { ids: normalizeImageQuickToolIds(value), showLabels: true };
	}
	if (!value || typeof value !== "object") {
		return { ids: [...defaultImageQuickToolIds], showLabels: true };
	}
	const data = value as Partial<ImageQuickToolsConfig>;
	const ids = Array.isArray(data.ids)
		? normalizeImageQuickToolIds(data.ids)
		: [...defaultImageQuickToolIds];
	// Empty selection is invalid — fall back to defaults so toolbar never vanishes.
	return {
		ids: ids.length > 0 ? ids : [...defaultImageQuickToolIds],
		showLabels: data.showLabels !== false,
	};
}

export function parseImageQuickToolsStorage(
	raw: string | null | undefined,
): ImageQuickToolsConfig {
	if (!raw) return { ids: [...defaultImageQuickToolIds], showLabels: true };
	try {
		return readImageQuickToolsConfig(JSON.parse(raw) as unknown);
	} catch {
		return { ids: [...defaultImageQuickToolIds], showLabels: true };
	}
}

export function serializeImageQuickToolsConfig(
	config: ImageQuickToolsConfig,
): string {
	const normalized = readImageQuickToolsConfig(config);
	return JSON.stringify(normalized);
}
