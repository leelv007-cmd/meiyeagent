import assert from "node:assert/strict";
import test from "node:test";

import {
	CREDIT_PLAN_CONFIG_DEFAULTS,
	CREDIT_PLAN_CONFIG_KEYS,
} from "@meiye/contracts";

import {
	AdminConfigCreditPlanCatalogSource,
	type CreditPlanConfigRepository,
	ensureCreditPlanCatalogDefaults,
	migrateCreditPlanCatalogCurrencyToHkd,
} from "../admin-config/credit-plan-catalog-source.js";
import { MemoryAdminConfigRepository } from "../admin-config/foundation-module.js";
import {
	creditPlanCheckoutAmountMicros,
	creditPlanConcurrencyTiers,
	DEFAULT_CREDIT_PLAN_CATALOG,
	MAX_CREDIT_PLAN_CONCURRENCY,
} from "./credit-plan-catalog.js";

test("job runtime registers every publishable credit plan concurrency tier", () => {
	assert.deepEqual(
		creditPlanConcurrencyTiers(),
		Array.from(
			{ length: MAX_CREDIT_PLAN_CONCURRENCY },
			(_, index) => index + 1,
		),
	);
});

test("checkout amounts round the governed HKD monthly source to the nearest whole HKD", () => {
	const expectations = [
		[231_183_288, 231_000_000, 208_000_000, 2_081_000_000],
		[579_700_809, 580_000_000, 522_000_000, 5_217_000_000],
		[1_044_390_836, 1_044_000_000, 940_000_000, 9_400_000_000],
	] as const;
	for (const [monthlyPriceMicros, singleMonth, monthly, yearly] of expectations) {
		assert.equal(
			creditPlanCheckoutAmountMicros(
				monthlyPriceMicros,
				"single_month",
				DEFAULT_CREDIT_PLAN_CATALOG.cycleCoefficientBasisPoints,
			),
			singleMonth,
		);
		assert.equal(
			creditPlanCheckoutAmountMicros(
				monthlyPriceMicros,
				"monthly",
				DEFAULT_CREDIT_PLAN_CATALOG.cycleCoefficientBasisPoints,
			),
			monthly,
		);
		assert.equal(
			creditPlanCheckoutAmountMicros(
				monthlyPriceMicros,
				"yearly",
				DEFAULT_CREDIT_PLAN_CATALOG.cycleCoefficientBasisPoints,
			),
			yearly,
		);
	}
});

test("plan.credits is the only published source for plan and package credits", async () => {
	const reads: string[] = [];
	const values = new Map<string, unknown>(
		DEFAULT_CREDIT_PLAN_CATALOG.plans.map(
			({ id, ...plan }) =>
				[
					`plan.credits.${id}`,
					id === "growth" ? { ...plan, credits: 1_500 } : plan,
				] as const,
		),
	);
	values.set("plan.credits.addons", DEFAULT_CREDIT_PLAN_CATALOG.addOns);
	values.set("plan.credits.cycle_coefficients", {
		monthly: 9_000,
		single_month: 10_000,
		yearly: 7_500,
	});
	values.set("plan.credits.reference_numbers", {
		referenceModels: {
			copy: "deepseek-v4-pro",
			image: "seedream-5-pro",
			video: "seedance-2",
		},
		published: {
			trial: { copy: 100, image: 20, video: 2 },
			starter: { copy: 500, image: 100, video: 10 },
			growth: { copy: 1_300, image: 260, video: 26 },
			pro: { copy: 2_800, image: 560, video: 56 },
		},
	});
	values.set("plan.credits.trial.enabled", true);
	const repository: CreditPlanConfigRepository = {
		async get(_scope, _workspaceId, key) {
			reads.push(key);
			const value = values.get(key);
			return value === undefined ? null : { value };
		},
	};

	const catalog = await new AdminConfigCreditPlanCatalogSource(
		repository,
	).get();

	assert.deepEqual(reads, [
		"plan.credits.trial",
		"plan.credits.starter",
		"plan.credits.growth",
		"plan.credits.pro",
		"plan.credits.addons",
		"plan.credits.cycle_coefficients",
		"plan.credits.reference_numbers",
		"plan.credits.trial.enabled",
	]);
	assert.equal(
		catalog.plans.find((plan) => plan.id === "growth")?.credits,
		1_500,
	);
	assert.equal(
		catalog.plans.find((plan) => plan.id === "growth")?.monthlyPriceMicros,
		579_700_809,
	);
	assert.deepEqual(catalog.addOns, DEFAULT_CREDIT_PLAN_CATALOG.addOns);
	assert.deepEqual(catalog.cycleCoefficientBasisPoints, {
		monthly: 9_000,
		single_month: 10_000,
		yearly: 7_500,
	});
	assert.equal(catalog.trialEnabled, true);
	assert.deepEqual(catalog.referenceNumbers, {
		referenceModels: {
			copy: "deepseek-v4-pro",
			image: "seedream-5-pro",
			video: "seedance-2",
		},
		published: {
			trial: { copy: 100, image: 20, video: 2 },
			starter: { copy: 500, image: 100, video: 10 },
			growth: { copy: 1_300, image: 260, video: 26 },
			pro: { copy: 2_800, image: 560, video: 56 },
		},
	});
});

