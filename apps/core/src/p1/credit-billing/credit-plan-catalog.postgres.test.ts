import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";
import { Pool } from "pg";

import {
	AdminConfigCreditPlanCatalogSource,
	applyCreditPlanCatalogCurrencyToHkdMigration,
	ensureCreditPlanCatalogDefaults,
	previewCreditPlanCatalogCurrencyToHkdMigration,
	rollbackCreditPlanCatalogCurrencyToHkdMigration,
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
							currency: "HKD",
							monthlyPriceMicros: 579_700_809,
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
					currency: "HKD",
					id: "growth",
					monthlyPriceMicros: 579_700_809,
					queuePriority: 4,
					storageMb: 4_096,
					supportLabel: "priority",
				},
			);
		});

		it("keeps CNY to HKD migration previewed, CAS-protected, audited and append-only reversible", async () => {
			await pool.query(
				`DELETE FROM admin_config_heads
				 WHERE scope = $1 AND workspace_id = $2 AND config_key = $3`,
				["global", "__global__", "plan.credits.starter"],
			);
			await pool.query(
				`DELETE FROM admin_config_revisions
				 WHERE scope = $1 AND workspace_id = $2 AND config_key = $3`,
				["global", "__global__", "plan.credits.starter"],
			);
			await repository.apply({
				actorId: "platform-admin",
				correlationId: "legacy-cny-starter-pg",
				expectedRevision: null,
				key: "plan.credits.starter",
				reason: "Keep a legacy CNY plan until an operator approves migration.",
				scope: "global",
				value: {
					concurrencyLimit: 1,
					credits: 500,
					currency: "CNY",
					monthlyPriceMicros: 231_183_288,
					queuePriority: 1,
					storageMb: 1_024,
					supportLabel: "standard",
				},
				workspaceId: "__global__",
			});

			const preview = await previewCreditPlanCatalogCurrencyToHkdMigration(
				repository,
			);
			assert.deepEqual(
				preview.find((candidate) => candidate.key === "plan.credits.starter"),
				{
					expectedRevision: 1,
					key: "plan.credits.starter",
					proposedValue: {
						concurrencyLimit: 1,
						credits: 500,
						currency: "HKD",
						monthlyPriceMicros: 231_183_288,
						queuePriority: 1,
						storageMb: 1_024,
						supportLabel: "standard",
					},
					status: "ready",
				},
			);
			assert.equal(
				(
					await repository.history(
						"global",
						"__global__",
						"plan.credits.starter",
					)
				).length,
				1,
			);

			const applied = await applyCreditPlanCatalogCurrencyToHkdMigration(
				repository,
				{
					actorId: "platform-admin:catalog-migration",
					correlationId: "apply-cny-starter-pg",
					expectedRevision: 1,
					key: "plan.credits.starter",
				},
			);
			assert.equal(applied.revision, 2);
			assert.equal(applied.actorId, "platform-admin:catalog-migration");
			await assert.rejects(
				applyCreditPlanCatalogCurrencyToHkdMigration(repository, {
					actorId: "platform-admin:catalog-migration",
					correlationId: "stale-apply-cny-starter-pg",
					expectedRevision: 1,
					key: "plan.credits.starter",
				}),
				/expected revision 1.*found 2/i,
			);
			await assert.rejects(
				rollbackCreditPlanCatalogCurrencyToHkdMigration(repository, {
					actorId: "platform-admin:catalog-migration",
					correlationId: "stale-rollback-cny-starter-pg",
					expectedRevision: 1,
					key: "plan.credits.starter",
					targetRevision: 1,
				}),
				/expected revision 1.*found 2/i,
			);
			const rolledBack = await rollbackCreditPlanCatalogCurrencyToHkdMigration(
				repository,
				{
					actorId: "platform-admin:catalog-migration",
					correlationId: "rollback-cny-starter-pg",
					expectedRevision: 2,
					key: "plan.credits.starter",
					targetRevision: 1,
				},
			);
			assert.equal(rolledBack.revision, 3);
			assert.equal(rolledBack.status, "rolled_back");
			assert.equal(rolledBack.rolledBackToRevision, 1);
			assert.deepEqual(
				(
					await repository.history(
						"global",
						"__global__",
						"plan.credits.starter",
					)
				).map(({ actorId, correlationId, revision, status }) => ({
					actorId,
					correlationId,
					revision,
					status,
				})),
				[
					{
						actorId: "platform-admin",
						correlationId: "legacy-cny-starter-pg",
						revision: 1,
						status: "applied",
					},
					{
						actorId: "platform-admin:catalog-migration",
						correlationId: "apply-cny-starter-pg",
						revision: 2,
						status: "applied",
					},
					{
						actorId: "platform-admin:catalog-migration",
						correlationId: "rollback-cny-starter-pg",
						revision: 3,
						status: "rolled_back",
					},
				],
			);
		});
	},
);
