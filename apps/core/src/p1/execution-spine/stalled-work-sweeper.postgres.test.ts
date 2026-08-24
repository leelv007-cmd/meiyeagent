import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";
import { creditUsageOperationId } from "../credit-billing/credit-ledger.js";
import { PostgresCreditLedger } from "../credit-billing/postgres-credit-ledger.js";
import { PostgresGrantLotLedger } from "../foundation/postgres-grant-lot.js";
import { PostgresFoundationRepository } from "../foundation/postgres-repository.js";
import { PostgresOperationsRepository } from "../operations/postgres-repository.js";
import { DurableProductBillingService } from "../product-billing/durable-service.js";
import { PostgresProductBillingRepository } from "../product-billing/postgres-repository.js";
import { createCreationExecutionSnapshot } from "./creation-execution-snapshot.js";
import {
	PostgresCreationSubmissionPersistence,
	PostgresCreationSubmissionStore,
	PostgresProductBillingUsageReservation,
	PostgresStalledWorkSweepStore,
} from "./postgres-creation-submission-store.js";
import {
	STALLED_WORK_FAILURE_CODE,
	StalledWorkSweeper,
	stalledWorkRefundOperationId,
} from "./stalled-work-sweeper.js";
import { failCreationForPrepareTerminalRejection } from "./prepare-terminal-rejection.js";
import { failCreationForUnroutableMediaTerminal } from "./unroutable-media-terminal.js";
import {
	CreationSubmissionCoordinator,
	PrepareTerminalRejectionError,
	type CreationSubmissionRecord,
} from "./submission-coordinator.js";

const connectionString = process.env.TEST_DATABASE_URL;
const noOpGrantLots = {
	async consumeWithClient() {
		return [];
	},
};

