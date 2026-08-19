import {
	CREDIT_PLAN_CONFIG_DEFAULTS,
	CREDIT_PLAN_CONFIG_KEYS,
	commercePlanCatalogSnapshotSchema,
} from "@meiye/contracts";
import {
	CREDIT_PLAN_IDS,
	type CreditAddOnOffer,
	type CreditPlanCatalog,
	type CreditPlanCycleCoefficientBasisPoints,
	type CreditPlanOffer,
	type CreditPlanReferenceNumbers,
	toPublicCreditPlanCatalog,
} from "../credit-billing/credit-plan-catalog.js";
import {
	creditAddOnsSchema,
	creditPlanCycleCoefficientBasisPointsSchema,
	creditPlanReferenceNumbersSchema,
	creditPlanSchema,
	trialCreditPlanSchema,
	type AdminConfigRepository,
} from "./foundation-module.js";

const GLOBAL_WORKSPACE_ID = "__global__";

export interface CreditPlanConfigRepository {
	get(
		scope: "global",
		workspaceId: string,
		key: string,
	): Promise<{ revision?: number; value: unknown } | null>;
}

/**
 * Production boot may only prove that the currently published catalog is
 * usable. Creating, upgrading, and migrating revisions are explicit admin
 * operations so a restart can never change a commercial catalog.
 */
export async function assertPublishedCreditPlanCatalogAtStartup(
	catalog: Pick<AdminConfigCreditPlanCatalogSource, "get">,
) {
	await catalog.get();
}

const COMMERCE_PLAN_CONFIG_KEYS = [
	"plan.credits.trial",
	"plan.credits.starter",
	"plan.credits.growth",
	"plan.credits.pro",
	"plan.credits.addons",
	"plan.credits.cycle_coefficients",
	"plan.credits.reference_numbers",
	"plan.credits.trial.enabled",
] as const;

const CREDIT_PLAN_SEED_ACTOR_ID = "system:credit-plan-catalog-seed";
const CREDIT_PLAN_UPGRADE_ACTOR_ID = "system:credit-plan-catalog-upgrade";

const LEGACY_CREDIT_PLAN_KEYS = [
	"plan.credits.trial",
	"plan.credits.starter",
	"plan.credits.growth",
	"plan.credits.pro",
] as const;
type LegacyCreditPlanConfigKey = (typeof LEGACY_CREDIT_PLAN_KEYS)[number];

export const CREDIT_PLAN_CATALOG_CURRENCY_MIGRATION_KEYS = [
	...LEGACY_CREDIT_PLAN_KEYS,
	"plan.credits.addons",
] as const;
export type CreditPlanCatalogCurrencyMigrationKey =
	(typeof CREDIT_PLAN_CATALOG_CURRENCY_MIGRATION_KEYS)[number];

export interface CreditPlanCatalogCurrencyMigrationPreview {
	expectedRevision: number | null;
	key: CreditPlanCatalogCurrencyMigrationKey;
	proposedValue?: unknown;
	reason?: string;
	status: "blocked" | "ready" | "up_to_date";
}

export interface ApplyCreditPlanCatalogCurrencyMigrationInput {
	actorId: string;
	correlationId: string;
	expectedRevision: number;
	key: CreditPlanCatalogCurrencyMigrationKey;
}

export interface RollbackCreditPlanCatalogCurrencyMigrationInput
	extends ApplyCreditPlanCatalogCurrencyMigrationInput {
	targetRevision: number;
}

/**
 * Explicit provisioning helper for an empty installation or the exact #298
 * legacy shape. Production assembly must never call it: a restart validates
 * existing revisions rather than creating or upgrading them.
 */