test("an empty or partial plan.credits publication fails closed", async () => {
	const source = new AdminConfigCreditPlanCatalogSource({
		async get(_scope, _workspaceId, key) {
			if (key === "plan.credits.growth") {
				return {
					value: {
						credits: 1_300,
						storageMb: 5_120,
						concurrencyLimit: 4,
						queuePriority: 5,
						supportLabel: "priority",
					},
				};
			}
			return null;
		},
	});

	await assert.rejects(source.get(), /published credit plan configuration/i);
});

test("a legacy CNY publication stays unchanged and fails closed until an explicit HKD CAS", async () => {
	const repository = new MemoryAdminConfigRepository();
	for (const key of CREDIT_PLAN_CONFIG_KEYS) {
		const value: unknown = structuredClone(CREDIT_PLAN_CONFIG_DEFAULTS[key]);
		if (
			key.startsWith("plan.credits.") &&
			key !== "plan.credits.cycle_coefficients" &&
			key !== "plan.credits.reference_numbers" &&
			key !== "plan.credits.trial.enabled"
		) {
			if (Array.isArray(value)) {
				for (const offer of value) {
					(offer as Record<string, unknown>).currency = "CNY";
				}
			} else if (value && typeof value === "object") {
				(value as Record<string, unknown>).currency = "CNY";
			}
		}
		await repository.apply({
			actorId: "platform-admin",
			correlationId: `legacy-cny:${key}`,
			expectedRevision: null,
			key,
			reason: "Preserve the legacy CNY revision for explicit migration.",
			scope: "global",
			value,
			workspaceId: "__global__",
		});
	}

	await ensureCreditPlanCatalogDefaults(repository);
	await assert.rejects(
		new AdminConfigCreditPlanCatalogSource(repository).get(),
		/published credit plan configuration/i,
	);
	const starter = await repository.get(
		"global",
		"__global__",
		"plan.credits.starter",
	);
	assert.equal((starter?.value as { currency: string }).currency, "CNY");
	assert.equal(starter?.revision, 1);
});

test("explicit HKD migration upgrades legacy CNY publication so public catalog is readable", async () => {
	const repository = new MemoryAdminConfigRepository();
	for (const key of CREDIT_PLAN_CONFIG_KEYS) {
		const value: unknown = structuredClone(CREDIT_PLAN_CONFIG_DEFAULTS[key]);
		if (
			key.startsWith("plan.credits.") &&
			key !== "plan.credits.cycle_coefficients" &&
			key !== "plan.credits.reference_numbers" &&
			key !== "plan.credits.trial.enabled"
		) {
			if (Array.isArray(value)) {
				for (const offer of value) {
					(offer as Record<string, unknown>).currency = "CNY";
				}
			} else if (value && typeof value === "object") {
				(value as Record<string, unknown>).currency = "CNY";
			}
		}
		await repository.apply({
			actorId: "platform-admin",
			correlationId: `legacy-cny-migrate:${key}`,
			expectedRevision: null,
			key,
			reason: "Preserve the legacy CNY revision for explicit migration.",
			scope: "global",
			value,
			workspaceId: "__global__",
		});
	}

	await ensureCreditPlanCatalogDefaults(repository);
	await assert.rejects(
		new AdminConfigCreditPlanCatalogSource(repository).get(),
		/published credit plan configuration/i,
	);

	await migrateCreditPlanCatalogCurrencyToHkd(repository);

	const catalog = await new AdminConfigCreditPlanCatalogSource(repository).get();
	assert.equal(
		catalog.plans.every((plan) => plan.currency === "HKD"),
		true,
	);
	assert.equal(
		catalog.addOns.every((offer) => offer.currency === "HKD"),
		true,
	);
	const publicView = await new AdminConfigCreditPlanCatalogSource(
		repository,
	).publicView();
	assert.equal(
		publicView.plans.every((plan) => plan.currency === "HKD"),
		true,
	);

	const starterHistory = await repository.history(
		"global",
		"__global__",
		"plan.credits.starter",
	);
	assert.equal(starterHistory.length, 2);
	assert.equal(
		starterHistory[1]?.actorId,
		"system:credit-plan-catalog-hkd-migration",
	);
	assert.equal(
		(starterHistory[1]?.value as { currency: string }).currency,
		"HKD",
	);

	// Idempotent: second migration does not add another revision.
	await migrateCreditPlanCatalogCurrencyToHkd(repository);
	assert.equal(
		(
			await repository.history(
				"global",
				"__global__",
				"plan.credits.starter",
			)
		).length,
		2,
	);
});

