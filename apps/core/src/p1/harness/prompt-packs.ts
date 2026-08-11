/**
 * Prompt Pack definitions + selective freeze + release-time strict validation
 * (V31-20 / V3.1 §29.2–29.3 / A14).
 *
 * Single registry remains in langfuse-prompts.ts. Packs select subsets by task.
 * Strict completeness is enforced at HarnessRelease publish (this module), not
 * at process boot. Boot only checks that the current production release — when
 * one is provided — is resolvable. isFallback still surfaces for pilot paths
 * and remains an audit-pipeline signal (task-admission already persists it).
 *
 * D-165: skillRevision / promptVersion / catalogRevision stay flat top-level
 * axes. Pack membership must never nest those axes.
 */

import {
	PLATFORM_BEAUTY_COPYWRITING_SKILL_ID,
	PLATFORM_CAPTURE_STORE_WORKFLOW_SKILL_ID,
} from '../skills/platform-provisioning.js';
import {
	HARNESS_PROMPT_SITES,
	type HarnessFrozenPrompt,
	type HarnessPromptKey,
} from './langfuse-prompts.js';

/** Matches contracts promptRevisionRefSchema (key + exact version). */
export type PromptRevisionRef = {
	key: string;
	version: string;
};

/**
 * Pack membership locked to V3.1 §29.2. Keys are registry prompt keys
 * (HarnessPromptKey), not Langfuse names.
 */
export const HARNESS_PROMPT_PACKS = {
	agentControl: [
		'intentNaming',
		'factSatisfaction',
		'factCriticality',
		'destinationMapping',
	],
	copy: [
		'briefCompilation',
		'copyCandidate',
		'copyGeneration',
		'platformAdaptation',
	],
	note: [
		'xhsOutline',
		'xhsContent',
		'xhsImagePrompt',
		'notePlan',
		'noteTextBlock',
		'noteConsistency',
		'xhsNoteGen',
	],
	media: ['briefImage'],
	cover: ['xhsCoverPrompt', 'xhsStyleAnalysis'],
	viral: ['xhsViralRewrite', 'xhsViralImageVision'],
	video: ['briefVideo', 'textResponse'],
} as const satisfies Record<string, readonly HarnessPromptKey[]>;

export type HarnessPromptPackId = keyof typeof HARNESS_PROMPT_PACKS;

export const HARNESS_PROMPT_PACK_IDS = Object.keys(
	HARNESS_PROMPT_PACKS,
) as HarnessPromptPackId[];

/** Stable default pack set for a pure copy task (no viral / cover media). */
export const COPY_TASK_PROMPT_PACK_IDS = [
	'agentControl',
	'copy',
] as const satisfies readonly HarnessPromptPackId[];

export type HarnessPromptKeySet = ReadonlySet<HarnessPromptKey>;

export type SelectiveFrozenPrompts = Partial<
	Record<HarnessPromptKey, HarnessFrozenPrompt>
>;

export type ReleasePromptPublishFailure = {
	code:
		| 'unknown_pack'
		| 'unknown_prompt_key'
		| 'missing_prompt_binding'
		| 'invalid_prompt_binding'
		| 'builtin_or_fallback_version'
		| 'registry_key_uncovered';
	key?: string;
	packId?: string;
	message: string;
};

export type ReleasePromptPublishValidation =
	| { ok: true; requiredKeys: readonly HarnessPromptKey[] }
	| { ok: false; failures: readonly ReleasePromptPublishFailure[] };

/**
 * Constructive coverage: every registry key belongs to ≥1 pack.
 * Throws with the uncovered keys when the pack table drifts from the registry.
 */
export function assertHarnessPromptPackCoverage(): void {
	const failures = collectUncoveredRegistryKeys();
	if (failures.length > 0) {
		throw new Error(
			`Prompt pack coverage incomplete; uncovered registry keys: ${failures.join(', ')}.`,
		);
	}
}