export async function ensureCreditPlanCatalogDefaults(
	repository: Pick<AdminConfigRepository, "apply" | "get">,
) {
	for (const key of CREDIT_PLAN_CONFIG_KEYS) {
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const existing = await repository.get("global", GLOBAL_WORKSPACE_ID, key);
			const upgraded = existing
				? upgradeLegacyCreditPlanConfig(key, existing.value)
				: null;
			if (existing && !upgraded) break;
			try {
				await repository.apply({
					actorId: upgraded
						? CREDIT_PLAN_UPGRADE_ACTOR_ID
						: CREDIT_PLAN_SEED_ACTOR_ID,
					correlationId: upgraded
						? `bootstrap:upgrade:${key}`
						: `bootstrap:${key}`,
					expectedRevision: existing?.revision ?? null,
					key,
						reason: upgraded
							? "Add required HKD pricing fields to the legacy governed credit plan."
						: "Initialize the governed credit plan catalog.",
					scope: "global",
					value: structuredClone(upgraded ?? CREDIT_PLAN_CONFIG_DEFAULTS[key]),
					workspaceId: GLOBAL_WORKSPACE_ID,
				});
				break;
			} catch (error) {
				if (attempt === 1) throw error;
			}
		}
	}
}

function upgradeLegacyCreditPlanConfig(key: string, value: unknown) {
	if (!isLegacyCreditPlanConfigKey(key)) return null;
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const legacy = value as Record<string, unknown>;
	if (
		Object.keys(legacy).length !== 5 ||
		!Object.hasOwn(legacy, "credits") ||
		!Object.hasOwn(legacy, "storageMb") ||
		!Object.hasOwn(legacy, "concurrencyLimit") ||
		!Object.hasOwn(legacy, "queuePriority") ||
		!Object.hasOwn(legacy, "supportLabel") ||
		!positiveInteger(legacy.credits) ||
		!positiveInteger(legacy.storageMb) ||
		!positiveInteger(legacy.concurrencyLimit) ||
		!positiveInteger(legacy.queuePriority) ||
		(legacy.supportLabel !== "standard" && legacy.supportLabel !== "priority")
	) {
		return null;
	}
	const defaults = CREDIT_PLAN_CONFIG_DEFAULTS[key];
	return {
		...legacy,
		currency: defaults.currency,
		monthlyPriceMicros: defaults.monthlyPriceMicros,
	};
}

function isLegacyCreditPlanConfigKey(
	key: string,
): key is LegacyCreditPlanConfigKey {
	return LEGACY_CREDIT_PLAN_KEYS.some((candidate) => candidate === key);
}

/**
 * Reads every commercial price revision and reports exactly what an operator
 * would change. This is deliberately read-only: applying a preview requires a
 * separately supplied revision precondition.
 */
export async function previewCreditPlanCatalogCurrencyToHkdMigration(
	repository: Pick<AdminConfigRepository, "get">,
): Promise<CreditPlanCatalogCurrencyMigrationPreview[]> {
	const preview: CreditPlanCatalogCurrencyMigrationPreview[] = [];
	for (const key of CREDIT_PLAN_CATALOG_CURRENCY_MIGRATION_KEYS) {
		const current = await repository.get("global", GLOBAL_WORKSPACE_ID, key);
		if (!current) {
			preview.push({
				expectedRevision: null,
				key,
				reason: "No published revision exists for this governed catalog key.",
				status: "blocked",
			});
			continue;
		}
		const proposedValue = migrationValueForKey(key, current.value);
		if (proposedValue) {
			preview.push({
				expectedRevision: current.revision ?? null,
				key,
				proposedValue,
				status: "ready",
			});
			continue;
		}
		preview.push({
			expectedRevision: current.revision ?? null,
			key,
			reason: isPublishedHkdValue(key, current.value)
				? undefined
				: "The published value is not a recognized legacy CNY migration input.",
			status: isPublishedHkdValue(key, current.value)
				? "up_to_date"
				: "blocked",
		});
	}
	return preview;
}

/**
 * Append one reviewed HKD revision. The caller must submit the revision shown
 * by dry-run; the repository repeats the same CAS at write time to protect the
 * gap between preview and apply.
 */
