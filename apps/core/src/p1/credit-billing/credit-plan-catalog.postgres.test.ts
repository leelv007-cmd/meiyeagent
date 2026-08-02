import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";

import {
	AdminConfigCreditPlanCatalogSource,
	ensureCreditPlanCatalogDefaults,
} from "../admin-config/credit-plan-catalog-source.js";
import { PostgresAdminConfigRepository } from "../admin-config/postgres-repository.js";

const databaseUrl = process.env.TEST_DATABASE_URL;

describe(
	"Postgres credit-plan catalog upgrade",
	{ skip: databaseUrl ? false : "TEST_DATABASE_URL is not configured" },
	() => {
		const schema = `credit_plan_catalog_${randomUUID().replaceAll("-", "")}`;
		const adminPool = new Pool({ connectionString: databaseUrl });
		const pool = new Pool({
			connectionString: databaseUrl,
			options: `-c search_path=${schema}`,
		});
		const repository = new PostgresAdminConfigRepository(pool);
		let schemaCreated = false;

		before(async () => {
			await adminPool.query(`CREATE SCHEMA "${schema}"`);
			schemaCreated = true;
			await repository.migrate();
		});

		after(async () => {
			try {
				await pool.end();
			} finally {
				try {
					if (schemaCreated) {
						await adminPool.query(`DROP SCHEMA "${schema}" CASCADE`);
					}
				} finally {
					await adminPool.end();
				}
			}
		});

		it("upgrades the persisted #298 shape without replacing operator entitlements", async () => {
			await repository.apply({
				actorId: "platform-admin",
				correlationId: "legacy-298-growth-pg",
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

			await ensureCreditPlanCatalogDefaults(
				new PostgresAdminConfigRepository(pool),
			);

			const restartedRepository = new PostgresAdminConfigRepository(pool);
			const history = await restartedRepository.history(
				"global",
				"__global__",
				"plan.credits.growth",
			);
			assert.deepEqual(
				history.map((revision) => ({
					actorId: revision.actorId,
					revision: revision.revision,
					value: revision.value,
				})),
				[
					{
						actorId: "platform-admin",
						revision: 1,
						value: {
							concurrencyLimit: 3,
							credits: 1_777,
							queuePriority: 4,
							storageMb: 4_096,
							supportLabel: "priority",
						},
					},
					{
						actorId: "system:credit-plan-catalog-upgrade",
						revision: 2,
						value: {
							concurrencyLimit: 3,
							credits: 1_777,
							currency: "CNY",
							monthlyPriceMicros: 499_000_000,
							queuePriority: 4,
							storageMb: 4_096,
							supportLabel: "priority",
						},
					},
				],
			);
			assert.deepEqual(
				await new AdminConfigCreditPlanCatalogSource(
					restartedRepository,
				).planFor("growth"),
				{
					concurrencyLimit: 3,
					credits: 1_777,
					currency: "CNY",
					id: "growth",
					monthlyPriceMicros: 499_000_000,
					queuePriority: 4,
					storageMb: 4_096,
					supportLabel: "priority",
				},
			);
		});
	},
);