test("initializes an empty installation with revisioned credit plan seeds exactly once", async () => {
	const repository = new MemoryAdminConfigRepository();

	await ensureCreditPlanCatalogDefaults(repository);

	assert.deepEqual(
		await new AdminConfigCreditPlanCatalogSource(repository).get(),
		DEFAULT_CREDIT_PLAN_CATALOG,
	);
	for (const key of [
		"plan.credits.trial",
		"plan.credits.starter",
		"plan.credits.growth",
		"plan.credits.pro",
		"plan.credits.addons",
		"plan.credits.cycle_coefficients",
		"plan.credits.reference_numbers",
		"plan.credits.trial.enabled",
	]) {
		const revisions = await repository.history("global", "__global__", key);
		assert.equal(revisions.length, 1, `${key} should have one seed revision`);
		assert.equal(revisions[0]?.actorId, "system:credit-plan-catalog-seed");
	}

	await ensureCreditPlanCatalogDefaults(repository);
	assert.equal(
		(await repository.history("global", "__global__", "plan.credits.starter"))
			.length,
		1,
	);
});

test("upgrades a #298 legacy credit plan with a revision while preserving operator entitlements", async () => {
	const repository = new MemoryAdminConfigRepository();
	await repository.apply({
		actorId: "platform-admin",
		correlationId: "legacy-298-growth",
		expectedRevision: null,
		key: "plan.credits.growth",
		reason: "Legacy #298 governed plan",
		scope: "global",
		value: {
			concurrencyLimit: 3,
			credits: 1_777,
			queuePriority: 4,
			storageMb: 4_096,
			supportLabel: "priority",
		},
		workspaceId: "__global__",
	});

	await ensureCreditPlanCatalogDefaults(repository);

	const growthHistory = await repository.history(
		"global",
		"__global__",
		"plan.credits.growth",
	);
	assert.equal(growthHistory.length, 2);
	assert.equal(growthHistory[1]?.actorId, "system:credit-plan-catalog-upgrade");
	assert.deepEqual(growthHistory[1]?.value, {
		concurrencyLimit: 3,
		credits: 1_777,
		currency: "HKD",
		monthlyPriceMicros: 579_700_809,
		queuePriority: 4,
		storageMb: 4_096,
		supportLabel: "priority",
	});

	const growth = await new AdminConfigCreditPlanCatalogSource(
		repository,
	).planFor("growth");
	assert.deepEqual(growth, {
		concurrencyLimit: 3,
		credits: 1_777,
		currency: "HKD",
		id: "growth",
		monthlyPriceMicros: 579_700_809,
		queuePriority: 4,
		storageMb: 4_096,
		supportLabel: "priority",
	});

	await ensureCreditPlanCatalogDefaults(repository);
	assert.equal(
		(await repository.history("global", "__global__", "plan.credits.growth"))
			.length,
		2,
	);
});

test("credit plan seeds match the approved trial, subscription and seven-day package values", () => {
	assert.deepEqual(DEFAULT_CREDIT_PLAN_CATALOG.plans, [
		{
			id: "trial",
			credits: 100,
			monthlyPriceMicros: 0,
			currency: "HKD",
			storageMb: 512,
			concurrencyLimit: 1,
			queuePriority: 1,
			supportLabel: "standard",
		},
		{
			id: "starter",
			credits: 500,
			monthlyPriceMicros: 231_183_288,
			currency: "HKD",
			storageMb: 1_024,
			concurrencyLimit: 1,
			queuePriority: 1,
			supportLabel: "standard",
		},
		{
			id: "growth",
			credits: 1_300,
			monthlyPriceMicros: 579_700_809,
			currency: "HKD",
			storageMb: 5_120,
			concurrencyLimit: 4,
			queuePriority: 5,
			supportLabel: "priority",
		},
		{
			id: "pro",
			credits: 2_800,
			monthlyPriceMicros: 1_044_390_836,
			currency: "HKD",
			storageMb: 20_480,
			concurrencyLimit: 8,
			queuePriority: 10,
			supportLabel: "priority",
		},
	]);
	assert.deepEqual(DEFAULT_CREDIT_PLAN_CATALOG.cycleCoefficientBasisPoints, {
		monthly: 9_000,
		single_month: 10_000,
		yearly: 7_500,
	});
	assert.deepEqual(
		DEFAULT_CREDIT_PLAN_CATALOG.addOns.map((offer) => [
			offer.credits,
			offer.expireDays,
		]),
		[
			[100, 7],
			[300, 7],
			[1_000, 7],
		],
	);
});