export async function applyCreditPlanCatalogCurrencyToHkdMigration(
	repository: Pick<AdminConfigRepository, "apply" | "get">,
	input: ApplyCreditPlanCatalogCurrencyMigrationInput,
) {
	const current = await repository.get(
		"global",
		GLOBAL_WORKSPACE_ID,
		input.key,
	);
	if (!current) {
		throw new Error(`No published revision exists for ${input.key}.`);
	}
	if (current.revision !== input.expectedRevision) {
		throw new Error(
			`Expected revision ${input.expectedRevision} for ${input.key}, found ${current.revision}. Run dry-run again before applying.`,
		);
	}
	const value = migrationValueForKey(input.key, current.value);
	if (!value) {
		throw new Error(
			`Published revision ${current.revision} for ${input.key} is not an eligible legacy CNY migration input.`,
		);
	}
	return repository.apply({
		actorId: input.actorId,
		correlationId: input.correlationId,
		expectedRevision: input.expectedRevision,
		key: input.key,
		reason:
			"Explicitly migrate the reviewed published credit plan currency from CNY to governed HKD pricing.",
		scope: "global",
		value,
		workspaceId: GLOBAL_WORKSPACE_ID,
	});
}

/**
 * Compensation is append-only. A rollback can only restore a recognized CNY
 * source revision, and it carries the current-head CAS so it cannot erase an
 * operator change made after migration.
 */
export async function rollbackCreditPlanCatalogCurrencyToHkdMigration(
	repository: Pick<AdminConfigRepository, "get" | "history" | "rollback">,
	input: RollbackCreditPlanCatalogCurrencyMigrationInput,
) {
	const current = await repository.get(
		"global",
		GLOBAL_WORKSPACE_ID,
		input.key,
	);
	if (!current) {
		throw new Error(`No published revision exists for ${input.key}.`);
	}
	if (current.revision !== input.expectedRevision) {
		throw new Error(
			`Expected revision ${input.expectedRevision} for ${input.key}, found ${current.revision}. Run dry-run again before rolling back.`,
		);
	}
	if (!isPublishedHkdValue(input.key, current.value)) {
		throw new Error(
			`Published revision ${current.revision} for ${input.key} is not an HKD catalog revision that can be compensated by this command.`,
		);
	}
	const target = (await repository.history(
		"global",
		GLOBAL_WORKSPACE_ID,
		input.key,
	)).find((revision) => revision.revision === input.targetRevision);
	if (!target) {
		throw new Error(
			`Historical revision ${input.targetRevision} for ${input.key} was not found.`,
		);
	}
	if (!migrationValueForKey(input.key, target.value)) {
		throw new Error(
			`Historical revision ${input.targetRevision} for ${input.key} is not an eligible legacy CNY rollback target.`,
		);
	}
	return repository.rollback({
		actorId: input.actorId,
		correlationId: input.correlationId,
		expectedRevision: input.expectedRevision,
		key: input.key,
		reason:
			"Explicitly roll back a reviewed HKD catalog migration to its recorded legacy CNY revision.",
		scope: "global",
		targetRevision: input.targetRevision,
		workspaceId: GLOBAL_WORKSPACE_ID,
	});
}

function migrationValueForKey(
	key: CreditPlanCatalogCurrencyMigrationKey,
	value: unknown,
) {
	return key === "plan.credits.addons"
		? migrateLegacyAddOnCurrencyToHkd(value)
		: migrateLegacyPlanCurrencyToHkd(key, value);
}

function isPublishedHkdValue(
	key: CreditPlanCatalogCurrencyMigrationKey,
	value: unknown,
) {
	return (
		key === "plan.credits.addons"
			? creditAddOnsSchema
			: key === "plan.credits.trial"
				? trialCreditPlanSchema
				: creditPlanSchema
	).safeParse(value).success;
}

function migrateLegacyPlanCurrencyToHkd(
	key: LegacyCreditPlanConfigKey,
	value: unknown,
) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const plan = value as Record<string, unknown>;
	if (plan.currency === "HKD") return null;
	if (plan.currency !== "CNY") return null;
	if (
		!positiveInteger(plan.credits) ||
		!(key === "plan.credits.trial"
			? nonnegativeInteger(plan.monthlyPriceMicros)
			: typeof plan.monthlyPriceMicros === "number" &&
				Number.isSafeInteger(plan.monthlyPriceMicros) &&
				plan.monthlyPriceMicros >= 0) ||
		!positiveInteger(plan.storageMb) ||
		!positiveInteger(plan.concurrencyLimit) ||
		!positiveInteger(plan.queuePriority) ||
		(plan.supportLabel !== "standard" && plan.supportLabel !== "priority")
	) {
		return null;
	}
	const defaults = CREDIT_PLAN_CONFIG_DEFAULTS[key];
	return {
		...plan,
		currency: defaults.currency,
		monthlyPriceMicros: defaults.monthlyPriceMicros,
	};
}

