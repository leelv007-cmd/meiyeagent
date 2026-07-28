import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { Pool } from "pg";

import { DurableProductBillingService } from "../product-billing/durable-service.js";
import { PostgresProductBillingRepository } from "../product-billing/postgres-repository.js";
import { PostgresOperationsRepository } from "../operations/postgres-repository.js";
import {
  createCreationExecutionSnapshot,
  type ComposerSubmissionRequest,
} from "./creation-execution-snapshot.js";
import {
  PostgresCreationSubmissionPersistence,
  PostgresCreationSubmissionStore,
  PostgresProductBillingUsageReservation,
} from "./postgres-creation-submission-store.js";
import {
  CreationSubmissionCoordinator,
  type CreationSubmissionRecord,
} from "./submission-coordinator.js";
import { toHarnessWorkflowInput } from "./creation-stage-port.js";
import { buildSemanticDecisionResumption } from "../harness/semantic-decision-resumption.js";
import { PostgresGrantLotLedger } from "../foundation/postgres-grant-lot.js";
import { GrantLotAwareProductEntitlementService } from "../foundation/grant-lot-entitlement-service.js";
import { MemoryFoundationRepository } from "../foundation/memory-repository.js";

const connectionString = process.env.TEST_DATABASE_URL;
const noOpGrantLots = {
  async consumeWithClient() {
    return [];
  },
};

test(
  "Postgres Coordinator reserves one copy unit for a fractional monetary quote and blocks the next submission",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async (t) => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    const billingRepository = new PostgresProductBillingRepository(pool);
    const billing = new DurableProductBillingService(
      billingRepository,
      () => new Date("2026-07-22T09:01:00.000Z"),
    );
    const grantLots = new PostgresGrantLotLedger(pool);
    const store = new PostgresCreationSubmissionStore(
      pool,
      new PostgresCreationSubmissionPersistence(
        new PostgresProductBillingUsageReservation(pool, grantLots),
      ),
    );
    const suffix = randomUUID();
    const workspaceId = `spine-trial-${suffix}`;
    const entitlementRepository = new MemoryFoundationRepository();
    const context = {
      workspaceId,
      userId: "owner",
      correlationId: "trial-projection",
    };
    entitlementRepository.grantOwner(workspaceId, context.userId);
    const entitlements = new GrantLotAwareProductEntitlementService(
      entitlementRepository,
      grantLots,
      undefined,
      () => new Date("2026-07-22T09:01:00.000Z"),
      billing,
    );
    const first = reserveRecord(workspaceId, `spine-quote-a-${suffix}`, `a-${suffix}`);
    const second = reserveRecord(workspaceId, `spine-quote-b-${suffix}`, `b-${suffix}`);

    try {
      await operations.migrate();
      await billingRepository.migrate();
      await grantLots.migrate();
      await store.applySchema();
      await pool.query(
        "INSERT INTO workspaces (id, name) VALUES ($1, 'Coordinator trial test')",
        [workspaceId],
      );
      await entitlements.activatePlan(
        context,
        {
          paymentEventId: `trial-copy-${suffix}`,
          policy: {
            revision: `trial-copy-${suffix}`,
            tier: "trial",
            periodId: "2026-07",
            periodStartsAt: "2026-07-22T09:00:00.000Z",
            periodEndsAt: "2026-08-01T00:00:00.000Z",
            periodStrategy: "fixed_days",
            allowance: { audio: 0, copy: 1, image: 0, video: 0 },
            concurrencyLimit: 1,
            queuePriority: 1,
            supportLabel: "standard",
          },
        },
        `trial-copy-${suffix}`,
      );
      for (const submission of [first, second]) {
        const quote = await seedQuote(
          billingRepository,
          workspaceId,
          submission.snapshot.quote.id,
          submission.task.id,
          { outputCount: 1, unitRate: 0.02 },
        );
        assert.equal(quote.confirmedAmount, 0.02);
        assert.equal(quote.outputCount, 1);
        submission.snapshot = createSnapshot({
          quoteId: quote.quoteId,
          quoteRevision: quote.revision,
          submission,
          workspaceId,
        });
      }

      assert.equal(
        (
          await store.claim({
            idempotencyKey: "trial-copy-first",
            payloadHash: "trial-copy-first",
            submission: first,
            workspaceId,
          })
        ).kind,
        "created",
      );
      assert.equal(
        (await grantLots.rebuildProjection({
          workspaceId,
          asOf: "2026-07-22T09:01:00.000Z",
          actorId: "owner",
          correlationId: "trial-projection",
        })).find((item) => item.resource === "copy")?.remainingAmount,
        0,
      );
      const reservedEntitlement = (await entitlements.getProjection(context))
        .usage.copy;
      const reservedBilling = (
        await billing.getUsageProjection(workspaceId)
      ).copy;
      assert.deepEqual(reservedEntitlement, {
        allowance: 1,
        reserved: 1,
        committed: 0,
        released: 0,
        available: 0,
      });
      assert.deepEqual(reservedBilling, {
        reserved: 1,
        committed: 0,
        released: 0,
      });
      t.diagnostic(
        `reserved entitlement=${JSON.stringify(reservedEntitlement)} billing=${JSON.stringify(reservedBilling)}`,
      );

      await assert.rejects(
        store.claim({
          idempotencyKey: "trial-copy-second",
          payloadHash: "trial-copy-second",
          submission: second,
          workspaceId,
        }),
        /Insufficient copy allowance/u,
      );
      assert.equal(
        await billingRepository.getUsage(workspaceId, second.task.id),
        null,
      );
      await billing.settleTask({
        workspaceId,
        taskId: first.task.id,
        attemptId: `receipt-${first.task.id}`,
        deploymentId: "coordinator",
        status: "completed",
      });
      const committedEntitlement = (await entitlements.getProjection(context))
        .usage.copy;
      const committedBilling = (
        await billing.getUsageProjection(workspaceId)
      ).copy;
      assert.deepEqual(committedEntitlement, {
        allowance: 1,
        reserved: 0,
        committed: 1,
        released: 0,
        available: 0,
      });
      assert.deepEqual(committedBilling, {
        reserved: 0,
        committed: 1,
        released: 0,
      });
      t.diagnostic(
        `committed entitlement=${JSON.stringify(committedEntitlement)} billing=${JSON.stringify(committedBilling)}`,
      );
      await grantLots.grant({
        id: `addon-copy-${suffix}`,
        workspaceId,
        resource: "copy",
        amount: 1,
        expirationDate: null,
        transactionType: "PURCHASE_PACKAGE",
        sourceRef: `addon-copy-${suffix}`,
        createdAt: "2026-07-22T09:02:00.000Z",
      });
      assert.equal(
        (
          await store.claim({
            idempotencyKey: "trial-copy-second",
            payloadHash: "trial-copy-second",
            submission: second,
            workspaceId,
          })
        ).kind,
        "created",
      );
      assert.equal(
        (await billingRepository.getUsage(workspaceId, second.task.id))?.status,
        "reserved",
      );
    } finally {
      for (const submission of [second, first]) {
        await cleanup(pool, workspaceId, submission).catch(() => undefined);
      }
      await pool.query(
        "DELETE FROM p1_grant_lot_transactions WHERE workspace_id = $1",
        [workspaceId],
      ).catch(() => undefined);
      await pool.query(
        "DELETE FROM p1_grant_lots WHERE workspace_id = $1",
        [workspaceId],
      ).catch(() => undefined);
      await pool.query("DELETE FROM workspaces WHERE id = $1", [workspaceId])
        .catch(() => undefined);
      await pool.end();
    }
  },
);