export function collectUncoveredRegistryKeys(): HarnessPromptKey[] {
	const covered = new Set<string>();
	for (const keys of Object.values(HARNESS_PROMPT_PACKS)) {
		for (const key of keys) covered.add(key);
	}
	return (Object.keys(HARNESS_PROMPT_SITES) as HarnessPromptKey[]).filter(
		(key) => !covered.has(key),
	);
}

/** Keys claimed by one or more packs (deduped, stable registry order). */
export function promptKeysForPacks(
	packIds: readonly HarnessPromptPackId[],
): HarnessPromptKey[] {
	const selected = new Set<HarnessPromptKey>();
	for (const packId of packIds) {
		const keys = HARNESS_PROMPT_PACKS[packId];
		if (!keys) {
			throw new Error(`Unknown prompt pack: ${String(packId)}.`);
		}
		for (const key of keys) selected.add(key);
	}
	return (Object.keys(HARNESS_PROMPT_SITES) as HarnessPromptKey[]).filter(
		(key) => selected.has(key),
	);
}

export function promptKeysForAllPacks(): HarnessPromptKey[] {
	return promptKeysForPacks(HARNESS_PROMPT_PACK_IDS);
}

/**
 * Default pack binding map frozen into a full release artifact
 * (identity map of packId → its key list).
 */
export function defaultPromptPackBindings(): Record<
	HarnessPromptPackId,
	HarnessPromptKey[]
> {
	return Object.fromEntries(
		HARNESS_PROMPT_PACK_IDS.map((packId) => [
			packId,
			[...HARNESS_PROMPT_PACKS[packId]],
		]),
	) as Record<HarnessPromptPackId, HarnessPromptKey[]>;
}

/**
 * Release-time strict validation (V3.1 §29.3).
 *
 * - Pack definitions must cover the full registry (constructive).
 * - Every key in the release's referenced packs must have an exact
 *   non-builtin promptBindings pin.
 * - Missing pin → fail closed and name the key (no silent builtin green).
 *
 * Publish flow (persist / lifecycle) is V31-21; this is the pure gate.
 */
export function validateReleasePromptPublish(input: {
	promptPackBindings: Record<string, readonly string[]>;
	promptBindings: Record<string, PromptRevisionRef>;
	/**
	 * When true (default), require the canonical pack table to cover all
	 * registry keys so a partial pack map cannot ship a hole.
	 */
	requireFullRegistryCoverage?: boolean;
}): ReleasePromptPublishValidation {
	const failures: ReleasePromptPublishFailure[] = [];
	const requireFullRegistryCoverage = input.requireFullRegistryCoverage !== false;

	if (Object.keys(input.promptPackBindings).length === 0) {
		failures.push({
			code: 'unknown_pack',
			message: 'Production release must declare at least one prompt pack.',
		});
	}

	if (requireFullRegistryCoverage) {
		for (const key of collectUncoveredRegistryKeys()) {
			failures.push({
				code: 'registry_key_uncovered',
				key,
				message: `Registry prompt key is not covered by any prompt pack: ${key}.`,
			});
		}
	}

	const requiredKeys = new Set<HarnessPromptKey>();
	for (const [packId, declaredKeys] of Object.entries(input.promptPackBindings)) {
		const canonical = HARNESS_PROMPT_PACKS[packId as HarnessPromptPackId];
		if (!canonical) {
			failures.push({
				code: 'unknown_pack',
				packId,
				message: `Unknown prompt pack in promptPackBindings: ${packId}.`,
			});
			continue;
		}
		const canonicalSet = new Set<string>(canonical);
		for (const key of declaredKeys) {
			if (!(key in HARNESS_PROMPT_SITES)) {
				failures.push({
					code: 'unknown_prompt_key',
					key,
					packId,
					message: `Prompt pack ${packId} references unknown registry key: ${key}.`,
				});
				continue;
			}
			if (!canonicalSet.has(key)) {
				failures.push({
					code: 'unknown_prompt_key',
					key,
					packId,
					message: `Prompt key ${key} is not a member of pack ${packId}.`,
				});
				continue;
			}
			requiredKeys.add(key as HarnessPromptKey);
		}
		// Canonical members must all be present even if the release binding list is short.
		for (const key of canonical) {
			requiredKeys.add(key);
		}
	}

	const orderedRequired = (
		Object.keys(HARNESS_PROMPT_SITES) as HarnessPromptKey[]
	).filter((key) => requiredKeys.has(key));

	for (const key of orderedRequired) {
		const binding = input.promptBindings[key];
		if (!binding) {
			failures.push({
				code: 'missing_prompt_binding',
				key,
				message: `Release promptBindings is missing pinned prompt: ${key}.`,
			});
			continue;
		}
		if (binding.key !== key) {
			failures.push({
				code: 'invalid_prompt_binding',
				key,
				message: `Release promptBindings.${key}.key must equal "${key}" (got "${binding.key}").`,
			});
		}
		const version = binding.version?.trim() ?? '';
		if (!version) {
			failures.push({
				code: 'invalid_prompt_binding',
				key,
				message: `Release promptBindings.${key}.version must be a non-empty exact version.`,
			});
			continue;
		}
		if (isBuiltinOrFallbackVersion(version)) {
			failures.push({
				code: 'builtin_or_fallback_version',
				key,
				message: `Release promptBindings.${key} must not use builtin/fallback version "${version}".`,
			});
		}
	}

	if (failures.length > 0) {
		return { ok: false, failures };
	}
	return { ok: true, requiredKeys: orderedRequired };
}