function migrateLegacyAddOnCurrencyToHkd(value: unknown) {
	if (!Array.isArray(value)) return null;
	const defaults = CREDIT_PLAN_CONFIG_DEFAULTS["plan.credits.addons"];
	let needsMigration = false;
	const migrated = value.map((raw) => {
		if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
			return raw;
		}
		const offer = raw as Record<string, unknown>;
		if (offer.currency === "HKD") return offer;
		if (offer.currency !== "CNY") return offer;
		needsMigration = true;
		const matched = defaults.find((candidate) => candidate.id === offer.id);
		if (!matched) {
			return offer;
		}
		return {
			...offer,
			amountMicros: matched.amountMicros,
			currency: matched.currency,
		};
	});
	if (!needsMigration) return null;
	if (
		!migrated.every(
			(offer) =>
				offer &&
				typeof offer === "object" &&
				!Array.isArray(offer) &&
				typeof (offer as { id?: unknown }).id === "string" &&
				((offer as { id: string }).id.trim().length > 0) &&
				positiveInteger((offer as { credits?: unknown }).credits) &&
				Number.isSafeInteger((offer as { amountMicros?: unknown }).amountMicros) &&
				((offer as { amountMicros: number }).amountMicros >= 0) &&
				(offer as { currency?: unknown }).currency === "HKD" &&
				positiveInteger((offer as { expireDays?: unknown }).expireDays),
		)
	) {
		return null;
	}
	return migrated;
}


/**
 * Credit billing reads only these revisioned admin-config keys. The former
 * resource allowance catalogue intentionally has no fallback in this source.
 */
export class AdminConfigCreditPlanCatalogSource {
	constructor(private readonly repository: CreditPlanConfigRepository) {}

	async get() {
		const [
			trial,
			starter,
			growth,
			pro,
			addOns,
			cycleCoefficients,
			referenceNumbers,
			trialEnabled,
		] = await Promise.all([
			this.repository.get("global", GLOBAL_WORKSPACE_ID, "plan.credits.trial"),
			this.repository.get(
				"global",
				GLOBAL_WORKSPACE_ID,
				"plan.credits.starter",
			),
			this.repository.get("global", GLOBAL_WORKSPACE_ID, "plan.credits.growth"),
			this.repository.get("global", GLOBAL_WORKSPACE_ID, "plan.credits.pro"),
			this.repository.get("global", GLOBAL_WORKSPACE_ID, "plan.credits.addons"),
			this.repository.get(
				"global",
				GLOBAL_WORKSPACE_ID,
				"plan.credits.cycle_coefficients",
			),
			this.repository.get(
				"global",
				GLOBAL_WORKSPACE_ID,
				"plan.credits.reference_numbers",
			),
			this.repository.get(
				"global",
				GLOBAL_WORKSPACE_ID,
				"plan.credits.trial.enabled",
			),
		]);
		const configured = { trial, starter, growth, pro } as const;
		return {
			plans: CREDIT_PLAN_IDS.map((id) =>
				creditPlanFromConfig(id, configured[id]?.value),
			),
			addOns: creditAddOnsFromConfig(addOns?.value),
			cycleCoefficientBasisPoints:
				creditPlanCycleCoefficientBasisPointsFromConfig(
					cycleCoefficients?.value,
				),
			referenceNumbers: creditPlanReferenceNumbersFromConfig(
				referenceNumbers?.value,
			),
			trialEnabled: creditTrialEnabledFromConfig(trialEnabled?.value),
		} satisfies CreditPlanCatalog;
	}

