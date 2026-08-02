export const CREDIT_PLAN_IDS = ["trial", "starter", "growth", "pro"] as const;
export type CreditPlanId = (typeof CREDIT_PLAN_IDS)[number];
export const CREDIT_PLAN_BILLING_CYCLES = [
	"single_month",
	"monthly",
	"yearly",
] as const;
export type CreditPlanBillingCycle =
	(typeof CREDIT_PLAN_BILLING_CYCLES)[number];
export const MAX_CREDIT_PLAN_CONCURRENCY = 100;

export function creditPlanConcurrencyTiers() {
	return Array.from(
		{ length: MAX_CREDIT_PLAN_CONCURRENCY },
		(_, index) => index + 1,
	);
}

export interface CreditPlanOffer {
	id: CreditPlanId;
	credits: number;
	/** One calendar month before the selected billing-cycle coefficient. */
	monthlyPriceMicros: number;
	currency: "CNY";
	storageMb: number;
	concurrencyLimit: number;
	queuePriority: number;
	supportLabel: "standard" | "priority";
}

export interface CreditPlanCycleCoefficientBasisPoints {
	monthly: number;
	single_month: number;
	yearly: number;
}

export interface CreditPlanReferenceOutputs {
	copy: number;
	image: number;
	video: number;
}

export interface CreditPlanReferenceNumbers {
	referenceModels: {
		copy: string;
		image: string;
		video: string;
	};
	published: Record<CreditPlanId, CreditPlanReferenceOutputs>;
}

export interface CreditAddOnOffer {
	id: string;
	credits: number;
	amountMicros: number;
	currency: "CNY";
	expireDays: number;
}

export interface CreditPlanCatalog {
	plans: CreditPlanOffer[];
	addOns: CreditAddOnOffer[];
	cycleCoefficientBasisPoints: CreditPlanCycleCoefficientBasisPoints;
	referenceNumbers: CreditPlanReferenceNumbers;
	trialEnabled: boolean;
}

export function creditPlanCheckoutAmountMicros(
	monthlyPriceMicros: number,
	cycle: CreditPlanBillingCycle,
	coefficients: CreditPlanCycleCoefficientBasisPoints,
) {
	const months = cycle === "yearly" ? 12 : 1;
	return Number(
		(BigInt(monthlyPriceMicros) *
			BigInt(months) *
			BigInt(coefficients[cycle])) /
			10_000n,
	);
}

/**
 * Operator-managed defaults. Running values are read from `plan.credits.*`
 * admin-config revisions; this literal only makes an empty installation usable.
 */
export const DEFAULT_CREDIT_PLAN_CATALOG: CreditPlanCatalog = {
	plans: [
		{
			id: "trial",
			...CREDIT_PLAN_CONFIG_DEFAULTS["plan.credits.trial"],
		},
		{
			id: "starter",
			...CREDIT_PLAN_CONFIG_DEFAULTS["plan.credits.starter"],
		},
		{
			id: "growth",
			...CREDIT_PLAN_CONFIG_DEFAULTS["plan.credits.growth"],
		},
		{
			id: "pro",
			...CREDIT_PLAN_CONFIG_DEFAULTS["plan.credits.pro"],
		},
	],
	addOns: CREDIT_PLAN_CONFIG_DEFAULTS["plan.credits.addons"].map((offer) => ({
		...offer,
	})),
	cycleCoefficientBasisPoints: {
		...CREDIT_PLAN_CONFIG_DEFAULTS["plan.credits.cycle_coefficients"],
	},
	referenceNumbers: structuredClone(
		CREDIT_PLAN_CONFIG_DEFAULTS["plan.credits.reference_numbers"],
	),
	trialEnabled: CREDIT_PLAN_CONFIG_DEFAULTS["plan.credits.trial.enabled"],
};

export function creditPlanConfigKey(plan: CreditPlanId) {
	return `plan.credits.${plan}` as const;
}

import { CREDIT_PLAN_CONFIG_DEFAULTS } from "@meiye/contracts";