test(
	"V31-82 Step 1: image job is created inside workflow execution, not at startHarness",
	{ skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
	async () => {
		const pool = new Pool({ connectionString });
		const suffix = randomUUID();
		const absent = await seedImageWork(pool, `absent-${suffix}`);
		const present = await seedImageWork(pool, `present-${suffix}`);
		try {
			assert.equal(absent.workStatus, "running");
			assert.equal(absent.jobCount, 0);
			assert.equal(absent.harnessState, "started");
			assert.equal(absent.availableCredits, 80);

			const recovered = await absent.coordinator.recoverPendingStarts(100);
			assert.equal(
				recovered.started,
				0,
				"recoverPendingStarts must not re-dispatch a work whose harness start already completed",
			);
			assert.equal(await countJobs(pool, absent.workspaceId), 0);

			await insertStaleImageJob(pool, present, "2026-08-13T00:00:30.000Z");
			assert.equal(await countJobs(pool, present.workspaceId), 1);
			assert.equal(
				await workStatus(pool, present.workspaceId, present.workId),
				"running",
			);
		} finally {
			await cleanup(pool, [absent, present]);
			await pool.end();
		}
	},
);

test(
	"V31-82 stalled work timeout fails both windows, refunds once, and refuses a double refund",
	{ skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
	async () => {
		const pool = new Pool({ connectionString });
		const suffix = randomUUID();
		const noJob = await seedImageWork(pool, `nojob-${suffix}`, {
			workUpdatedAt: "2026-08-13T00:00:00.000Z",
		});
		const staleJob = await seedImageWork(pool, `stale-${suffix}`, {
			workUpdatedAt: "2026-08-13T00:00:00.000Z",
		});
		try {
			await insertStaleImageJob(pool, staleJob, "2026-08-13T00:00:00.000Z");
			const sweeper = new StalledWorkSweeper(
				new PostgresStalledWorkSweepStore(noJob.store),
				{
					now: () => new Date("2026-08-13T00:03:00.000Z"),
					timeoutMs: 60_000,
				},
			);

			const first = await sweeper.runOnce();
			assert.equal(first.claimed, 2);
			assert.equal(first.terminated, 2);
			assert.equal(first.failed, 0);

			for (const fixture of [noJob, staleJob]) {
				assert.equal(
					await workStatus(pool, fixture.workspaceId, fixture.workId),
					"failed",
				);
				assert.equal(
					(
						await fixture.billingRepository.getUsage(
							fixture.workspaceId,
							fixture.taskId,
						)
					)?.status,
					"refunded",
				);
				assert.equal(
					(
						await fixture.creditLedger.project(
							fixture.workspaceId,
							"2026-08-13T00:03:00.000Z",
						)
					).availableCredits,
					100,
				);
			}
			assert.equal(
				await jobStatus(pool, staleJob.workspaceId, staleJob.jobId),
				"failed",
			);

			const second = await sweeper.runOnce();
			assert.equal(second.terminated, 0);
			await noJob.store.terminateRunningWork({
				workspaceId: noJob.workspaceId,
				workId: noJob.workId,
				reason: "timeout",
				now: "2026-08-13T00:04:00.000Z",
			});
			assert.equal(
				(
					await noJob.creditLedger.project(
						noJob.workspaceId,
						"2026-08-13T00:04:00.000Z",
					)
				).availableCredits,
				100,
			);
			const refundTx = await pool.query<{ n: string }>(
				`SELECT count(*)::text AS n
           FROM p1_credit_lot_transactions
          WHERE workspace_id = $1
            AND transaction_type = 'REFUND'
            AND operation_id = $2`,
				[noJob.workspaceId, stalledWorkRefundOperationId(noJob.taskId)],
			);
			assert.equal(Number(refundTx.rows[0]?.n ?? 0), 1);
		} finally {
			await cleanup(pool, [noJob, staleJob]);
			await pool.end();
		}
	},
);

test(
	"V31-82 merchant cancel reuses the same terminal refund path",
	{ skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
	async () => {
		const pool = new Pool({ connectionString });
		const fixture = await seedImageWork(pool, `cancel-${randomUUID()}`);
		try {
			const outcome = await fixture.store.terminateRunningWork({
				workspaceId: fixture.workspaceId,
				taskId: fixture.taskId,
				reason: "cancelled",
				now: "2026-08-13T00:01:00.000Z",
			});
			assert.equal(outcome, "terminated");
			assert.equal(
				await workStatus(pool, fixture.workspaceId, fixture.workId),
				"failed",
			);
			const payload = await pool.query<{ reason: string | null }>(
				`SELECT payload->>'failureReason' AS reason
           FROM p1_creative_works
          WHERE workspace_id = $1 AND id = $2`,
				[fixture.workspaceId, fixture.workId],
			);
			assert.equal(payload.rows[0]?.reason, "cancelled");
			assert.equal(
				(
					await fixture.creditLedger.project(
						fixture.workspaceId,
						"2026-08-13T00:01:00.000Z",
					)
				).availableCredits,
				100,
			);
		} finally {
			await cleanup(pool, [fixture]);
			await pool.end();
		}
	},
);

test(
	"V31-105 \u00a713 \u2460A: an unroutable media terminal fails the creation, refunds once, and stays idempotent",
	{ skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
	async () => {
		const pool = new Pool({ connectionString });
		const fixture = await seedImageWork(pool, `unroutable-${randomUUID()}`);
		try {
			assert.equal(fixture.harnessState, "started");
			assert.equal(
				await workStatus(pool, fixture.workspaceId, fixture.workId),
				"running",
			);

			// The worker holds the frozen submission's correlationId, which is the
			// prepared-attempt run id, not the bare task id.
			const correlationId = `${fixture.taskId}:plan-r1`;
			const outcome = await failCreationForUnroutableMediaTerminal(
				fixture.store,
				{
					workspaceId: fixture.workspaceId,
					correlationId,
					now: "2026-08-23T00:01:00.000Z",
				},
			);
			assert.equal(outcome, "terminated");

			assert.equal(
				await workStatus(pool, fixture.workspaceId, fixture.workId),
				"failed",
			);
			const failed = await pool.query<{
				reason: string | null;
				code: string | null;
			}>(
				`SELECT payload->>'failureReason' AS reason,
				        payload->>'failureCode' AS code
				   FROM p1_creative_works
				  WHERE workspace_id = $1 AND id = $2`,
				[fixture.workspaceId, fixture.workId],
			);
			assert.equal(failed.rows[0]?.reason, "orchestration_lost");
			// Reuses the existing merchant-visible terminal code so the report
			// card, the shelf 'failed' face and the restart entry all apply.
			assert.equal(failed.rows[0]?.code, STALLED_WORK_FAILURE_CODE);

			// Reserved credits are back, and the merchant is told so honestly.
			assert.equal(
				(
					await fixture.creditLedger.project(
						fixture.workspaceId,
						"2026-08-23T00:01:00.000Z",
					)
				).availableCredits,
				100,
			);
			// terminateRunningWork writes the audit under the task id and under
			// composerPreparedAttemptId(submission); this fixture is not
			// merchant_confirmed, so both collapse to the bare task id. Reaching
			// the row at all is what proves the correlationId was resolved back
			// to its task (outcome 'terminated' above, not 'missing').
			const audit = await pool.query<{ message: string | null }>(
				`SELECT payload->>'merchantMessage' AS message
				   FROM harness_runtime.audit_events
				  WHERE workflow_id = $1 AND event_type = 'workflow_failed'`,
				[fixture.taskId],
			);
			assert.equal(audit.rowCount, 1);
			assert.match(String(audit.rows[0]?.message), /\u79ef\u5206\u5df2\u7ecf\u9000\u56de/u);
			assert.doesNotMatch(String(audit.rows[0]?.message), /\u8d85\u65f6/u);

			// A dead letter can be re-delivered; the second notification must not
			// refund twice or rewrite the terminal record.
			const replay = await failCreationForUnroutableMediaTerminal(
				fixture.store,
				{
					workspaceId: fixture.workspaceId,
					correlationId,
					now: "2026-08-23T00:02:00.000Z",
				},
			);
			assert.equal(replay, "already_terminal");
			assert.equal(
				(
					await fixture.creditLedger.project(
						fixture.workspaceId,
						"2026-08-23T00:02:00.000Z",
					)
				).availableCredits,
				100,
			);
			const refundTx = await pool.query<{ n: string }>(
				`SELECT count(*)::text AS n
				   FROM p1_credit_lot_transactions
				  WHERE workspace_id = $1
				    AND transaction_type = 'REFUND'
				    AND operation_id = $2`,
				[fixture.workspaceId, stalledWorkRefundOperationId(fixture.taskId)],
			);
			assert.equal(Number(refundTx.rows[0]?.n ?? 0), 1);
		} finally {
			await cleanup(pool, [fixture]);
			await pool.end();
		}
	},
);

test(
	"V31-108: prepare terminal rejection fails the running work, refunds once, and stays idempotent",
	{ skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
	async () => {
		const pool = new Pool({ connectionString });
		const fixture = await seedImageWork(pool, `prepare-rej-${randomUUID()}`, {
			harnessState: "reserved",
		});
		try {
			assert.equal(fixture.harnessState, "reserved");
			assert.equal(
				await workStatus(pool, fixture.workspaceId, fixture.workId),
				"running",
			);
			assert.equal(fixture.availableCredits, 80);

			await pool.query(
				`UPDATE execution_spine.creation_submissions
            SET updated_at = clock_timestamp() - interval '10 seconds'
          WHERE workspace_id = $1 AND id = $2`,
				[fixture.workspaceId, fixture.submissionId],
			);

			const rejectionReason = "这次的创作方案无法按当前要求开始";
			const coordinator = new CreationSubmissionCoordinator(
				fixture.store,
				{
					async start() {
						throw new Error("start must not run after prepare terminalizes");
					},
				},
				{
					createId() {
						return `unused-${fixture.taskId}`;
					},
					now() {
						return "2026-08-25T00:00:00.000Z";
					},
				},
				{
					async admit() {
						throw new Error(
							"Recovery must not run a new-submission admission.",
						);
					},
				},
				undefined,
				{
					async prepare() {
						throw new PrepareTerminalRejectionError(rejectionReason);
					},
				},
			);

			let refundCalls = 0;
			const outcome = await coordinator.recoverPendingStarts(100, {
				onPrepareTerminalRefund: async (record) => {
					refundCalls += 1;
					await fixture.store.refundPrepareTerminalReservation(record);
				},
			});
			assert.equal(
				(outcome.failureDetails ?? []).some(
					(detail) =>
						detail.submissionId === fixture.submissionId &&
						detail.terminal === true,
				),
				true,
			);
			assert.equal(refundCalls, 1);

			// Reverse wiring: if recoverPendingStarts does not call
			// terminateRunningWork, work stays running and this assertion fails.
			// If failCreationForPrepareTerminalRejection is forced to
			// reason:'timeout', failureReason and the 超时-forbidden merchant
			// sentence fail (same flip as V31-105 §13 ①A).
			assert.equal(
				await workStatus(pool, fixture.workspaceId, fixture.workId),
				"failed",
			);
			const failed = await pool.query<{
				reason: string | null;
				code: string | null;
			}>(
				`SELECT payload->>'failureReason' AS reason,
				        payload->>'failureCode' AS code
				   FROM p1_creative_works
				  WHERE workspace_id = $1 AND id = $2`,
				[fixture.workspaceId, fixture.workId],
			);
			assert.equal(failed.rows[0]?.reason, "prepare_rejected");
			assert.equal(failed.rows[0]?.code, STALLED_WORK_FAILURE_CODE);

			const harness = await pool.query<{ harness_state: string }>(
				`SELECT harness_state
				   FROM execution_spine.creation_submissions
				  WHERE workspace_id = $1 AND id = $2`,
				[fixture.workspaceId, fixture.submissionId],
			);
			assert.equal(harness.rows[0]?.harness_state, "failed");

			assert.equal(
				(
					await fixture.creditLedger.project(
						fixture.workspaceId,
						"2026-08-25T00:01:00.000Z",
					)
				).availableCredits,
				100,
			);
			assert.equal(
				(
					await fixture.billingRepository.getUsage(
						fixture.workspaceId,
						fixture.taskId,
					)
				)?.status,
				"refunded",
			);

			const audit = await pool.query<{ message: string | null }>(
				`SELECT payload->>'merchantMessage' AS message
				   FROM harness_runtime.audit_events
				  WHERE workflow_id = $1 AND event_type = 'workflow_failed'`,
				[fixture.taskId],
			);
			assert.equal(audit.rowCount, 1);
			assert.match(
				String(audit.rows[0]?.message),
				/\u79ef\u5206\u5df2\u7ecf\u9000\u56de/u,
			);
			assert.match(String(audit.rows[0]?.message), /\u6ca1\u80fd\u5f00\u59cb/u);
			assert.match(String(audit.rows[0]?.message), new RegExp(rejectionReason, "u"));
			assert.doesNotMatch(String(audit.rows[0]?.message), /\u8d85\u65f6/u);

			const replay = await failCreationForPrepareTerminalRejection(
				fixture.store,
				{
					workspaceId: fixture.workspaceId,
					taskId: fixture.taskId,
					now: "2026-08-25T00:02:00.000Z",
				},
			);
			assert.equal(replay, "already_terminal");
			assert.equal(
				(
					await fixture.creditLedger.project(
						fixture.workspaceId,
						"2026-08-25T00:02:00.000Z",
					)
				).availableCredits,
				100,
			);
			const refundTx = await pool.query<{ n: string }>(
				`SELECT count(*)::text AS n
				   FROM p1_credit_lot_transactions
				  WHERE workspace_id = $1
				    AND transaction_type = 'REFUND'
				    AND operation_id = $2`,
				[fixture.workspaceId, stalledWorkRefundOperationId(fixture.taskId)],
			);
			assert.equal(Number(refundTx.rows[0]?.n ?? 0), 1);
			const anyRefund = await pool.query<{ n: string }>(
				`SELECT count(*)::text AS n
				   FROM p1_credit_lot_transactions
				  WHERE workspace_id = $1
				    AND transaction_type = 'REFUND'`,
				[fixture.workspaceId],
			);
			assert.equal(Number(anyRefund.rows[0]?.n ?? 0), 1);
		} finally {
			await cleanup(pool, [fixture]);
			await pool.end();
		}
	},
);

type ImageWorkFixture = {
	store: PostgresCreationSubmissionStore;
	coordinator: CreationSubmissionCoordinator;
	billingRepository: PostgresProductBillingRepository;
	creditLedger: PostgresCreditLedger;
	workspaceId: string;
	workId: string;
	taskId: string;
	submissionId: string;
	usageReservationId: string;
	jobId: string;
	workStatus: string | null;
	harnessState: string | null;
	jobCount: number;
	availableCredits: number;
};

async function seedImageWork(
	pool: Pool,
	suffix: string,
	options?: {
		workUpdatedAt?: string;
		harnessState?: "reserved" | "started";
	},
): Promise<ImageWorkFixture> {
	const operations = new PostgresOperationsRepository(pool);
	const billingRepository = new PostgresProductBillingRepository(pool);
	const creditLedger = new PostgresCreditLedger(pool);
	const foundation = new PostgresFoundationRepository(pool);
	const store = new PostgresCreationSubmissionStore(
		pool,
		new PostgresCreationSubmissionPersistence(
			new PostgresProductBillingUsageReservation(
				pool,
				noOpGrantLots,
				creditLedger,
			),
		),
		{ creditLedger },
	);
	const workspaceId = `v3182-ws-${suffix}`;
	const quoteId = `v3182-quote-${suffix}`;
	const submission = imageReserveRecord(workspaceId, quoteId, suffix);

	await operations.migrate();
	await billingRepository.migrate();
	await foundation.migrate();
	const migrationClient = await pool.connect();
	try {
		await creditLedger.migrate(migrationClient);
		await new PostgresGrantLotLedger(pool).migrate(migrationClient);
	} finally {
		migrationClient.release();
	}
	await store.applySchema();
	await pool.query(`
    CREATE SCHEMA IF NOT EXISTS harness_runtime;
    CREATE TABLE IF NOT EXISTS harness_runtime.audit_events (
      id text PRIMARY KEY,
      workflow_id text NOT NULL,
      stage text NOT NULL,
      event_type text NOT NULL,
      payload jsonb NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
  `);
	await pool.query(
		"INSERT INTO workspaces (id, name) VALUES ($1, 'V31-82 stalled work')",
		[workspaceId],
	);
	await creditLedger.grant({
		id: `v3182-credit-${suffix}`,
		workspaceId,
		credits: 100,
		expirationDate: "2026-09-01T00:00:00.000Z",
		transactionType: "PURCHASE_PACKAGE",
		sourceRef: `v3182-${suffix}`,
		createdAt: "2026-07-01T00:00:00.000Z",
	});
	const quote = await seedQuote(
		billingRepository,
		workspaceId,
		quoteId,
		submission.task.id,
		{ creditCost: 20, outputCount: 1, unitRate: 20 },
	);
	submission.snapshot = createImageSnapshot({
		quoteId,
		quoteRevision: quote.revision,
		submission,
		workspaceId,
	});
	submission.usageReservation = {
		id: submission.usageReservation.id,
		credits: 20,
		units: [],
		creditUsageOperationId: creditUsageOperationId(submission.task.id),
	};

	const claimed = await store.claim({
		idempotencyKey: `v3182-${suffix}`,
		payloadHash: `payload-v3182-${suffix}`,
		submission,
		workspaceId,
	});
	assert.equal(claimed.kind, "created");

	if ((options?.harnessState ?? "started") === "started") {
		await pool.query(
			`UPDATE execution_spine.creation_submissions
          SET harness_state = 'started',
              updated_at = $3::timestamptz
        WHERE workspace_id = $1 AND id = $2`,
			[workspaceId, submission.snapshot.id, submission.snapshot.createdAt],
		);
	}
	if (options?.workUpdatedAt) {
		await pool.query(
			`UPDATE p1_creative_works
          SET updated_at = $3::timestamptz
        WHERE workspace_id = $1 AND id = $2`,
			[workspaceId, submission.work.id, options.workUpdatedAt],
		);
	}

	const coordinator = new CreationSubmissionCoordinator(
		store,
		{
			async start() {
				return {};
			},
		},
		{
			createId() {
				return `unused-${suffix}`;
			},
			now() {
				return "2026-08-13T00:00:00.000Z";
			},
		},
		{
			async admit() {
				throw new Error("Recovery must not run a new-submission admission.");
			},
		},
	);

	return {
		store,
		coordinator,
		billingRepository,
		creditLedger,
		workspaceId,
		workId: submission.work.id,
		taskId: submission.task.id,
		submissionId: submission.snapshot.id,
		usageReservationId: submission.usageReservation.id,
		jobId: `v3182-job-${suffix}`,
		workStatus: await workStatus(pool, workspaceId, submission.work.id),
		harnessState:
			(
				await pool.query<{ harness_state: string }>(
					`SELECT harness_state
           FROM execution_spine.creation_submissions
          WHERE workspace_id = $1 AND id = $2`,
					[workspaceId, submission.snapshot.id],
				)
			).rows[0]?.harness_state ?? null,
		jobCount: await countJobs(pool, workspaceId),
		availableCredits: (
			await creditLedger.project(workspaceId, submission.snapshot.createdAt)
		).availableCredits,
	};
}

async function insertStaleImageJob(
	pool: Pool,
	fixture: ImageWorkFixture,
	updatedAt: string,
) {
	const routeId = `v3182-route-${fixture.workId}`;
	await pool.query(
		`INSERT INTO p1_route_snapshots (
       workspace_id, id, catalog_revision, policy_revision, price_revision,
       requested_catalog_model_id, selection_mode, data_class, data_classes,
       fallback_consent, allowed_candidates, created_at
     ) VALUES (
       $1, $2, 'catalog-r1', 'policy-r1', 'price-r1',
       'nano-banana-2', 'fixed', 'unrestricted', '[]'::jsonb,
       false, '[]'::jsonb, $3::timestamptz
     )
     ON CONFLICT (workspace_id, id) DO NOTHING`,
		[fixture.workspaceId, routeId, updatedAt],
	);
	await pool.query(
		`INSERT INTO p1_generation_jobs (
       workspace_id, id, operation, route_snapshot_id, usage_reservation_id,
       status, created_by, correlation_id, created_at, updated_at
     ) VALUES (
       $1, $2, 'image', $3, $4,
       'running', 'owner-1', $5, $6::timestamptz, $6::timestamptz
     )`,
		[
			fixture.workspaceId,
			fixture.jobId,
			routeId,
			fixture.usageReservationId,
			fixture.taskId,
			updatedAt,
		],
	);
}

function imageReserveRecord(
	workspaceId: string,
	quoteId: string,
	suffix: string,
): CreationSubmissionRecord {
	const taskId = `v3182-task-${suffix}`;
	const workId = `v3182-work-${suffix}`;
	const contentPackageId = `v3182-package-${suffix}`;
	const submission: CreationSubmissionRecord = {
		contentPackage: { expectedRevision: 0, id: contentPackageId },
		snapshot: createImageSnapshot({
			quoteId,
			quoteRevision: "quote-revision-placeholder",
			submission: {
				contentPackage: { expectedRevision: 0, id: contentPackageId },
				task: { id: taskId },
				work: { id: workId },
			},
			workspaceId,
		}),
		task: { id: taskId },
		usageReservation: {
			id: `v3182-usage-${suffix}`,
			credits: 20,
			units: [],
		},
		work: { id: workId },
	};
	return submission;
}

function createImageSnapshot(input: {
	quoteId: string;
	quoteRevision: string;
	submission: Pick<
		CreationSubmissionRecord,
		"contentPackage" | "task" | "work"
	>;
	workspaceId: string;
}) {
	return createCreationExecutionSnapshot(
		{
			actorId: "owner-1",
			briefConfirmation: { id: "brief-1", revision: "brief-r1" },
			briefContext: { id: "brief-context-1", revision: 1 },
			catalogModel: { id: "nano-banana-2", revision: "catalog-r1" },
			contentModules: ["social_cover"],
			contentPackageId: input.submission.contentPackage.id,
			deliverables: [
				{
					id: "image-main",
					kind: "image",
					order: 1,
					quantity: 1,
					aspectRatio: "3:4",
				},
			],
			expectedContentPackageRevision:
				input.submission.contentPackage.expectedRevision,
			identity: { id: "identity-1", revision: "identity-r1" },
			idempotencyKey: "submission-key",
			creationMode: "customized",
			intent: "做一组美甲项目套图",
			lens: "image",
			modelPolicy: { id: "policy-1", mode: "fixed", revision: "policy-r1" },
			platform: { id: "xiaohongshu" },
			contentPackagePlatform: "xiaohongshu",
			distributionTarget: "export",
			quote: { id: input.quoteId, revision: input.quoteRevision },
			recipe: { id: "recipe-fallback-image", revision: "recipe-r1" },
			rights: { revision: "rights-r1", summary: "authorized source assets" },
			route: { id: "route-1", revision: "route-r1" },
			sources: {
				assets: [{ id: "asset-1", revision: "asset-r1", role: "reference" }],
			},
			surface: { id: "surface-1", revision: "surface-r1" },
			taskId: input.submission.task.id,
			workId: input.submission.work.id,
			workspaceId: input.workspaceId,
		},
		"2026-08-13T00:00:00.000Z",
	);
}

async function seedQuote(
	repository: PostgresProductBillingRepository,
	workspaceId: string,
	quoteId: string,
	taskId: string,
	options: { creditCost: number; outputCount: number; unitRate: number },
) {
	const billing = new DurableProductBillingService(repository);
	await billing.buildQuote({
		billingMode: "per_request",
		catalogModelId: "nano-banana-2",
		catalogModelRevision: "catalog-r1",
		frozenCandidateDeploymentIds: ["image-deployment-1"],
		creditCost: options.creditCost,
		quoteId,
		quotePolicyRevision: "quote-policy-1",
		routeSnapshotRef: "route-1",
		outputCount: options.outputCount,
		unitRate: options.unitRate,
		workspaceId,
	});
	return billing.confirm({ quoteId, taskId, workspaceId });
}

async function workStatus(pool: Pool, workspaceId: string, workId: string) {
	const result = await pool.query<{ status: string | null }>(
		`SELECT payload->>'status' AS status
       FROM p1_creative_works
      WHERE workspace_id = $1 AND id = $2`,
		[workspaceId, workId],
	);
	return result.rows[0]?.status ?? null;
}

async function jobStatus(pool: Pool, workspaceId: string, jobId: string) {
	const result = await pool.query<{ status: string | null }>(
		`SELECT status FROM p1_generation_jobs WHERE workspace_id = $1 AND id = $2`,
		[workspaceId, jobId],
	);
	return result.rows[0]?.status ?? null;
}

async function countJobs(pool: Pool, workspaceId: string) {
	const result = await pool.query<{ n: string }>(
		`SELECT count(*)::text AS n FROM p1_generation_jobs WHERE workspace_id = $1`,
		[workspaceId],
	);
	return Number(result.rows[0]?.n ?? 0);
}

async function cleanup(pool: Pool, fixtures: ImageWorkFixture[]) {
	for (const fixture of fixtures) {
		await pool
			.query(`DELETE FROM p1_generation_jobs WHERE workspace_id = $1`, [
				fixture.workspaceId,
			])
			.catch(() => undefined);
		await pool
			.query(`DELETE FROM p1_route_snapshots WHERE workspace_id = $1`, [
				fixture.workspaceId,
			])
			.catch(() => undefined);
		await pool
			.query(
				`DELETE FROM harness_runtime.audit_events WHERE workflow_id = $1`,
				[fixture.taskId],
			)
			.catch(() => undefined);
		await pool
			.query(
				`DELETE FROM execution_spine.creation_submissions WHERE workspace_id = $1`,
				[fixture.workspaceId],
			)
			.catch(() => undefined);
		await pool
			.query(`DELETE FROM p1_product_billing_usage WHERE workspace_id = $1`, [
				fixture.workspaceId,
			])
			.catch(() => undefined);
		await pool
			.query(`DELETE FROM p1_product_billing_quotes WHERE workspace_id = $1`, [
				fixture.workspaceId,
			])
			.catch(() => undefined);
		await pool
			.query(`DELETE FROM p1_content_packages WHERE workspace_id = $1`, [
				fixture.workspaceId,
			])
			.catch(() => undefined);
		await pool
			.query(`DELETE FROM p1_content_tasks WHERE workspace_id = $1`, [
				fixture.workspaceId,
			])
			.catch(() => undefined);
		await pool
			.query(`DELETE FROM p1_creative_works WHERE workspace_id = $1`, [
				fixture.workspaceId,
			])
			.catch(() => undefined);
		await pool
			.query(`DELETE FROM p1_credit_lot_transactions WHERE workspace_id = $1`, [
				fixture.workspaceId,
			])
			.catch(() => undefined);
		await pool
			.query(`DELETE FROM p1_credit_grant_lots WHERE workspace_id = $1`, [
				fixture.workspaceId,
			])
			.catch(() => undefined);
		await pool
			.query("DELETE FROM workspaces WHERE id = $1", [fixture.workspaceId])
			.catch(() => undefined);
	}
}
