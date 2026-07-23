import type { CanvasPromptSeed } from "../shared/prompt-seeds";

/**
 * Pure selection action for Ticket 16: choosing a seed only fills the local
 * generation form. No remote inventory / CRUD side effects.
 */
export function applyCanvasPromptSeed(seed: CanvasPromptSeed): {
	operation: CanvasPromptSeed["operation"];
	prompt: string;
	seedId: string;
} {
	return {
		operation: seed.operation,
		prompt: seed.prompt,
		seedId: seed.id,
	};
}