	async commerceView() {
		const heads = await Promise.all([
			...COMMERCE_PLAN_CONFIG_KEYS.map((key) =>
				this.repository.get("global", GLOBAL_WORKSPACE_ID, key),
			),
			this.repository.get(
				"global",
				GLOBAL_WORKSPACE_ID,
				"plan.payment-mapping",
			),
		]);
		const revisions = Object.fromEntries(
			COMMERCE_PLAN_CONFIG_KEYS.map((key, index) => [key, heads[index]]),
		) as Record<
			(typeof COMMERCE_PLAN_CONFIG_KEYS)[number],
			{ revision?: number; value: unknown } | null
		>;
		const configured = {
			trial: revisions["plan.credits.trial"],
			starter: revisions["plan.credits.starter"],
			growth: revisions["plan.credits.growth"],
			pro: revisions["plan.credits.pro"],
		};
		const catalog = {
			plans: CREDIT_PLAN_IDS.map((id) =>
				creditPlanFromConfig(id, configured[id]?.value),
			),
			addOns: creditAddOnsFromConfig(
				revisions["plan.credits.addons"]?.value,
			),
			cycleCoefficientBasisPoints:
				creditPlanCycleCoefficientBasisPointsFromConfig(
					revisions["plan.credits.cycle_coefficients"]?.value,
				),
			referenceNumbers: creditPlanReferenceNumbersFromConfig(
				revisions["plan.credits.reference_numbers"]?.value,
			),
			trialEnabled: creditTrialEnabledFromConfig(
				revisions["plan.credits.trial.enabled"]?.value,
			),
		} satisfies CreditPlanCatalog;
		const paymentMapping = heads.at(-1);
		return commercePlanCatalogSnapshotSchema.parse({
			catalog: toPublicCreditPlanCatalog(catalog),
			paymentMapping: paymentMapping
				? {
						revision: paymentMapping.revision,
						mappings: commerceWaffoMappings(paymentMapping.value),
					}
				: null,
			planRevision: COMMERCE_PLAN_CONFIG_KEYS.map(
				(key) => `${key}@${requiredRevision(revisions[key])}`,
			).join("|"),
		});
	}

	async planFor(id: (typeof CREDIT_PLAN_IDS)[number]) {
		const catalog = await this.get();
		const plan = catalog.plans.find((candidate) => candidate.id === id);
		if (!plan) throw new Error(`Credit plan ${id} is not configured.`);
		return plan;
	}

	async publicView() {
		return toPublicCreditPlanCatalog(await this.get());
	}
}

function requiredRevision(revision: { revision?: number } | null) {
	if (!revision?.revision) throw missingCreditPlanConfig();
	return revision.revision;
}

function commerceWaffoMappings(value: unknown) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return [];
	const mappings = (value as { mappings?: unknown }).mappings;
	if (!Array.isArray(mappings)) return [];
	return mappings.filter((mapping) => {
		if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
			return false;
		}
		const interval = (mapping as { interval?: unknown }).interval;
		return (
			interval === "single_month" ||
			interval === "monthly" ||
			interval === "yearly"
		);
	});
}

function creditPlanFromConfig(
	id: (typeof CREDIT_PLAN_IDS)[number],
	value: unknown,
): CreditPlanOffer {
	const parsed = (
		id === "trial" ? trialCreditPlanSchema : creditPlanSchema
	).safeParse(value);
	if (!parsed.success) throw missingCreditPlanConfig();
	return { ...parsed.data, id };
}

function creditPlanCycleCoefficientBasisPointsFromConfig(
	value: unknown,
): CreditPlanCycleCoefficientBasisPoints {
	const parsed = creditPlanCycleCoefficientBasisPointsSchema.safeParse(value);
	if (!parsed.success) throw missingCreditPlanConfig();
	return parsed.data;
}

function creditPlanReferenceNumbersFromConfig(
	value: unknown,
): CreditPlanReferenceNumbers {
	const parsed = creditPlanReferenceNumbersSchema.safeParse(value);
	if (!parsed.success) throw missingCreditPlanConfig();
	return parsed.data;
}

function creditAddOnsFromConfig(value: unknown): CreditAddOnOffer[] {
	const parsed = creditAddOnsSchema.safeParse(value);
	if (!parsed.success) throw missingCreditPlanConfig();
	return parsed.data;
}

function creditTrialEnabledFromConfig(value: unknown) {
	if (typeof value !== "boolean") throw missingCreditPlanConfig();
	return value;
}

function positiveInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}

function nonnegativeInteger(value: unknown): value is number {
	return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function missingCreditPlanConfig() {
	return new Error(
		"Published credit plan configuration is incomplete or invalid.",
	);
}