/**
 * Registered platform skills. The release skillBindings must constructively
 * cover this set, or the release ships a skill hole the runtime cannot
 * reproduce (V31-38 authority line).
 */
export const REGISTERED_PLATFORM_SKILL_IDS = [
	PLATFORM_BEAUTY_COPYWRITING_SKILL_ID,
	PLATFORM_CAPTURE_STORE_WORKFLOW_SKILL_ID,
] as const;

export type ReleaseSkillPublishFailure = {
	code:
		| 'missing_skill_binding'
		| 'invalid_skill_ref'
		| 'mismatched_skill_binding'
		| 'synthetic_skill_revision';
	skillId?: string;
	message: string;
};

export type ReleaseSkillPublishValidation =
	| { ok: true; requiredSkillIds: readonly string[] }
	| { ok: false; failures: readonly ReleaseSkillPublishFailure[] };

/**
 * Release-time strict validation for skillBindings (V31-38).
 *
 * Constructive coverage: every registered platform skill must be bound with at
 * least one manifest ref — a release with an unbound platform skill ships a
 * plan-compile receipt the release cannot reproduce.
 *
 * Exact refs only: each ref must round-trip through the runtime
 * `skillId@revision` split (task-admission `splitSkillRevisionRef`), the
 * binding key must equal the ref's skillId (no impersonation), and the
 * revision must be a concrete numeric revision issued by the skill domain —
 * synthetic markers (`@plan_compile`, `latest`, `head`) fail closed.
 */