test(
  "Postgres Coordinator consumes every bucket supplied by composite submission facts",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    const billingRepository = new PostgresProductBillingRepository(pool);
    const grantLots = new PostgresGrantLotLedger(pool);
    const clock = () => new Date("2026-07-22T09:01:00.000Z");
    const store = new PostgresCreationSubmissionStore(
      pool,
      new PostgresCreationSubmissionPersistence(
        new PostgresProductBillingUsageReservation(pool, grantLots),
      ),
    );
    const suffix = randomUUID();
    const workspaceId = `spine-composite-${suffix}`;
    const quoteId = `spine-composite-quote-${suffix}`;
    const submission = reserveRecord(
      workspaceId,
      quoteId,
      suffix,
      "image",
    );
    submission.usageReservation.units = [
      { resource: "copy", quantity: 1 },
      { resource: "image", quantity: 2 },
    ];

    try {
      await operations.migrate();
      await billingRepository.migrate();
      await grantLots.migrate();
      await store.applySchema();
      await pool.query(
        "INSERT INTO workspaces (id, name) VALUES ($1, 'Composite usage test')",
        [workspaceId],
      );
      for (const unit of submission.usageReservation.units) {
        await grantLots.grant({
          id: `composite-${unit.resource}-${suffix}`,
          workspaceId,
          resource: unit.resource,
          amount: unit.quantity,
          expirationDate: null,
          transactionType: "PURCHASE_PACKAGE",
          sourceRef: `composite-${unit.resource}-${suffix}`,
          createdAt: "2026-07-22T09:00:00.000Z",
        });
      }
      const quote = await seedQuote(
        billingRepository,
        workspaceId,
        quoteId,
        submission.task.id,
        { outputCount: 1, unitRate: 0.12 },
      );
      submission.snapshot = createSnapshot({
        lens: "image",
        quoteId,
        quoteRevision: quote.revision,
        submission,
        workspaceId,
      });

      assert.equal(
        (
          await store.claim({
            idempotencyKey: "composite-submit",
            payloadHash: "composite-submit",
            submission,
            workspaceId,
          })
        ).kind,
        "created",
      );
      assert.deepEqual(
        (await billingRepository.getUsage(workspaceId, submission.task.id))
          ?.reservedUnits,
        submission.usageReservation.units,
      );
      const billingProjection = await new DurableProductBillingService(
        billingRepository,
      ).getUsageProjection(workspaceId);
      assert.deepEqual(billingProjection.copy, {
        reserved: 1,
        committed: 0,
        released: 0,
      });
      assert.deepEqual(billingProjection.image, {
        reserved: 2,
        committed: 0,
        released: 0,
      });
      const projection = await grantLots.rebuildProjection({
        workspaceId,
        asOf: "2026-07-22T09:01:00.000Z",
        actorId: "owner",
        correlationId: "composite-projection",
      });
      assert.equal(
        projection.find((item) => item.resource === "copy")?.remainingAmount,
        0,
      );
      assert.equal(
        projection.find((item) => item.resource === "image")?.remainingAmount,
        0,
      );
      const billing = new DurableProductBillingService(
        billingRepository,
        clock,
      );
      await billing.settleTask({
        workspaceId,
        taskId: submission.task.id,
        attemptId: `composite-receipt-${suffix}`,
        deploymentId: "coordinator",
        status: "completed",
      });
      const committed = await billing.getUsageProjection(workspaceId);
      assert.deepEqual(committed.copy, {
        reserved: 0,
        committed: 1,
        released: 0,
      });
      assert.deepEqual(committed.image, {
        reserved: 0,
        committed: 2,
        released: 0,
      });
      assert.deepEqual(
        await billing.getMonthlyOutput(workspaceId, "2026-07"),
        { copy: 1, image: 2, video: 0 },
      );
    } finally {
      await cleanup(pool, workspaceId, submission).catch(() => undefined);
      await pool.query(
        "DELETE FROM p1_grant_lot_transactions WHERE workspace_id = $1",
        [workspaceId],
      ).catch(() => undefined);
      await pool.query(
        "DELETE FROM p1_grant_lots WHERE workspace_id = $1",
        [workspaceId],
      ).catch(() => undefined);
      await pool.query("DELETE FROM workspaces WHERE id = $1", [workspaceId])
        .catch(() => undefined);
      await pool.end();
    }
  },
);

