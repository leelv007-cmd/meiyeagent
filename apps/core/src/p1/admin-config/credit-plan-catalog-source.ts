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
} from "../credit-billing/credit-plan-catalog.js";
import type { AdminConfigRepository } from "./foundation-module.js";

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
 * required CNY price fields through one auditable revision.
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
						? "Add required CNY pricing fields to the legacy governed credit plan."
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
}

function creditPlanFromConfig(
	id: (typeof CREDIT_PLAN_IDS)[number],
	value: unknown,
): CreditPlanOffer {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw missingCreditPlanConfig();
	}
	const plan = value as Omit<CreditPlanOffer, "id">;
	if (
		!positiveInteger(plan.credits) ||
		!(id === "trial"
			? nonnegativeInteger(plan.monthlyPriceMicros)
			: positiveInteger(plan.monthlyPriceMicros)) ||
		plan.currency !== "CNY" ||
		!positiveInteger(plan.storageMb) ||
		!positiveInteger(plan.concurrencyLimit) ||
		!positiveInteger(plan.queuePriority) ||
		(plan.supportLabel !== "standard" && plan.supportLabel !== "priority")
	) {
		throw missingCreditPlanConfig();
	}
	return { ...plan, id };
}

function creditPlanCycleCoefficientBasisPointsFromConfig(
	value: unknown,
): CreditPlanCycleCoefficientBasisPoints {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw missingCreditPlanConfig();
	}
	const coefficients = value as CreditPlanCycleCoefficientBasisPoints;
	if (
		!basisPoints(coefficients.single_month) ||
		!basisPoints(coefficients.monthly) ||
		!basisPoints(coefficients.yearly)
	) {
		throw missingCreditPlanConfig();
	}
	return structuredClone(coefficients);
}

function creditPlanReferenceNumbersFromConfig(
	value: unknown,
): CreditPlanReferenceNumbers {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw missingCreditPlanConfig();
	}
	const referenceNumbers = value as CreditPlanReferenceNumbers;
	if (
		!referenceModelIds(referenceNumbers.referenceModels) ||
		!referenceOutputs(referenceNumbers.published)
	) {
		throw missingCreditPlanConfig();
	}
	return structuredClone(referenceNumbers);
}

function referenceModelIds(value: unknown): value is CreditPlanReferenceNumbers["referenceModels"] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const models = value as Record<string, unknown>;
	return ["copy", "image", "video"].every(
		(category) => typeof models[category] === "string" && models[category].trim().length > 0,
	);
}

function referenceOutputs(value: unknown): value is CreditPlanReferenceNumbers["published"] {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const published = value as Record<string, unknown>;
	return CREDIT_PLAN_IDS.every((planId) => {
		const outputs = published[planId];
		if (!outputs || typeof outputs !== "object" || Array.isArray(outputs)) return false;
		const record = outputs as Record<string, unknown>;
		return ["copy", "image", "video"].every((category) => nonnegativeInteger(record[category]));
	});
}

function creditAddOnsFromConfig(value: unknown): CreditAddOnOffer[] {
	if (!Array.isArray(value)) throw missingCreditPlanConfig();
	const addOns = value as CreditAddOnOffer[];
	if (
		!addOns.every(
			(offer) =>
				typeof offer.id === "string" &&
				offer.id.trim().length > 0 &&
				positiveInteger(offer.credits) &&
				Number.isSafeInteger(offer.amountMicros) &&
				offer.amountMicros >= 0 &&
				offer.currency === "CNY" &&
				positiveInteger(offer.expireDays),
		)
	) {
		throw missingCreditPlanConfig();
	}
	return structuredClone(addOns);
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

function basisPoints(value: unknown): value is number {
	return positiveInteger(value) && value <= 10_000;
}

function missingCreditPlanConfig() {
	return new Error(
		"Published credit plan configuration is incomplete or invalid.",
	);
}
