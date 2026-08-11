import {
	CREDIT_PLAN_CONFIG_DEFAULTS,
	CREDIT_PLAN_CONFIG_KEYS,
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
	): Promise<{ value: unknown } | null>;
}

const CREDIT_PLAN_SEED_ACTOR_ID = "system:credit-plan-catalog-seed";
const CREDIT_PLAN_UPGRADE_ACTOR_ID = "system:credit-plan-catalog-upgrade";
const CREDIT_PLAN_HKD_MIGRATION_ACTOR_ID =
	"system:credit-plan-catalog-hkd-migration";

const LEGACY_CREDIT_PLAN_KEYS = [
	"plan.credits.trial",
	"plan.credits.starter",
	"plan.credits.growth",
	"plan.credits.pro",
] as const;
type LegacyCreditPlanConfigKey = (typeof LEGACY_CREDIT_PLAN_KEYS)[number];

/**
 * Materialize the opening catalog as audited revisions before either runtime
 * reads it. Existing operator decisions win, except for the exact #298 plan
 * shape: its five operator-controlled entitlement fields receive the newly
 * required HKD price fields through one auditable revision.
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
 * Explicit CAS migration for published plan/addon currency that is still not
 * HKD. ensureCreditPlanCatalogDefaults intentionally leaves legacy CNY alone;
 * bootstrap calls this after seed/upgrade so local and shipped catalogs heal
 * without a silent currency rewrite inside ensure.
 */
export async function migrateCreditPlanCatalogCurrencyToHkd(
	repository: Pick<AdminConfigRepository, "apply" | "get">,
) {
	const migratableKeys = [
		...LEGACY_CREDIT_PLAN_KEYS,
		"plan.credits.addons",
	] as const;

	for (const key of migratableKeys) {
		for (let attempt = 0; attempt < 2; attempt += 1) {
			const existing = await repository.get("global", GLOBAL_WORKSPACE_ID, key);
			if (!existing) break;
			const migrated =
				key === "plan.credits.addons"
					? migrateLegacyAddOnCurrencyToHkd(existing.value)
					: migrateLegacyPlanCurrencyToHkd(key, existing.value);
			if (!migrated) break;
			try {
				await repository.apply({
					actorId: CREDIT_PLAN_HKD_MIGRATION_ACTOR_ID,
					correlationId: `bootstrap:hkd-migration:${key}`,
					expectedRevision: existing.revision,
					key,
					reason:
						"Migrate published credit plan catalog currency from non-HKD to governed HKD prices.",
					scope: "global",
					value: migrated,
					workspaceId: GLOBAL_WORKSPACE_ID,
				});
				break;
			} catch (error) {
				if (attempt === 1) throw error;
			}
		}
	}
}

function migrateLegacyPlanCurrencyToHkd(
	key: LegacyCreditPlanConfigKey,
	value: unknown,
) {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	const plan = value as Record<string, unknown>;
	if (plan.currency === "HKD") return null;
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
		needsMigration = true;
		const matched = defaults.find((candidate) => candidate.id === offer.id);
		if (!matched) {
			return {
				...offer,
				currency: "HKD",
			};
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