test(
  "Postgres Coordinator fails closed when composite submission facts omit usage units",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    const billingRepository = new PostgresProductBillingRepository(pool);
    const grantLots = new PostgresGrantLotLedger(pool);
    const store = new PostgresCreationSubmissionStore(
      pool,
      new PostgresCreationSubmissionPersistence(
        new PostgresProductBillingUsageReservation(pool, grantLots),
      ),
    );
    const suffix = randomUUID();
    const workspaceId = `spine-missing-units-${suffix}`;
    const quoteId = `spine-missing-units-quote-${suffix}`;
    const submission = reserveRecord(workspaceId, quoteId, suffix, "image");

    try {
      await operations.migrate();
      await billingRepository.migrate();
      await grantLots.migrate();
      await store.applySchema();
      await pool.query(
        "INSERT INTO workspaces (id, name) VALUES ($1, 'Missing units test')",
        [workspaceId],
      );
      const quote = await seedQuote(
        billingRepository,
        workspaceId,
        quoteId,
        submission.task.id,
        { outputCount: 1, unitRate: 0.12 },
      );
      submission.snapshot = createSnapshot({
        lens: "image",
        quoteId,
        quoteRevision: quote.revision,
        submission,
        workspaceId,
      });
      delete (
        submission.usageReservation as {
          units?: CreationSubmissionRecord["usageReservation"]["units"];
        }
      ).units;

      await assert.rejects(
        store.claim({
          idempotencyKey: "missing-units-submit",
          payloadHash: "missing-units-submit",
          submission,
          workspaceId,
        }),
        /requires explicit product usage units/,
      );
      assert.equal(
        await billingRepository.getUsage(workspaceId, submission.task.id),
        null,
      );
    } finally {
      await cleanup(pool, workspaceId, submission).catch(() => undefined);
      await pool.query("DELETE FROM workspaces WHERE id = $1", [workspaceId])
        .catch(() => undefined);
      await pool.end();
    }
  },
);