export function validateReleaseSkillPublish(input: {
	skillBindings: Record<string, readonly { skillId: string; revision: string }[]>;
	requiredSkillIds?: readonly string[];
}): ReleaseSkillPublishValidation {
	const requiredSkillIds = input.requiredSkillIds ?? REGISTERED_PLATFORM_SKILL_IDS;
	const failures: ReleaseSkillPublishFailure[] = [];

	for (const skillId of requiredSkillIds) {
		const refs = input.skillBindings[skillId];
		if (!refs || refs.length === 0) {
			failures.push({
				code: 'missing_skill_binding',
				skillId,
				message: `Release skillBindings is missing a binding for registered platform skill: ${skillId}.`,
			});
		}
	}

	for (const [bindingKey, refs] of Object.entries(input.skillBindings)) {
		for (const ref of refs) {
			const skillId = ref?.skillId?.trim() ?? '';
			const revision = ref?.revision?.trim() ?? '';
			if (!skillId || skillId.includes('@')) {
				failures.push({
					code: 'invalid_skill_ref',
					skillId: bindingKey,
					message: `Release skillBindings.${bindingKey} carries an invalid skill id (${JSON.stringify(skillId)}).`,
				});
				continue;
			}
			if (bindingKey !== skillId) {
				failures.push({
					code: 'mismatched_skill_binding',
					skillId: bindingKey,
					message: `Release skillBindings.${bindingKey} references skill ${skillId}; the binding key must equal the skill id.`,
				});
			}
			if (!/^\d+$/u.test(revision)) {
				failures.push({
					code: 'synthetic_skill_revision',
					skillId,
					message: `Release skillBindings.${bindingKey} must pin a concrete numeric skill revision, got ${JSON.stringify(revision)}.`,
				});
				continue;
			}
			if (!/^[a-z][a-z0-9.-]*$/u.test(skillId)) {
				failures.push({
					code: 'invalid_skill_ref',
					skillId,
					message: `Release skillBindings.${bindingKey} skill id ${skillId} is not a stable skillId shape.`,
				});
			}
		}
	}

	if (failures.length > 0) {
		return { ok: false, failures };
	}
	return { ok: true, requiredSkillIds };
}

/**
 * Boot-time check (V3.1 §29.3): only the current production release must be
 * resolvable. No production release yet (pre-V31-21 wiring) → no-op success.
 * Full registry pin completeness is intentionally not required at boot.
 */
export function assertProductionReleasePromptResolvable(input: {
	productionRelease:
		| {
				promptPackBindings: Record<string, readonly string[]>;
				promptBindings: Record<string, PromptRevisionRef>;
		  }
		| null
		| undefined;
}): void {
	if (!input.productionRelease) return;
	const result = validateReleasePromptPublish(input.productionRelease);
	if (result.ok) return;
	const detail = result.failures.map((failure) => failure.message).join('; ');
	throw new Error(
		`Current production release prompt bindings are not resolvable: ${detail}`,
	);
}

/**
 * Project selective frozen prompts to flat D-165 promptVersion axis values
 * (`name@version`). Never nests under pack ids.
 */
export function flatPromptVersionAxes(
	prompts: SelectiveFrozenPrompts | Record<string, HarnessFrozenPrompt>,
): Record<string, string> {
	const axes: Record<string, string> = {};
	for (const [key, prompt] of Object.entries(prompts)) {
		if (!prompt) continue;
		axes[key] = `${prompt.name}@${prompt.version}`;
	}
	return axes;
}

/**
 * Fallback audit payloads for selective freeze. Downstream audit ports
 * (task-admission recordPromptFallbackAudits) consume the same shape.
 */
export function collectPromptFallbackAuditSignals(
	prompts: SelectiveFrozenPrompts | Record<string, HarnessFrozenPrompt>,
): Array<{
	promptKey: string;
	name: string;
	version: string;
	contentHash: string;
	isFallback: true;
	fallbackReason: string;
}> {
	const signals: Array<{
		promptKey: string;
		name: string;
		version: string;
		contentHash: string;
		isFallback: true;
		fallbackReason: string;
	}> = [];
	for (const [promptKey, prompt] of Object.entries(prompts)) {
		if (!prompt?.isFallback) continue;
		signals.push({
			promptKey,
			name: prompt.name,
			version: prompt.version,
			contentHash: prompt.contentHash,
			isFallback: true,
			fallbackReason: prompt.fallbackReason ?? 'unknown',
		});
	}
	return signals;
}

export function isHarnessPromptPackId(value: string): value is HarnessPromptPackId {
	return value in HARNESS_PROMPT_PACKS;
}

export function isHarnessPromptKey(value: string): value is HarnessPromptKey {
	return value in HARNESS_PROMPT_SITES;
}

function isBuiltinOrFallbackVersion(version: string): boolean {
	const normalized = version.trim().toLowerCase();
	return (
		normalized === 'builtin-v1' ||
		normalized.startsWith('builtin') ||
		normalized.includes('fallback')
	);
}
