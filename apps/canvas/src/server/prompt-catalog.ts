import type { CanvasGenerationOperation } from "@meiye/core/pro-studio-runtime";
import {
	CANVAS_PROMPT_SEEDS,
	type CanvasPromptSeed,
} from "../shared/prompt-seeds";

export interface CanvasPromptCatalogItem {
	category: string;
	id: string;
	prompt: string;
	title: string;
}

/**
 * Production source for the governed `listPrompts` catalog. The client resource
 * workflow reads this catalog through the Canvas facade (never the local seed
 * corpus), so the server maps every product-owned seed into a merchant-safe
 * list item here.
 */
export function listCanvasPromptSeeds(): CanvasPromptCatalogItem[] {
	return CANVAS_PROMPT_SEEDS.map((seed) => ({
		category: promptSeedCategory(seed.operation),
		id: seed.id,
		prompt: seed.prompt,
		title: promptSeedTitle(seed),
	}));
}

/**
 * Maps a seed's creative capability to the category vocabulary the resource
 * workflow already understands, so a prompt stays insertable only while its
 * capability is active. Kept operation-general (not locked to image.generate)
 * so future non-image seeds join the same catalog.
 */
function promptSeedCategory(operation: CanvasGenerationOperation): string {
	switch (operation) {
		case "audio.sfx":
			return "音效";
		case "audio.speech":
			return "语音";
		case "image.edit":
			return "修图";
		case "image.generate":
			return "视觉";
		case "text.respond":
			return "文案";
		case "video.generate":
			return "视频";
	}
}

/** Derives a human-readable, merchant-facing title from the seed prompt. */
function promptSeedTitle(seed: CanvasPromptSeed): string {
	const head = seed.prompt.split(/[，。]/u)[0]?.trim() ?? "";
	return head.length > 0 ? head : seed.group;
}