test(
  "Postgres Coordinator store atomically reserves product shells and reclaims only an expired Harness lease",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    const billingRepository = new PostgresProductBillingRepository(pool);
    const store = new PostgresCreationSubmissionStore(
      pool,
      new PostgresCreationSubmissionPersistence(
        new PostgresProductBillingUsageReservation(pool, noOpGrantLots),
      ),
      { harnessStartLeaseMs: 60_000 },
    );
    const suffix = randomUUID();
    const workspaceId = `spine-workspace-${suffix}`;
    const quoteId = `spine-quote-${suffix}`;
    const submission = reserveRecord(workspaceId, quoteId, suffix);

    try {
      await operations.migrate();
      await billingRepository.migrate();
      await store.applySchema();
      const quote = await seedQuote(
        billingRepository,
        workspaceId,
        quoteId,
        submission.task.id,
      );
      submission.snapshot = createSnapshot({
        quoteId,
        quoteRevision: quote.revision,
        submission,
        workspaceId,
      });

      const first = await store.claim({
        idempotencyKey: "submit-copy-1",
        payloadHash: "payload-a",
        submission,
        workspaceId,
      });
      assert.equal(first.kind, "created");
      const reservedQuote = await billingRepository.getQuote(
        workspaceId,
        quoteId,
      );
      assert.equal(reservedQuote?.lifecycleStatus, "reserved");
      assert.equal(reservedQuote?.taskId, submission.task.id);
      const replay = await store.claim({
        idempotencyKey: "submit-copy-1",
        payloadHash: "payload-a",
        submission,
        workspaceId,
      });
      assert.equal(replay.kind, "existing");
      const conflict = await store.claim({
        idempotencyKey: "submit-copy-1",
        payloadHash: "payload-b",
        submission,
        workspaceId,
      });
      assert.equal(conflict.kind, "conflict");

      const resumption = buildSemanticDecisionResumption({
        request: {
          ...toHarnessWorkflowInput(
            submission.snapshot,
            submission.usageReservation,
          ),
          executionSnapshot: submission.snapshot,
        },
        command: {
          idempotencyKey: "decision-industry-1",
          questionId: `${submission.task.id}:s1:industry_category`,
          workflowRevision: submission.snapshot.revision,
          patch: {
            field: "industry_category",
            value: "美甲",
            reason: "补充本次内容所属的美业服务类别",
          },
          decision: { state: "accepted", value: "美甲" },
        },
        createdAt: "2026-07-22T09:05:00.000Z",
      });
      resumption.submission.usageReservation = submission.usageReservation;
      const semanticClaims = await Promise.all([
        store.claimSemanticDecisionResumption({
          sourceSnapshotId: submission.snapshot.id,
          workspaceId,
          idempotencyKey: resumption.idempotencyKey,
          payloadHash: resumption.payloadHash,
          submission: resumption.submission,
        }),
        store.claimSemanticDecisionResumption({
          sourceSnapshotId: submission.snapshot.id,
          workspaceId,
          idempotencyKey: resumption.idempotencyKey,
          payloadHash: resumption.payloadHash,
          submission: resumption.submission,
        }),
      ]);
      assert.deepEqual(semanticClaims.sort(), ["created", "replayed"]);

      const persisted = await pool.query<{
        packages: number;
        submissions: number;
        tasks: number;
        usage: number;
        works: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM p1_content_packages
             WHERE workspace_id = $1 AND id = $2) AS packages,
           (SELECT count(*)::int FROM execution_spine.creation_submissions
             WHERE workspace_id = $1 AND task_id = $3) AS submissions,
           (SELECT count(*)::int FROM p1_content_tasks
             WHERE workspace_id = $1 AND id = $3) AS tasks,
           (SELECT count(*)::int FROM p1_creative_works
             WHERE workspace_id = $1 AND id = $4) AS works,
           (SELECT count(*)::int FROM p1_product_billing_usage
             WHERE workspace_id = $1 AND task_id = $3) AS usage`,
        [
          workspaceId,
          submission.contentPackage.id,
          submission.task.id,
          submission.work.id,
        ],
      );
      assert.deepEqual(persisted.rows[0], {
        packages: 1,
        submissions: 2,
        tasks: 1,
        usage: 1,
        works: 1,
      });
      assert.equal(
        (
          await pool.query<{ usage_id: string }>(
            `SELECT usage_id FROM p1_product_billing_usage
             WHERE workspace_id = $1 AND task_id = $2`,
            [workspaceId, submission.task.id],
          )
        ).rows[0]?.usage_id,
        submission.usageReservation.id,
      );
      const lineage = await pool.query<{
        content_package_id: string;
        execution_snapshot: unknown;
        quote_id: string;
        route_snapshot_id: string;
        task_id: string;
        usage_reservation_id: string;
        work_id: string;
      }>(
        `SELECT c.task_id, c.work_id, c.content_package_id,
                c.usage_reservation_id, c.quote_id, c.route_snapshot_id,
                p.payload->'source'->'creationExecutionSnapshot' AS execution_snapshot
           FROM execution_spine.creation_submissions c
           JOIN p1_content_packages p
             ON p.workspace_id = c.workspace_id
            AND p.id = c.content_package_id
          WHERE c.workspace_id = $1 AND c.id = $2`,
        [workspaceId, submission.snapshot.id],
      );
      assert.deepEqual(lineage.rows[0], {
        content_package_id: submission.contentPackage.id,
        execution_snapshot: {
          id: submission.snapshot.id,
          revision: 1,
          schemaVersion: "creation-execution-snapshot/v1",
        },
        quote_id: quoteId,
        route_snapshot_id: "route-1",
        task_id: submission.task.id,
        usage_reservation_id: submission.usageReservation.id,
        work_id: submission.work.id,
      });
      await billingRepository.saveProviderCost(workspaceId, {
        attemptId: `attempt-${suffix}`,
        billingMode: "per_request",
        billingStatus: "known",
        currency: "CNY",
        deploymentId: "copy-deployment-1",
        estimatedCostMicros: 100,
        payer: "platform",
        supplierPriceRevision: "supplier-price-1",
        taskId: submission.task.id,
        unit: "request",
        unitPriceMicros: 100,
      });
      const linkedCost = await pool.query<{ attempt_id: string }>(
        `SELECT cost.attempt_id
           FROM execution_spine.creation_submissions submission
           JOIN p1_product_billing_provider_costs cost
             ON cost.workspace_id = submission.workspace_id
            AND cost.task_id = submission.task_id
          WHERE submission.workspace_id = $1 AND submission.id = $2`,
        [workspaceId, submission.snapshot.id],
      );
      assert.deepEqual(linkedCost.rows, [{ attempt_id: `attempt-${suffix}` }]);

      const leaseOne = await store.claimHarnessStart({
        submissionId: submission.snapshot.id,
        workspaceId,
      });
      assert.equal(leaseOne.kind, "start");
      const held = await store.claimHarnessStart({
        submissionId: submission.snapshot.id,
        workspaceId,
      });
      assert.deepEqual(held, { kind: "started" });

      await pool.query(
        `UPDATE execution_spine.creation_submissions
            SET harness_lease_expires_at = clock_timestamp() - interval '1 second'
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, submission.snapshot.id],
      );
      assert.deepEqual(
        (await store.listRecoverableHarnessStarts({ limit: 10 }))
          .filter(
            (candidate) =>
              candidate.submission.snapshot.workspaceId === workspaceId,
          )
          .map((candidate) => candidate.submission.snapshot.id),
        [submission.snapshot.id],
      );
      if (leaseOne.kind !== "start") {
        throw new Error("Expected the initial Harness lease claim.");
      }
      const recoveredStarts: string[] = [];
      const coordinator = new CreationSubmissionCoordinator(
        store,
        {
          async start(record) {
            recoveredStarts.push(record.task.id);
          },
        },
        {
          createId() {
            return "unused-recovery-id";
          },
          now() {
            return "2026-07-22T09:00:00.000Z";
          },
        },
        {
          async admit() {
            throw new Error("Recovery must not run a new-submission admission.");
          },
        },
      );
      assert.deepEqual(await coordinator.recoverPendingStarts(), {
        attempted: 1,
        failed: 0,
        started: 1,
      });
      assert.deepEqual(recoveredStarts, [submission.task.id]);
      await store.releaseHarnessStart({
        leaseId: leaseOne.leaseId,
        submissionId: submission.snapshot.id,
        workspaceId,
      });
      await assert.rejects(
        store.completeHarnessStart({
          leaseId: leaseOne.leaseId,
          submissionId: submission.snapshot.id,
          workspaceId,
        }),
        /no longer current/u,
      );
      assert.deepEqual(
        await store.claimHarnessStart({
          submissionId: submission.snapshot.id,
          workspaceId,
        }),
        { kind: "started" },
      );
    } finally {
      await cleanup(pool, workspaceId, submission).catch(() => undefined);
      await pool.end();
    }
  },
);

