import assert from "node:assert/strict";
import test from "node:test";

import {
	AdminConfigCreditPlanCatalogSource,
	type CreditPlanConfigRepository,
	ensureCreditPlanCatalogDefaults,
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

test("checkout amounts use the published basis-point coefficient and cycle length", () => {
	assert.equal(
		creditPlanCheckoutAmountMicros(
			499_000_000,
			"single_month",
			DEFAULT_CREDIT_PLAN_CATALOG.cycleCoefficientBasisPoints,
		),
		499_000_000,
	);
	assert.equal(
		creditPlanCheckoutAmountMicros(
			499_000_000,
			"monthly",
			DEFAULT_CREDIT_PLAN_CATALOG.cycleCoefficientBasisPoints,
		),
		449_100_000,
	);
	assert.equal(
		creditPlanCheckoutAmountMicros(
			499_000_000,
			"yearly",
			DEFAULT_CREDIT_PLAN_CATALOG.cycleCoefficientBasisPoints,
		),
		4_491_000_000,
	);
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
		499_000_000,
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
		currency: "CNY",
		monthlyPriceMicros: 499_000_000,
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
		currency: "CNY",
		id: "growth",
		monthlyPriceMicros: 499_000_000,
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
			currency: "CNY",
			storageMb: 512,
			concurrencyLimit: 1,
			queuePriority: 1,
			supportLabel: "standard",
		},
		{
			id: "starter",
			credits: 500,
			monthlyPriceMicros: 199_000_000,
			currency: "CNY",
			storageMb: 1_024,
			concurrencyLimit: 1,
			queuePriority: 1,
			supportLabel: "standard",
		},
		{
			id: "growth",
			credits: 1_300,
			monthlyPriceMicros: 499_000_000,
			currency: "CNY",
			storageMb: 5_120,
			concurrencyLimit: 4,
			queuePriority: 5,
			supportLabel: "priority",
		},
		{
			id: "pro",
			credits: 2_800,
			monthlyPriceMicros: 899_000_000,
			currency: "CNY",
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