test(
  "Postgres terminal successor creates a fresh quote, reservation, snapshot and Harness run exactly once",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    const billingRepository = new PostgresProductBillingRepository(pool);
    const billing = new DurableProductBillingService(billingRepository);
    const store = new PostgresCreationSubmissionStore(
      pool,
      new PostgresCreationSubmissionPersistence(
        new PostgresProductBillingUsageReservation(pool, noOpGrantLots),
      ),
    );
    const suffix = randomUUID();
    const workspaceId = `spine-late-answer-${suffix}`;
    const quoteId = `spine-source-quote-${suffix}`;
    const sourceTaskId = `spine-source-task-${suffix}`;
    const successorTaskId = `spine-successor-task-${suffix}`;
    const cleanupSubmission = reserveRecord(workspaceId, quoteId, suffix);
    const starts: CreationSubmissionRecord[] = [];
    let workIds = 0;
    let packageIds = 0;

    try {
      await operations.migrate();
      await billingRepository.migrate();
      await store.applySchema();
      const sourceQuote = await seedQuote(
        billingRepository,
        workspaceId,
        quoteId,
        sourceTaskId,
      );
      const coordinator = new CreationSubmissionCoordinator(
        store,
        {
          async start(record) {
            starts.push(structuredClone(record));
          },
        },
        {
          createId(prefix) {
            if (prefix === "work") {
              workIds += 1;
              return `spine-work-${workIds}-${suffix}`;
            }
            packageIds += 1;
            return `spine-package-${packageIds}-${suffix}`;
          },
          now() {
            return "2026-07-26T09:00:00.000Z";
          },
        },
        {
          async admit() {
            return {
              identity: { id: "identity-1", revision: "identity-r1" },
              modelPolicy: {
                id: "policy-1",
                mode: "fixed",
                revision: "policy-r1",
              },
              recipeBinding: {
                contentModules: ["social_cover"],
                deliverables: [
                  {
                    aspectRatio: "3:4",
                    id: "copy-main",
                    kind: "copy",
                    order: 0,
                    quantity: 1,
                  },
                ],
                lens: "copy",
              },
              rights: {
                revision: "rights-r1",
                summary: "authorized source assets",
              },
              route: { id: "route-1", revision: "route-r1" },
              taskId: sourceTaskId,
            };
          },
        },
        billing,
      );
      await coordinator.submit(
        coordinatorRequest({
          quoteId,
          quoteRevision: sourceQuote.revision,
          suffix,
          workspaceId,
        }),
      );
      const source = starts[0]!;
      const command = {
        idempotencyKey: `${sourceTaskId}:offer-price:late_answer`,
        questionId: `${sourceTaskId}:offer-price`,
        workflowRevision: 1,
        patch: {
          field: "offer_price",
          value: "398 元",
          reason: "补充当前任务所需的权威事实",
        },
        decision: { state: "accepted" as const, value: "398 元" },
      };
      const successorInput = {
        command,
        request: toHarnessWorkflowInput(
          source.snapshot,
          source.usageReservation,
        ),
        sourceTaskId,
        workflowId: successorTaskId,
        workspaceId,
      };
      const created = await coordinator.submitSemanticSuccessor(successorInput);
      const replayed = await coordinator.submitSemanticSuccessor(successorInput);

      assert.equal(created.replayed, false);
      assert.equal(replayed.replayed, true);
      assert.equal(starts.length, 2);
      const successor = starts[1]!;
      assert.equal(successor.task.id, successorTaskId);
      assert.equal(
        successor.snapshot.semanticDecision?.sourceSnapshotId,
        source.snapshot.id,
      );
      assert.equal(
        successor.snapshot.semanticDecision?.reference.value,
        "398 元",
      );
      assert.notEqual(successor.snapshot.quote.id, source.snapshot.quote.id);
      const persisted = await pool.query<{
        reservation_count: number;
        submission_count: number;
        successor_snapshot: {
          semanticDecision?: { sourceSnapshotId?: string };
        };
      }>(
        `select
           (select count(*)::int
              from execution_spine.creation_submissions
             where workspace_id=$1) as submission_count,
           (select count(*)::int
              from p1_product_billing_usage
             where workspace_id=$1
               and task_id=any($2::text[])) as reservation_count,
           (select submission->'snapshot'
              from execution_spine.creation_submissions
             where workspace_id=$1 and task_id=$3) as successor_snapshot`,
        [workspaceId, [sourceTaskId, successorTaskId], successorTaskId],
      );
      assert.deepEqual(
        {
          reservation_count: persisted.rows[0]?.reservation_count,
          submission_count: persisted.rows[0]?.submission_count,
          sourceSnapshotId:
            persisted.rows[0]?.successor_snapshot.semanticDecision
              ?.sourceSnapshotId,
        },
        {
          reservation_count: 2,
          submission_count: 2,
          sourceSnapshotId: source.snapshot.id,
        },
      );
    } finally {
      await cleanup(pool, workspaceId, cleanupSubmission).catch(
        () => undefined,
      );
      await pool.end();
    }
  },
);

test(
  "a quoted ProductQuote is never auto-confirmed by a Composer reservation",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    const billingRepository = new PostgresProductBillingRepository(pool);
    const store = new PostgresCreationSubmissionStore(
      pool,
      new PostgresCreationSubmissionPersistence(
        new PostgresProductBillingUsageReservation(pool, noOpGrantLots),
      ),
    );
    const suffix = randomUUID();
    const workspaceId = `spine-unconfirmed-${suffix}`;
    const quoteId = `spine-quote-${suffix}`;
    const submission = reserveRecord(workspaceId, quoteId, suffix);

    try {
      await operations.migrate();
      await billingRepository.migrate();
      await store.applySchema();
      const quote = await seedUnconfirmedQuote(
        billingRepository,
        workspaceId,
        quoteId,
      );
      submission.snapshot = createSnapshot({
        quoteId,
        quoteRevision: quote.revision,
        submission,
        workspaceId,
      });

      await assert.rejects(
        store.claim({
          idempotencyKey: "quoted-without-confirmation",
          payloadHash: "payload-quoted",
          submission,
          workspaceId,
        }),
        /requires explicit confirmation/u,
      );
      const unchangedQuote = await billingRepository.getQuote(workspaceId, quoteId);
      assert.equal(unchangedQuote?.lifecycleStatus, "quoted");
      assert.equal(unchangedQuote?.taskId, undefined);
      const counts = await pool.query<{
        packages: number;
        submissions: number;
        tasks: number;
        usage: number;
        works: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM p1_content_packages WHERE workspace_id = $1) AS packages,
           (SELECT count(*)::int FROM p1_content_tasks WHERE workspace_id = $1) AS tasks,
           (SELECT count(*)::int FROM p1_creative_works WHERE workspace_id = $1) AS works,
           (SELECT count(*)::int FROM p1_product_billing_usage WHERE workspace_id = $1) AS usage,
           (SELECT count(*)::int FROM execution_spine.creation_submissions
             WHERE workspace_id = $1) AS submissions`,
        [workspaceId],
      );
      assert.deepEqual(counts.rows[0], {
        packages: 0,
        submissions: 0,
        tasks: 0,
        usage: 0,
        works: 0,
      });
    } finally {
      await cleanup(pool, workspaceId, submission).catch(() => undefined);
      await pool.end();
    }
  },
);

test(
  "Postgres Coordinator replays a settled submission before mutable admission and reserves once",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    const billingRepository = new PostgresProductBillingRepository(pool);
    const store = new PostgresCreationSubmissionStore(
      pool,
      new PostgresCreationSubmissionPersistence(
        new PostgresProductBillingUsageReservation(pool, noOpGrantLots),
      ),
    );
    const suffix = randomUUID();
    const workspaceId = `spine-replay-${suffix}`;
    const quoteId = `spine-quote-${suffix}`;
    const taskId = `spine-task-${suffix}`;
    const cleanupSubmission = reserveRecord(
      workspaceId,
      quoteId,
      suffix,
    );

    try {
      await operations.migrate();
      await billingRepository.migrate();
      await store.applySchema();
      const quote = await seedQuote(
        billingRepository,
        workspaceId,
        quoteId,
        taskId,
      );
      const request = coordinatorRequest({
        quoteId,
        quoteRevision: quote.revision,
        suffix,
        workspaceId,
      });
      let admissionCalls = 0;
      let harnessStarts = 0;
      const coordinator = new CreationSubmissionCoordinator(
        store,
        {
          async start() {
            harnessStarts += 1;
          },
        },
        {
          createId(prefix) {
            return prefix === "work"
              ? `spine-work-${suffix}`
              : `spine-package-${suffix}`;
          },
          now() {
            return "2026-07-22T09:00:00.000Z";
          },
        },
        {
          async admit() {
            admissionCalls += 1;
            const current = await billingRepository.getQuote(
              workspaceId,
              quoteId,
            );
            if (current?.lifecycleStatus !== "confirmed") {
              throw new Error(
                `Mutable admission rejected ${current?.lifecycleStatus ?? "missing"} quote.`,
              );
            }
            return {
              identity: { id: "identity-1", revision: "identity-r1" },
              modelPolicy: {
                id: "policy-1",
                mode: "fixed",
                revision: "policy-r1",
              },
              recipeBinding: {
                contentModules: ["social_cover"],
                deliverables: [
                  {
                    aspectRatio: "3:4",
                    id: "copy-main",
                    kind: "copy",
                    order: 0,
                    quantity: 1,
                  },
                ],
                lens: "copy",
              },
              rights: {
                revision: "rights-r1",
                summary: "authorized source assets",
              },
              route: { id: "route-1", revision: "route-r1" },
              taskId,
            };
          },
        },
      );

      const created = await coordinator.submit(request);
      assert.equal(created.replayed, false);
      const billing = new DurableProductBillingService(billingRepository);
      await billing.dispatchAttempt({
        attemptId: `attempt-${suffix}`,
        deploymentId: "copy-deployment-1",
        providerCost: {
          currency: "CNY",
          estimatedCostMicros: 100,
          evidenceKind: "estimated",
          supplierPriceRevision: "supplier-price-1",
          unit: "request",
          unitPriceMicros: 100,
        },
        taskId,
        workspaceId,
      });
      await billing.settleTask({
        attemptId: `attempt-${suffix}`,
        deploymentId: "copy-deployment-1",
        status: "completed",
        taskId,
        workspaceId,
      });
      assert.equal(
        (await billing.getQuote(quoteId, workspaceId))?.lifecycleStatus,
        "settled",
      );

      const replays = await Promise.all(
        Array.from({ length: 12 }, () => coordinator.submit(request)),
      );
      assert.ok(replays.every((replayed) => replayed.replayed));
      assert.equal(admissionCalls, 1);
      assert.equal(harnessStarts, 1);
      const counts = await pool.query<{
        submissions: number;
        usage: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM execution_spine.creation_submissions
             WHERE workspace_id = $1) AS submissions,
           (SELECT count(*)::int FROM p1_product_billing_usage
             WHERE workspace_id = $1 AND task_id = $2) AS usage`,
        [workspaceId, taskId],
      );
      assert.deepEqual(counts.rows[0], { submissions: 1, usage: 1 });
    } finally {
      await cleanup(pool, workspaceId, cleanupSubmission).catch(
        () => undefined,
      );
      await pool.end();
    }
  },
);

test(
  "Postgres Coordinator reserves image and video shells with the same immutable snapshot and usage lineage",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    const billingRepository = new PostgresProductBillingRepository(pool);
    const store = new PostgresCreationSubmissionStore(
      pool,
      new PostgresCreationSubmissionPersistence(
        new PostgresProductBillingUsageReservation(pool, noOpGrantLots),
      ),
    );
    const workspaceId = `spine-media-${randomUUID()}`;
    const submissions: CreationSubmissionRecord[] = [];

    try {
      await operations.migrate();
      await billingRepository.migrate();
      await store.applySchema();
      for (const lens of ["image", "video"] as const) {
        const suffix = `${lens}-${randomUUID()}`;
        const quoteId = `spine-quote-${suffix}`;
        const submission = reserveRecord(workspaceId, quoteId, suffix, lens);
        submissions.push(submission);
        const quote = await seedQuote(
          billingRepository,
          workspaceId,
          quoteId,
          submission.task.id,
        );
        submission.snapshot = createSnapshot({
          lens,
          quoteId,
          quoteRevision: quote.revision,
          submission,
          workspaceId,
        });

        const claimed = await store.claim({
          idempotencyKey: `submit-${lens}-1`,
          payloadHash: `payload-${lens}`,
          submission,
          workspaceId,
        });
        assert.equal(claimed.kind, "created");
        assert.equal(
          (
            await store.claim({
              idempotencyKey: `submit-${lens}-1`,
              payloadHash: `payload-${lens}`,
              submission,
              workspaceId,
            })
          ).kind,
          "existing",
        );

        const lineage = await pool.query<{
          package_kind: string;
          package_snapshot: unknown;
          resource: string | null;
          snapshot_lens: string;
          usage_id: string;
        }>(
          `SELECT p.payload->>'kind' AS package_kind,
                  p.payload->'source'->'creationExecutionSnapshot' AS package_snapshot,
                  u.payload->>'resource' AS resource,
                  s.submission->'snapshot'->>'lens' AS snapshot_lens,
                  u.usage_id
             FROM execution_spine.creation_submissions s
             JOIN p1_content_packages p
               ON p.workspace_id = s.workspace_id
              AND p.id = s.content_package_id
             JOIN p1_product_billing_usage u
               ON u.workspace_id = s.workspace_id
              AND u.task_id = s.task_id
            WHERE s.workspace_id = $1 AND s.id = $2`,
          [workspaceId, submission.snapshot.id],
        );
        assert.deepEqual(lineage.rows, [
          {
            package_kind: lens === "image" ? "image_text" : "video",
            package_snapshot: {
              id: submission.snapshot.id,
              revision: 1,
              schemaVersion: "creation-execution-snapshot/v1",
            },
            resource: lens,
            snapshot_lens: lens,
            usage_id: submission.usageReservation.id,
          },
        ]);
      }
    } finally {
      await cleanup(pool, workspaceId, submissions[0]!).catch(() => undefined);
      await pool.end();
    }
  },
);

test(
  "a failed product reservation rolls back every Composer shell",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    const billingRepository = new PostgresProductBillingRepository(pool);
    const store = new PostgresCreationSubmissionStore(
      pool,
      new PostgresCreationSubmissionPersistence(
        new PostgresProductBillingUsageReservation(pool, noOpGrantLots),
      ),
    );
    const suffix = randomUUID();
    const workspaceId = `spine-rollback-${suffix}`;
    const submission = reserveRecord(
      workspaceId,
      `missing-quote-${suffix}`,
      suffix,
    );

    try {
      await operations.migrate();
      await billingRepository.migrate();
      await store.applySchema();
      await assert.rejects(
        store.claim({
          idempotencyKey: "missing-quote",
          payloadHash: "payload-missing-quote",
          submission,
          workspaceId,
        }),
        /was not found/u,
      );
      const counts = await pool.query<{
        packages: number;
        submissions: number;
        tasks: number;
        works: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM p1_content_packages
             WHERE workspace_id = $1) AS packages,
           (SELECT count(*)::int FROM p1_content_tasks
             WHERE workspace_id = $1) AS tasks,
           (SELECT count(*)::int FROM p1_creative_works
             WHERE workspace_id = $1) AS works,
           (SELECT count(*)::int FROM execution_spine.creation_submissions
             WHERE workspace_id = $1) AS submissions`,
        [workspaceId],
      );
      assert.deepEqual(counts.rows[0], {
        packages: 0,
        submissions: 0,
        tasks: 0,
        works: 0,
      });
    } finally {
      await cleanup(pool, workspaceId, submission).catch(() => undefined);
      await pool.end();
    }
  },
);

function reserveRecord(
  workspaceId: string,
  quoteId: string,
  suffix: string,
  lens: "copy" | "image" | "video" = "copy",
): CreationSubmissionRecord {
  const taskId = `spine-task-${suffix}`;
  const submission: CreationSubmissionRecord = {
    contentPackage: { expectedRevision: 0, id: `spine-package-${suffix}` },
    snapshot: createSnapshot({
      quoteId,
      quoteRevision: "quote-revision-placeholder",
      lens,
      submission: {
        contentPackage: { expectedRevision: 0, id: `spine-package-${suffix}` },
        task: { id: taskId },
        work: { id: `spine-work-${suffix}` },
      },
      workspaceId,
    }),
    task: { id: taskId },
    usageReservation: {
      id: `spine-usage-${suffix}`,
      // Arbitrary round-trip data, not a pricing statement: this store test
      // only checks that whatever units it is handed come back byte-identical,
      // so video carries a non-1 quantity to keep an always-writes-1 bug
      // visible. What a video run actually reserves (1 成片) is pinned in
      // `composer-http.test.ts`.
      units:
        lens === "video"
          ? [{ resource: "video", quantity: 8 }]
          : [{ resource: lens, quantity: 1 }],
    },
    work: { id: `spine-work-${suffix}` },
  };
  return submission;
}

function coordinatorRequest(input: {
  quoteId: string;
  quoteRevision: string;
  suffix: string;
  workspaceId: string;
}): ComposerSubmissionRequest {
  return {
    actorId: "owner-1",
    briefConfirmation: { id: "brief-1", revision: "brief-r1" },
    briefContext: { id: "brief-context-1", revision: 1 },
    catalogModel: { id: "copy-model-1", revision: "catalog-r1" },
    contentPackagePlatform: "douyin",
    creationMode: "customized",
    deliverable: {
      aspectRatio: "3:4",
      kind: "copy_document",
      quantity: 1,
    },
    distributionTarget: "export",
    idempotencyKey: `submission-${input.suffix}`,
    intent: "为夏日护理项目写一条预约文案",
    quote: { id: input.quoteId, revision: input.quoteRevision },
    recipe: { id: "recipe-1", revision: "recipe-r1" },
    sources: {
      assets: [
        { id: "asset-1", revision: "asset-r1", role: "reference" },
      ],
    },
    surface: { id: "surface-1", revision: "surface-r1" },
    workspaceId: input.workspaceId,
  };
}

async function seedQuote(
  repository: PostgresProductBillingRepository,
  workspaceId: string,
  quoteId: string,
  taskId: string,
  options?: { outputCount?: number; unitRate?: number },
) {
  const billing = new DurableProductBillingService(repository);
  await seedUnconfirmedQuote(repository, workspaceId, quoteId, options);
  return billing.confirm({ quoteId, taskId, workspaceId });
}

async function seedUnconfirmedQuote(
  repository: PostgresProductBillingRepository,
  workspaceId: string,
  quoteId: string,
  options?: { outputCount?: number; unitRate?: number },
) {
  return new DurableProductBillingService(repository).buildQuote({
    billingMode: "per_request",
    catalogModelId: "copy-model-1",
    catalogModelRevision: "catalog-r1",
    frozenCandidateDeploymentIds: ["copy-deployment-1"],
    quoteId,
    quotePolicyRevision: "quote-policy-1",
    routeSnapshotRef: "route-1",
    ...(options?.outputCount !== undefined
      ? { outputCount: options.outputCount }
      : {}),
    unitRate: options?.unitRate ?? 1,
    workspaceId,
  });
}

function createSnapshot(input: {
  lens?: "copy" | "image" | "video";
  quoteId: string;
  quoteRevision: string;
  submission: Pick<
    CreationSubmissionRecord,
    "contentPackage" | "task" | "work"
  >;
  workspaceId: string;
}) {
	const lens = input.lens ?? "copy";
  return createCreationExecutionSnapshot(
    {
      actorId: "owner-1",
      briefConfirmation: { id: "brief-1", revision: "brief-r1" },
      briefContext: { id: "brief-context-1", revision: 1 },
      catalogModel: { id: "copy-model-1", revision: "catalog-r1" },
      contentModules: ["social_cover"],
      contentPackageId: input.submission.contentPackage.id,
      deliverables: [
        {
          id: `${lens}-main`,
          kind: lens,
          order: 1,
          quantity: 1,
          ...(lens === "copy" ? {} : { aspectRatio: "9:16" }),
          ...(lens === "video" ? { durationSeconds: 8 } : {}),
        },
      ],
      expectedContentPackageRevision:
        input.submission.contentPackage.expectedRevision,
      identity: { id: "identity-1", revision: "identity-r1" },
      idempotencyKey: "submission-key",
      creationMode: "customized",
      intent: "为夏日护理项目写一条预约文案",
      lens,
      modelPolicy: { id: "policy-1", mode: "fixed", revision: "policy-r1" },
      platform: { id: "douyin" },
      quote: { id: input.quoteId, revision: input.quoteRevision },
      recipe: { id: "recipe-1", revision: "recipe-r1" },
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
    "2026-07-22T09:00:00.000Z",
  );
}

async function cleanup(
  pool: Pool,
  workspaceId: string,
  submission: CreationSubmissionRecord,
) {
  await pool.query(
    "DELETE FROM execution_spine.creation_submissions WHERE workspace_id = $1",
    [workspaceId],
  );
  await pool.query(
    "DELETE FROM p1_product_billing_usage WHERE workspace_id = $1",
    [workspaceId],
  );
  await pool.query(
    "DELETE FROM p1_product_billing_quotes WHERE workspace_id = $1",
    [workspaceId],
  );
  await pool.query("DELETE FROM p1_content_packages WHERE workspace_id = $1", [
    workspaceId,
  ]);
  await pool.query("DELETE FROM p1_content_tasks WHERE workspace_id = $1", [
    workspaceId,
  ]);
  await pool.query("DELETE FROM p1_creative_works WHERE workspace_id = $1", [
    workspaceId,
  ]);
  void submission;
}
