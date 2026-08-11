import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";

import type { ContentPackage } from "@meiye/contracts";
import { Pool } from "pg";
import { z, type ZodType } from "zod";

import {
  DurableProductBillingService,
  merchantExecutionInputHashes,
} from "../product-billing/durable-service.js";
import { PostgresProductBillingRepository } from "../product-billing/postgres-repository.js";
import { OperationsApplicationService } from "../operations/application-service.js";
import { OperationsFoundationModule } from "../operations/foundation-module.js";
import { PostgresOperationsRepository } from "../operations/postgres-repository.js";
import {
  createDefaultCatalogModels,
  createDefaultDeployments,
  ModelSupplyApplicationService,
  RecordedProviderExecutionPort,
  type StructuredObjectExecutor,
} from "../model-supply/index.js";
import { ModelSupplyStructuredNodeRunner } from "../model-supply/structured-node-runner.js";
import {
  createCreationExecutionSnapshot,
  type ComposerSubmissionRequest,
} from "./creation-execution-snapshot.js";
import { PostgresContentPackageDestinationProjection } from "./content-package-destination-projection.js";
import {
  PostgresCreationSubmissionPersistence,
  PostgresCreationSubmissionStore,
  PostgresProductBillingUsageReservation,
} from "./postgres-creation-submission-store.js";
import {
	asAgentThreadIdentity,
  CreationSubmissionCoordinator,
  type CreationSubmissionRecord,
} from "./submission-coordinator.js";
import { toHarnessWorkflowInput } from "./creation-stage-port.js";
import { buildSemanticDecisionResumption } from "../harness/semantic-decision-resumption.js";
import {
  nameHarnessIntent,
} from "../harness/structured-nodes.js";
import { ComposerPlanSessionCoordinator } from "../agent-session/composer-plan-session.js";
import { PostgresAgentSessionStore } from "../agent-session/postgres-agent-session-store.js";
import { PostgresMarketingPlanStore } from "../agent-session/postgres-plan-store.js";
import {
  createFixturePlanCompilerPorts,
  PlanCompiler,
} from "../agent-session/plan-compiler.js";
import { PostgresGrantLotLedger } from "../foundation/postgres-grant-lot.js";
import { PostgresCreditLedger } from "../credit-billing/postgres-credit-ledger.js";
import { GrantLotAwareProductEntitlementService } from "../foundation/grant-lot-entitlement-service.js";
import { MemoryFoundationRepository } from "../foundation/memory-repository.js";
import { frozenHarnessPrompt } from '../harness/frozen-prompt.testing.js';

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
      await pool.query(
		"INSERT INTO workspaces (id, name) VALUES ($1, 'Execution spine store test')",
        [workspaceId],
      );
      const quote = await seedQuote(
        billingRepository,
        workspaceId,
        quoteId,
        submission.task.id,
      );
      submission.snapshot = createSnapshot({
        contentPackagePlatform: "wechat_moments",
        distributionTarget: "manual_copy",
        platformId: "wechat_moments",
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
      const executionPlanFreeze = recoveryExecutionPlanFreeze(submission);
      const clarificationCoordinator = new CreationSubmissionCoordinator(
        store,
        { async start() {}, async preparePendingConfirmation() {} },
        {
          createId() {
            return "unused-clarification-id";
          },
          now() {
            return "2026-07-22T09:05:00.000Z";
          },
        },
        { async admit() { throw new Error("not used"); } },
        undefined,
        {
          async prepare() {
            throw new Error("not used");
          },
          async answerClarification(input) {
            assert.equal(input.merchantAnswer, "主要面向第一次到店的新客");
            input.submission.executionPlanFreeze = executionPlanFreeze;
            return { threadId: asAgentThreadIdentity("thread-clarify"), runId: "run-clarify", makeReady: false };
          },
        },
      );
      await clarificationCoordinator.answerClarification({
        workspaceId,
        taskId: submission.task.id,
        merchantAnswer: "主要面向第一次到店的新客",
      });
      submission.executionPlanFreeze = executionPlanFreeze;
      const restartedStore = new PostgresCreationSubmissionStore(
        pool,
        new PostgresCreationSubmissionPersistence(
          new PostgresProductBillingUsageReservation(pool, noOpGrantLots),
        ),
      );
      const recoveredAfterCrash = await restartedStore.readByTask({
        workspaceId,
        taskId: submission.task.id,
      });
      assert.deepEqual(
        recoveredAfterCrash?.executionPlanFreeze,
        executionPlanFreeze,
      );
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
        submission_platform: string;
        submission_target: string;
      }>(
        `SELECT c.task_id, c.work_id, c.content_package_id,
                c.usage_reservation_id, c.quote_id, c.route_snapshot_id,
                p.payload->'source'->'creationExecutionSnapshot' AS execution_snapshot,
                c.submission->'snapshot'->>'contentPackagePlatform' AS submission_platform,
                c.submission->'snapshot'->>'distributionTarget' AS submission_target
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
          modelSelection: {
            source: "current_selection",
            catalogModelId: "copy-model-1",
            platformConfigRevision: null,
          },
          revision: 1,
          schemaVersion: "creation-execution-snapshot/v1",
        },
        quote_id: quoteId,
        route_snapshot_id: "route-1",
        task_id: submission.task.id,
        usage_reservation_id: submission.usageReservation.id,
        work_id: submission.work.id,
        submission_platform: "wechat_moments",
        submission_target: "manual_copy",
      });
      const destinationProjection =
        new PostgresContentPackageDestinationProjection(pool);
      assert.deepEqual(
        await destinationProjection.resolve({
          references: [
            {
              packageId: submission.contentPackage.id,
              snapshotId: submission.snapshot.id,
            },
          ],
          workspaceId,
        }),
        [
          {
            contentPackagePlatform: "wechat_moments",
            distributionTarget: "manual_copy",
            packageId: submission.contentPackage.id,
            snapshotId: submission.snapshot.id,
          },
        ],
      );
      let mixedQueryCount = 0;
      const mixedDestinationProjection =
        new PostgresContentPackageDestinationProjection({
          async query() {
            mixedQueryCount += 1;
            return {
              rows: [
                {
                  content_package_id: submission.contentPackage.id,
                  snapshot: submission.snapshot,
                  snapshot_id: submission.snapshot.id,
                },
                {
                  content_package_id: "package-malformed",
                  snapshot: { id: "snapshot-malformed" },
                  snapshot_id: "snapshot-malformed",
                },
              ],
            };
          },
        } as unknown as Pick<Pool, "query">);
      assert.deepEqual(
        await mixedDestinationProjection.resolve({
          references: [
            {
              packageId: submission.contentPackage.id,
              snapshotId: submission.snapshot.id,
            },
            {
              packageId: "package-malformed",
              snapshotId: "snapshot-malformed",
            },
          ],
          workspaceId,
        }),
        [
          {
            contentPackagePlatform: "wechat_moments",
            distributionTarget: "manual_copy",
            packageId: submission.contentPackage.id,
            snapshotId: submission.snapshot.id,
          },
        ],
      );
      assert.equal(mixedQueryCount, 1);
      const applicationService = new OperationsApplicationService(operations, {
        canvasExporter: {
          async export() {
            throw new Error("not used");
          },
        },
        contentPackageDestinationProjection: destinationProjection,
        imageGenerator: {
          async submit() {
            throw new Error("not used");
          },
        },
        notifier: { async send() {} },
      });
      const operationContext = {
        actor: "worker" as const,
        correlationId: `destination-projection-${suffix}`,
        userId: "worker-1",
        workspaceId,
      };
      const projectedDetail = await applicationService.getContentPackage(
        operationContext,
        submission.contentPackage.id,
      );
      const projectedList =
        await applicationService.listContentPackages(operationContext);
      const publicDetail = (await new OperationsFoundationModule(
        applicationService,
      ).query({
        context: operationContext,
        input: {
          action: "content_package",
          payload: { packageId: submission.contentPackage.id },
        },
      })) as ContentPackage;
      for (const projected of [
        projectedDetail,
        projectedList[0],
        publicDetail,
      ]) {
        assert.equal(
          projected?.source.creationExecutionSnapshot?.contentPackagePlatform,
          "wechat_moments",
        );
        assert.equal(
          projected?.source.creationExecutionSnapshot?.distributionTarget,
          "manual_copy",
        );
      }
      for (const mismatched of [
        {
          references: [
            {
              packageId: `${submission.contentPackage.id}-foreign`,
              snapshotId: submission.snapshot.id,
            },
          ],
          workspaceId,
        },
        {
          references: [
            {
              packageId: submission.contentPackage.id,
              snapshotId: `${submission.snapshot.id}-foreign`,
            },
          ],
          workspaceId,
        },
        {
          references: [
            {
              packageId: submission.contentPackage.id,
              snapshotId: submission.snapshot.id,
            },
          ],
          workspaceId: `${workspaceId}-foreign`,
        },
      ]) {
        assert.deepEqual(await destinationProjection.resolve(mismatched), []);
      }
      await pool.query(
        `UPDATE execution_spine.creation_submissions
            SET submission = submission #- '{snapshot,distributionTarget}'
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, submission.snapshot.id],
      );
      assert.deepEqual(
        await destinationProjection.resolve({
          references: [
            {
              packageId: submission.contentPackage.id,
              snapshotId: submission.snapshot.id,
            },
          ],
          workspaceId,
        }),
        [],
      );
      // Restore only the path removed above; overwriting the whole row with
      // the local `submission` object would clobber the `agentBinding` the
      // clarification flow already persisted server-side (the local object
      // never mirrors that field back).
      await pool.query(
        `UPDATE execution_spine.creation_submissions
            SET submission = jsonb_set(
              submission, '{snapshot,distributionTarget}', $3::jsonb
            )
          WHERE workspace_id = $1 AND id = $2`,
        [
          workspaceId,
          submission.snapshot.id,
          JSON.stringify(submission.snapshot.distributionTarget),
        ],
      );
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
      const recoverable = (await store.listRecoverableHarnessStarts({ limit: 10 }))
        .filter(
          (candidate) => candidate.submission.snapshot.workspaceId === workspaceId,
        );
      assert.deepEqual(
        recoverable.map((candidate) => candidate.submission.snapshot.id),
        [submission.snapshot.id],
      );
      assert.deepEqual(
        recoverable[0]?.submission.executionPlanFreeze,
        executionPlanFreeze,
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
            return {
              executionConfirmationRequestId:
                'confirmation:authority-digest-recovered',
            };
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
      // V31-33: do not assert global attempted counts — other workspaces may
      // hold recoverable rows on a shared DB. Scope to this workspace's start.
      const recoveryOutcome = await coordinator.recoverPendingStarts();
      assert.ok(recoveryOutcome.attempted >= 1);
      assert.ok(recoveryOutcome.started >= 1);
      assert.deepEqual(
        recoveredStarts.filter((taskId) => taskId === submission.task.id),
        [submission.task.id],
      );
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
  "Postgres confirmation outbox expiry refunds an undispatched credit hold",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    const billingRepository = new PostgresProductBillingRepository(pool);
    const creditLedger = new PostgresCreditLedger(pool);
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
    const suffix = randomUUID();
    const workspaceId = `spine-outbox-${suffix}`;
    const quoteId = `spine-outbox-quote-${suffix}`;
    const submission = reserveRecord(workspaceId, quoteId, suffix);
    const boundarySuffix = randomUUID();
    const boundaryQuoteId = `spine-outbox-quote-${boundarySuffix}`;
    const boundarySubmission = reserveRecord(
      workspaceId,
      boundaryQuoteId,
      boundarySuffix,
    );
    const dispatchedSuffix = randomUUID();
    const dispatchedQuoteId = `spine-outbox-quote-${dispatchedSuffix}`;
    const dispatchedSubmission = reserveRecord(
      workspaceId,
      dispatchedQuoteId,
      dispatchedSuffix,
    );
    try {
      await operations.migrate();
      await billingRepository.migrate();
      const migrationClient = await pool.connect();
      try {
        await creditLedger.migrate(migrationClient);
      } finally {
        migrationClient.release();
      }
      await store.applySchema();
      await pool.query(
        "INSERT INTO workspaces (id, name) VALUES ($1, 'Confirmation outbox expiry test')",
        [workspaceId],
      );
      await creditLedger.grant({
        id: `outbox-credit-${suffix}`,
        workspaceId,
        credits: 10,
        expirationDate: "2026-09-01T00:00:00.000Z",
        transactionType: "PURCHASE_PACKAGE",
        sourceRef: `outbox-${suffix}`,
        createdAt: "2026-07-01T00:00:00.000Z",
      });
      const quote = await seedQuote(
        billingRepository,
        workspaceId,
        quoteId,
        submission.task.id,
        { creditCost: 4, outputCount: 1, unitRate: 4 },
      );
      submission.snapshot = createSnapshot({
        contentPackagePlatform: "wechat_moments",
        distributionTarget: "manual_copy",
        platformId: "wechat_moments",
        quoteId,
        quoteRevision: quote.revision,
        submission,
        workspaceId,
      });
      submission.usageReservation = {
        id: submission.usageReservation.id,
        credits: 4,
        units: [],
      };
      submission.executionPlanFreeze = recoveryExecutionPlanFreeze(
        submission,
        "merchant_confirmed",
      );
      submission.confirmationDispatch = {
        requestId: `confirmation:${submission.task.id}`,
        state: "pending",
        expiresAt: "2026-07-01T00:00:01.000Z",
      };
      await store.claim({
        idempotencyKey: `outbox-${suffix}`,
        payloadHash: `payload-${suffix}`,
        submission,
        workspaceId,
      });
      assert.equal(
        (await creditLedger.project(workspaceId, submission.snapshot.createdAt))
          .availableCredits,
        6,
      );

      assert.equal(
        await store.expireUndispatchedConfirmationHolds({ limit: 10 }),
        1,
      );
      assert.equal(
        (await creditLedger.project(workspaceId, new Date().toISOString()))
          .availableCredits,
        10,
      );
      assert.equal(
        (await billingRepository.getUsage(workspaceId, submission.task.id))
          ?.status,
        "refunded",
      );
      assert.equal(
        (await billingRepository.getQuote(workspaceId, quoteId))
          ?.lifecycleStatus,
        "refunded",
      );
      const receipt = await store.readReceipt({
        workspaceId,
        idempotencyKey: `outbox-${suffix}`,
        payloadHash: `payload-${suffix}`,
      });
      assert.equal(
        receipt.kind === "existing"
          ? receipt.submission.confirmationDispatch?.state
          : null,
        "expired",
      );
      assert.deepEqual(
        (await store.listRecoverableHarnessStarts({ limit: 100 })).filter(
          (candidate) =>
            candidate.submission.snapshot.workspaceId === workspaceId,
        ),
        [],
      );
      assert.equal(
        await store.expireUndispatchedConfirmationHolds({ limit: 10 }),
        0,
      );

      const boundaryQuote = await seedQuote(
        billingRepository,
        workspaceId,
        boundaryQuoteId,
        boundarySubmission.task.id,
        { creditCost: 4 },
      );
      boundarySubmission.snapshot = createSnapshot({
        contentPackagePlatform: "wechat_moments",
        distributionTarget: "manual_copy",
        platformId: "wechat_moments",
        quoteId: boundaryQuoteId,
        quoteRevision: boundaryQuote.revision,
        submission: boundarySubmission,
        workspaceId,
      });
      boundarySubmission.usageReservation = {
        id: boundarySubmission.usageReservation.id,
        credits: 4,
        units: [],
      };
      boundarySubmission.executionPlanFreeze = recoveryExecutionPlanFreeze(
        boundarySubmission,
        "merchant_confirmed",
      );
      boundarySubmission.confirmationDispatch = {
        requestId: `confirmation:${boundarySubmission.task.id}`,
        state: "pending",
        expiresAt: "2026-07-01T00:00:01.000Z",
      };
      await store.claim({
        idempotencyKey: `outbox-boundary-${boundarySuffix}`,
        payloadHash: `payload-boundary-${boundarySuffix}`,
        submission: boundarySubmission,
        workspaceId,
      });

      assert.deepEqual(
        await store.claimHarnessStart({
          submissionId: boundarySubmission.snapshot.id,
          workspaceId,
        }),
        { kind: "failed" },
      );
      assert.equal(
        (await creditLedger.project(workspaceId, new Date().toISOString()))
          .availableCredits,
        10,
      );
      assert.equal(
        (
          await billingRepository.getUsage(
            workspaceId,
            boundarySubmission.task.id,
          )
        )?.status,
        "refunded",
      );

      const dispatchedQuote = await seedQuote(
        billingRepository,
        workspaceId,
        dispatchedQuoteId,
        dispatchedSubmission.task.id,
        { creditCost: 4 },
      );
      dispatchedSubmission.snapshot = createSnapshot({
        contentPackagePlatform: "wechat_moments",
        distributionTarget: "manual_copy",
        platformId: "wechat_moments",
        quoteId: dispatchedQuoteId,
        quoteRevision: dispatchedQuote.revision,
        submission: dispatchedSubmission,
        workspaceId,
      });
      dispatchedSubmission.usageReservation = {
        id: dispatchedSubmission.usageReservation.id,
        credits: 4,
        units: [],
      };
      dispatchedSubmission.executionPlanFreeze = recoveryExecutionPlanFreeze(
        dispatchedSubmission,
        "merchant_confirmed",
      );
      // The atomic prepare-before-claim order (V31-39) always sets these two
      // together, so a persisted freeze without a binding is not a state
      // real production can reach; recovery correctly refuses to guess a
      // binding when it has no agentPlanning to re-derive one.
      dispatchedSubmission.agentBinding = {
        threadId: asAgentThreadIdentity(`thread-${dispatchedSuffix}`),
        runId: `run-${dispatchedSuffix}`,
      };
      dispatchedSubmission.confirmationDispatch = {
        state: "pending",
        expiresAt: "2099-01-01T00:00:00.000Z",
      };
      await store.claim({
        idempotencyKey: `outbox-dispatched-${dispatchedSuffix}`,
        payloadHash: `payload-dispatched-${dispatchedSuffix}`,
        submission: dispatchedSubmission,
        workspaceId,
      });
      const dispatchedLease = await store.claimHarnessStart({
        submissionId: dispatchedSubmission.snapshot.id,
        workspaceId,
      });
      assert.equal(dispatchedLease.kind, "start");
      if (dispatchedLease.kind !== "start") {
        throw new Error("Expected a dispatched Harness lease.");
      }
      const durableDispatch = await store.markHarnessStartDispatched({
        leaseId: dispatchedLease.leaseId,
        submissionId: dispatchedSubmission.snapshot.id,
        workspaceId,
      });
      assert.deepEqual(durableDispatch.confirmationDispatch, {
        state: "dispatched",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      await pool.query(
        `UPDATE execution_spine.creation_submissions
            SET harness_lease_expires_at = clock_timestamp() - interval '1 second',
                submission = jsonb_set(
                  submission,
                  '{confirmationDispatch,expiresAt}',
                  to_jsonb('2026-07-01T00:00:01.000Z'::text),
                  true
                )
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, dispatchedSubmission.snapshot.id],
      );
      assert.equal(
        await store.expireUndispatchedConfirmationHolds({ limit: 10 }),
        0,
      );
      assert.equal(
        (await billingRepository.getUsage(workspaceId, dispatchedSubmission.task.id))
          ?.status,
        "reserved",
      );
      const recoveredTaskIds: string[] = [];
      const recovery = new CreationSubmissionCoordinator(
        store,
        {
          async start(record) {
            recoveredTaskIds.push(record.task.id);
            assert.equal(record.confirmationDispatch?.state, "dispatched");
            return {
              executionConfirmationRequestId:
                "confirmation:authority-digest-after-crash",
            };
          },
        },
        {
          createId() {
            return "unused-crash-recovery-id";
          },
          now() {
            return "2026-08-09T00:00:00.000Z";
          },
        },
        {
          async admit() {
            throw new Error("Recovery must not create a new admission.");
          },
        },
      );
      // V31-33: workspace-scoped assertion (global attempted is multi-tenant).
      const crashRecovery = await recovery.recoverPendingStarts();
      assert.ok(crashRecovery.attempted >= 1);
      assert.ok(crashRecovery.started >= 1);
      assert.deepEqual(
        recoveredTaskIds.filter(
          (taskId) => taskId === dispatchedSubmission.task.id,
        ),
        [dispatchedSubmission.task.id],
      );
      const recoveredReceipt = await store.readReceipt({
        workspaceId,
        idempotencyKey: `outbox-dispatched-${dispatchedSuffix}`,
        payloadHash: `payload-dispatched-${dispatchedSuffix}`,
      });
      assert.equal(recoveredReceipt.kind, "existing");
      if (recoveredReceipt.kind === "existing") {
        assert.deepEqual(recoveredReceipt.submission.confirmationDispatch, {
          requestId: "confirmation:authority-digest-after-crash",
          state: "dispatched",
          expiresAt: "2026-07-01T00:00:01.000Z",
        });
      }
    } finally {
      await cleanup(pool, workspaceId, submission).catch(() => undefined);
      await cleanup(pool, workspaceId, boundarySubmission).catch(
        () => undefined,
      );
      await cleanup(pool, workspaceId, dispatchedSubmission).catch(
        () => undefined,
      );
      await pool.query("DELETE FROM workspaces WHERE id = $1", [workspaceId])
        .catch(() => undefined);
      await pool.end();
    }
  },
);

test(
  "Postgres start-dispatch and start-completion replays stay idempotent and reject a stale lease",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresCreationSubmissionStore(pool, {
      async reserve() {},
    });
    const suffix = randomUUID();
    const workspaceId = `spine-dispatch-replay-${suffix}`;
    const submission = reserveRecord(
      workspaceId,
      `spine-dispatch-quote-${suffix}`,
      suffix,
    );
    submission.usageReservation = {
      id: submission.usageReservation.id,
      credits: 4,
      units: [],
    };
    submission.executionPlanFreeze = recoveryExecutionPlanFreeze(
      submission,
      "merchant_confirmed",
    );
    submission.confirmationDispatch = {
      state: "pending",
      expiresAt: "2099-01-01T00:00:00.000Z",
    };

    try {
      await store.applySchema();
      await store.claim({
        idempotencyKey: `dispatch-replay-${suffix}`,
        payloadHash: `payload-dispatch-replay-${suffix}`,
        submission,
        workspaceId,
      });
      const lease = await store.claimHarnessStart({
        submissionId: submission.snapshot.id,
        workspaceId,
      });
      assert.equal(lease.kind, "start");
      if (lease.kind !== "start") throw new Error("Expected a start lease.");
      const leasedStart = {
        leaseId: lease.leaseId,
        submissionId: submission.snapshot.id,
        workspaceId,
      };

      // A retried dispatch marker must not become a second arming event.
      const firstDispatch = await store.markHarnessStartDispatched(leasedStart);
      const replayedDispatch =
        await store.markHarnessStartDispatched(leasedStart);
      assert.deepEqual(firstDispatch.confirmationDispatch, {
        state: "dispatched",
        expiresAt: "2099-01-01T00:00:00.000Z",
      });
      assert.deepEqual(
        replayedDispatch.confirmationDispatch,
        firstDispatch.confirmationDispatch,
      );

      // Negative exit: nobody outside the current lease may arm or close it.
      const foreignLease = {
        leaseId: randomUUID(),
        submissionId: submission.snapshot.id,
        workspaceId,
      };
      await assert.rejects(
        () => store.markHarnessStartDispatched(foreignLease),
        /no longer current/,
      );
      await assert.rejects(
        () => store.completeHarnessStart(foreignLease),
        /no longer current/,
      );

      const dispatch = {
        requestId: `confirmation:${submission.task.id}`,
        state: "dispatched" as const,
        expiresAt: "2099-01-01T00:00:00.000Z",
      };
      await store.completeHarnessStart({
        ...leasedStart,
        confirmationDispatch: dispatch,
      });
      // Replay after the authority ID landed is a no-op, not a second start.
      await store.completeHarnessStart({
        ...leasedStart,
        confirmationDispatch: dispatch,
      });
      assert.deepEqual(
        await store.claimHarnessStart({
          submissionId: submission.snapshot.id,
          workspaceId,
        }),
        { kind: "started" },
      );
      const receipt = await store.readReceipt({
        workspaceId,
        idempotencyKey: `dispatch-replay-${suffix}`,
        payloadHash: `payload-dispatch-replay-${suffix}`,
      });
      assert.equal(receipt.kind, "existing");
      if (receipt.kind === "existing") {
        assert.deepEqual(receipt.submission.confirmationDispatch, dispatch);
      }
      // A started submission is out of recovery scope entirely.
      assert.equal(
        (await store.listRecoverableHarnessStarts({ limit: 100 })).some(
          (candidate) =>
            candidate.submission.snapshot.id === submission.snapshot.id,
        ),
        false,
      );
    } finally {
      await pool.query(
        `DELETE FROM execution_spine.creation_submissions
         WHERE workspace_id=$1`,
        [workspaceId],
      ).catch(() => undefined);
      await pool.end();
    }
  },
);

test(
  "Postgres Coordinator fences a permanently failed Harness start out of recovery",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresCreationSubmissionStore(pool, {
      async reserve() {},
    });
    const suffix = randomUUID();
    const workspaceId = `spine-start-failure-${suffix}`;
    const submissionId = `submission-start-failure-${suffix}`;

    try {
      await store.applySchema();
      await pool.query(
        `INSERT INTO execution_spine.creation_submissions
           (id, workspace_id, idempotency_key, payload_hash, submission,
            harness_state, task_id, created_at)
         VALUES ($1,$2,$3,$3,'{}'::jsonb,'reserved',$4,clock_timestamp())`,
        [
          submissionId,
          workspaceId,
          `idempotency-${suffix}`,
          `task-start-failure-${suffix}`,
        ],
      );
      for (let attempt = 1; attempt <= 5; attempt += 1) {
        const claim = await store.claimHarnessStart({
          submissionId,
          workspaceId,
        });
        assert.equal(claim.kind, "start");
        if (claim.kind !== "start") throw new Error("Expected a start lease.");
        assert.equal(claim.attempts, attempt);
        if (attempt < 5) {
          await store.releaseHarnessStart({
            leaseId: claim.leaseId,
            submissionId,
            workspaceId,
          });
        } else {
          assert.equal(
            await store.failHarnessStart({
              leaseId: claim.leaseId,
              submissionId,
              workspaceId,
            }),
            true,
          );
        }
      }
      assert.deepEqual(
        await store.claimHarnessStart({ submissionId, workspaceId }),
        { kind: "failed" },
      );
      assert.equal(
        (
          await store.listRecoverableHarnessStarts({ limit: 100 })
        ).some((candidate) => candidate.submission.snapshot.id === submissionId),
        false,
      );
    } finally {
      await pool.query(
        `DELETE FROM execution_spine.creation_submissions
         WHERE workspace_id=$1`,
        [workspaceId],
      ).catch(() => undefined);
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
              modelSelection: {
                source: "platform_default",
                catalogModelId: "copy-model-1",
                platformConfigRevision: "admin-config:41",
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
              modelSelection: {
                source: "platform_default",
                catalogModelId: "copy-model-1",
                platformConfigRevision: "admin-config:41",
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
          submission_platform: string;
          submission_target: string;
          usage_id: string;
        }>(
          `SELECT p.payload->>'kind' AS package_kind,
                  p.payload->'source'->'creationExecutionSnapshot' AS package_snapshot,
                  u.payload->>'resource' AS resource,
                  s.submission->'snapshot'->>'lens' AS snapshot_lens,
                  s.submission->'snapshot'->>'contentPackagePlatform' AS submission_platform,
                  s.submission->'snapshot'->>'distributionTarget' AS submission_target,
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
              modelSelection: {
                source: "current_selection",
                catalogModelId: "copy-model-1",
                platformConfigRevision: null,
              },
              revision: 1,
              schemaVersion: "creation-execution-snapshot/v1",
            },
            resource: lens,
            snapshot_lens: lens,
            submission_platform: "douyin",
            submission_target: "export",
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
  "Postgres production assembly freezes the admission root without Product grounding",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    const billingRepository = new PostgresProductBillingRepository(pool);
    const store = new PostgresCreationSubmissionStore(
      pool,
      new PostgresCreationSubmissionPersistence(
        new PostgresProductBillingUsageReservation(
          pool,
          noOpGrantLots,
        ),
      ),
    );
    const suffix = randomUUID();
    const workspaceId = `spine-assembly-binding-${suffix}`;
    const quoteId = `spine-assembly-quote-${suffix}`;
    const submission = reserveRecord(workspaceId, quoteId, suffix);
    const billing = new DurableProductBillingService(billingRepository);

    try {
      await operations.migrate();
      await billingRepository.migrate();
      await store.applySchema();
      const quote = await billing.buildQuote({
        billingMode: "per_request",
        catalogModelId: "deepseek-v4-pro",
        catalogModelRevision: "catalog-r1",
        operation: "copy.generate",
        outputCount: 1,
        quoteId,
        quotePolicyRevision: "quote-policy-1",
        submissionContractHash: `signed-submission-${suffix}`,
        unitRate: 1,
        workspaceId,
      });
      const confirmed = await billing.confirm({
        quoteId,
        taskId: submission.task.id,
        workspaceId,
      });
      submission.snapshot = createSnapshot({
        catalogModelId: "deepseek-v4-pro",
        quoteId,
        quoteRevision: confirmed.revision,
        submission,
        workspaceId,
      });
      const rootSubmissionInput = {
        input: {
          inputAssets: submission.snapshot.sources.assets.map((asset) => ({
            assetId: asset.id,
            role: asset.role,
          })),
          referenceAssetIds: submission.snapshot.sources.assets.map(
            (asset) => asset.id,
          ),
        },
        prompt: submission.snapshot.intent.text,
      };
      let auxiliaryProviderIo = 0;
      const modelSupply = new ModelSupplyApplicationService({
        deployments: createDefaultDeployments({
          activatedDeploymentIds: ["deepseek-v4-pro-direct"],
          activationEvidenceStatus: "recorded",
        }),
        execution: new RecordedProviderExecutionPort(),
        merchantExecutionBilling: billing,
        models: createDefaultCatalogModels(),
        referenceAssets: {
          async inspect(_workspaceId, assetIds) {
            return assetIds.map((assetId) => ({
              assetId,
              classificationSource: "server_fact" as const,
              contentType: "image/png" as const,
              dataClass: [],
              kind: "resolved" as const,
              rightsRevision: "rights-r1",
              sha256: "0".repeat(64),
            }));
          },
          async resolve() {
            throw new Error("Copy execution does not resolve media bytes.");
          },
        },
      });
      const structuredExecutor: StructuredObjectExecutor = {
        supportsCatalogModel(catalogModelId) {
          return catalogModelId === "deepseek-v4-pro";
        },
        async generate<Output>(input: {
          schema: ZodType<Output>;
          schemaName: string;
        }) {
          auxiliaryProviderIo += 1;
          return {
            output: input.schema.parse(
              input.schemaName === "harness_copy_candidate_v1"
                ? {
                    body: "真实门店护理记录",
                    title: "夏日护理",
                  }
                : {
                    blockingGap: null,
                    deliveryLayer: "copy",
                    implicitConstraints: [],
                    normalizedIntent: submission.snapshot.intent.text,
                    relevantAssetCategories: ["store"],
                    route: "customized",
                    taskType: "daily_service_exposure",
                    usedAssetCategories: ["store"],
                  },
            ) as Output,
            providerTaskRef: `provider-${submission.task.id}`,
            usage: { inputTokens: 10, outputTokens: 20 },
          };
        },
        providerCost(usage) {
          return { amount: 0.01, currency: "CNY", usage };
        },
      };
      const createStructuredRunner = () =>
        new ModelSupplyStructuredNodeRunner({
          actorId: submission.snapshot.actorId,
          application: modelSupply,
          billingQuoteRevision: confirmed.revision,
          billingTaskId: submission.task.id,
          executor: structuredExecutor,
          selection: {
            catalogModelId: "deepseek-v4-pro",
            mode: "fixed",
          },
          workspaceId,
        });
      const runNaming = (runner: ModelSupplyStructuredNodeRunner) =>
        nameHarnessIntent(
          {
            prompt: frozenHarnessPrompt('intentNaming'),
            workflowId: submission.task.id,
            workflowRevision: submission.snapshot.revision,
            creationMode: submission.snapshot.creationMode,
            intent: {
              assetReferences: submission.snapshot.sources.assets.map(
                (asset) => asset.id,
              ),
              context: {
                intent: submission.snapshot.intent.text,
                sourceSummaries: [],
                workId: submission.work.id,
              },
            },
          },
          runner,
        );
      const finalPrompt = "Generate the accepted summer-care deliverable.";
      const finalInstructions = "Return the deliverable copy candidate.";
      const runFinal = (
        runner: ModelSupplyStructuredNodeRunner,
        prompt = finalPrompt,
        instructions = finalInstructions,
      ) =>
        runner.run({
          effectIdempotencyKey: `wf:${submission.task.id}:s4:copy-final`,
          instructions,
          prompt,
          schema: z
            .object({ body: z.string(), title: z.string() })
            .strict(),
          schemaName: "harness_copy_candidate_v1",
          schemaRevision: "copy-candidate-v1",
        });

      await assert.rejects(
        runNaming(createStructuredRunner()),
        /complete reserved credit quote contract/u,
      );
      await assert.rejects(
        runFinal(createStructuredRunner()),
        /complete reserved credit quote contract/u,
      );
      assert.equal(auxiliaryProviderIo, 0);
      assert.equal(modelSupply.attempts().length, 0);
      assert.equal(
        (
          await store.claim({
            idempotencyKey: `assembly-submit-${suffix}`,
            payloadHash: `assembly-payload-${suffix}`,
            submission,
            workspaceId,
          })
        ).kind,
        "created",
      );

      const contract = await billing.readMerchantExecutionContract({
        taskId: submission.task.id,
        workspaceId,
      });
      const signedHashes = merchantExecutionInputHashes(rootSubmissionInput);
      assert.deepEqual(
        {
          inputAssetsHash: contract.submissionInputAssetsHash,
          promptHash: contract.submissionPromptHash,
          referenceAssetsHash: contract.submissionReferenceAssetsHash,
        },
        signedHashes,
      );

      const named = await runNaming(createStructuredRunner());
      assert.equal(
        named.declaration.normalizedIntent,
        submission.snapshot.intent.text,
      );
      assert.equal(auxiliaryProviderIo, 1);
      assert.equal(modelSupply.attempts().length, 1);
      const final = await runFinal(createStructuredRunner());
      assert.deepEqual(final.output, {
        body: "真实门店护理记录",
        title: "夏日护理",
      });
      assert.equal(modelSupply.attempts().length, 2);
      assert.equal(auxiliaryProviderIo, 2);
      await assert.rejects(
        runFinal(createStructuredRunner(), "Drifted provider prompt."),
        /already bound to another merchant execution/u,
      );
      assert.equal(auxiliaryProviderIo, 2);
      assert.equal(modelSupply.attempts().length, 2);
      await assert.rejects(
        runFinal(
          createStructuredRunner(),
          finalPrompt,
          "Drifted provider instructions.",
        ),
        /already bound to another merchant execution/u,
      );
      assert.equal(auxiliaryProviderIo, 2);
      assert.equal(modelSupply.attempts().length, 2);
      const replay = await runFinal(createStructuredRunner());
      assert.deepEqual(replay.output, final.output);
      assert.equal(auxiliaryProviderIo, 2);
      const execution = await billingRepository.getMerchantExecution(
        workspaceId,
        submission.task.id,
        `merchant-execution:${submission.task.id}:wf:${submission.task.id}:s4:copy-final`,
      );
      assert.equal(execution?.status, "completed");
      assert.deepEqual(execution?.inputSnapshot, {
        input: null,
        instructions: finalInstructions,
        prompt: finalPrompt,
        schema: {
          $schema: "https://json-schema.org/draft/2020-12/schema",
          additionalProperties: false,
          properties: {
            body: { type: "string" },
            title: { type: "string" },
          },
          required: ["body", "title"],
          type: "object",
        },
        schemaName: "harness_copy_candidate_v1",
        schemaRevision: "copy-candidate-v1",
        streaming: false,
      });
    } finally {
      await pool
        .query(
          "DELETE FROM p1_product_billing_merchant_executions WHERE workspace_id = $1",
          [workspaceId],
        )
        .catch(() => undefined);
      await cleanup(pool, workspaceId, submission).catch(() => undefined);
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

/**
 * D-175. The Work row the Coordinator writes is a hand-enumerated payload, not
 * a spread, so a field added to `CreativeWork` is dropped here silently and
 * without a type error. Read the mode back through the repository the
 * Operations service actually reads from, not from the INSERT.
 */
test(
  "the Coordinator persists the creation mode onto the Work it reserves",
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
    const workspaceId = `spine-creation-mode-${suffix}`;
    const freeQuoteId = `spine-creation-mode-free-${suffix}`;
    const customizedQuoteId = `spine-creation-mode-customized-${suffix}`;
    const free = reserveRecord(
      workspaceId,
      freeQuoteId,
      `${suffix}-free`,
      "copy",
      "free",
    );
    const customized = reserveRecord(
      workspaceId,
      customizedQuoteId,
      `${suffix}-customized`,
      "copy",
      "customized",
    );

    try {
      await operations.migrate();
      await billingRepository.migrate();
      await store.applySchema();
      await pool.query(
        "INSERT INTO workspaces (id, name) VALUES ($1, 'Creation mode test')",
        [workspaceId],
      );

      for (const [record, quoteId, creationMode] of [
        [free, freeQuoteId, "free"],
        [customized, customizedQuoteId, "customized"],
      ] as const) {
        const quote = await seedQuote(
          billingRepository,
          workspaceId,
          quoteId,
          record.task.id,
        );
        record.snapshot = createSnapshot({
          creationMode,
          quoteId,
          quoteRevision: quote.revision,
          submission: record,
          workspaceId,
        });
        const claimed = await store.claim({
          idempotencyKey: `creation-mode-${creationMode}`,
          payloadHash: `creation-mode-${creationMode}`,
          submission: record,
          workspaceId,
        });
        assert.equal(claimed.kind, "created");
      }

      const state = await operations.loadWorkspace(workspaceId);
      const readBack = (workId: string) =>
        state?.creativeWorks.find((work) => work.id === workId);
      assert.equal(readBack(free.work.id)?.creationMode, "free");
      assert.equal(readBack(customized.work.id)?.creationMode, "customized");
    } finally {
      await cleanup(pool, workspaceId, free).catch(() => undefined);
      await cleanup(pool, workspaceId, customized).catch(() => undefined);
      await pool
        .query("DELETE FROM workspaces WHERE id = $1", [workspaceId])
        .catch(() => undefined);
      await pool.end();
    }
  },
);

function recoveryExecutionPlanFreeze(
  submission: CreationSubmissionRecord,
  approvalBasis: 'policy_exempt_copy' | 'merchant_confirmed' = 'policy_exempt_copy',
): NonNullable<CreationSubmissionRecord['executionPlanFreeze']> {
  return {
    planId: `plan-${submission.task.id}` as never,
    planRevision: 1,
    intentDeclaration: { summary: submission.snapshot.intent.text },
    contextBundleRef: {
      bundleId: submission.snapshot.briefContext.id,
      revision: submission.snapshot.briefContext.revision,
      hash: 'context-freeze-hash',
    },
    executionPlan: {
      schemaVersion: 'compiled-execution-plan/v1',
      units: [{ unitId: 'unit-1' as never, unitType: 'copy.generate', primitive: 'generate' }],
      dependencyGroups: [{ groupId: 'group-1', unitIds: ['unit-1' as never] }],
      boundedRetry: {
        'unit-1': { maxAttempts: 1, maxCostCents: 0, retry: { enabled: false } },
      },
    },
    deliverables: [{ deliverableId: 'deliverable-1', kind: 'copy', quantity: 1 }],
    quoteRef: submission.snapshot.quote,
    rightsRevisionRefs: [submission.snapshot.rights.revision],
    harnessReleaseId: 'release-recovery-1' as never,
    approvalBasis,
  };
}

test(
  "V31-18 P0-1: a planning failure before the paid claim leaves nothing committed, and the same idempotencyKey retries clean",
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
    const sessions = new PostgresAgentSessionStore(pool);
    const plans = new PostgresMarketingPlanStore(pool);
    const suffix = randomUUID();
    const workspaceId = `spine-plan-recover-${suffix}`;
    const quoteId = `spine-quote-${suffix}`;
    const taskId = `spine-task-${suffix}`;
    const cleanupSubmission = reserveRecord(workspaceId, quoteId, suffix);

    try {
      await operations.migrate();
      await billingRepository.migrate();
      await store.applySchema();
      await sessions.migrate();
      await plans.migrate();
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
      const planCompiler = new PlanCompiler({
        store: plans,
        ports: createFixturePlanCompilerPorts(),
      });
      let compileCalls = 0;
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
            return "2026-08-09T09:00:00.000Z";
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
              modelSelection: {
                source: "platform_default",
                catalogModelId: "copy-model-1",
                platformConfigRevision: "admin-config:41",
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
        undefined,
        new ComposerPlanSessionCoordinator(sessions, plans, {
          compilePlan: (input) => {
            compileCalls += 1;
            if (compileCalls === 1) {
              throw new Error("plan compiler transport failed");
            }
            return planCompiler.compile(input);
          },
          adjustPlan: (input) => planCompiler.adjust(input),
          retrieveConfirmedExperience: async () => [],
        }),
      );

      // Attempt 1: the atomic prepare-before-claim order (V31-39) runs
      // planning before store.claim(), so a planning failure here means
      // claim() never ran at all — nothing is paid and no submission row
      // exists yet.
      await assert.rejects(
        () => coordinator.submit(request),
        /plan compiler transport failed/u,
      );
      const paid = await pool.query<{ usage: number }>(
        `SELECT count(*)::int AS usage FROM p1_product_billing_usage
          WHERE workspace_id = $1 AND task_id = $2`,
        [workspaceId, taskId],
      );
      assert.equal(paid.rows[0]?.usage, 0);
      assert.equal(harnessStarts, 0);

      // Attempt 2: the same idempotencyKey must retry clean, not brick with
      // `cannot resume from failed`. Since attempt 1 committed nothing, this
      // is a fresh claim (not a replay) once planning succeeds.
      const recovered = await coordinator.submit(request);
      assert.equal(recovered.replayed, false);
      assert.equal(compileCalls, 2);
      assert.equal(harnessStarts, 1);
      const counts = await pool.query<{ submissions: number; usage: number }>(
        `SELECT
           (SELECT count(*)::int FROM execution_spine.creation_submissions
             WHERE workspace_id = $1) AS submissions,
           (SELECT count(*)::int FROM p1_product_billing_usage
             WHERE workspace_id = $1 AND task_id = $2) AS usage`,
        [workspaceId, taskId],
      );
      assert.deepEqual(counts.rows[0], { submissions: 1, usage: 1 });
      assert.ok(recovered.runId);
      const run = await sessions.getRun({
        resourceId: workspaceId,
        runId: recovered.runId,
      });
      assert.equal(run?.status, "completed");
    } finally {
      await pool
        .query("DELETE FROM p1_marketing_plan_revisions WHERE resource_id = $1", [
          workspaceId,
        ])
        .catch(() => undefined);
      await pool
        .query("DELETE FROM p1_agent_runs WHERE thread_id IN (SELECT thread_id FROM p1_agent_threads WHERE resource_id = $1)", [
          workspaceId,
        ])
        .catch(() => undefined);
      await pool
        .query("DELETE FROM p1_agent_threads WHERE resource_id = $1", [
          workspaceId,
        ])
        .catch(() => undefined);
      await cleanup(pool, workspaceId, cleanupSubmission).catch(
        () => undefined,
      );
      await pool.end();
    }
  },
);

function reserveRecord(
  workspaceId: string,
  quoteId: string,
  suffix: string,
  lens: "copy" | "image" | "video" = "copy",
  creationMode: "customized" | "free" = "customized",
): CreationSubmissionRecord {
  const taskId = `spine-task-${suffix}`;
  const submission: CreationSubmissionRecord = {
    contentPackage: { expectedRevision: 0, id: `spine-package-${suffix}` },
    snapshot: createSnapshot({
      quoteId,
      quoteRevision: "quote-revision-placeholder",
      creationMode,
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
  options?: { creditCost?: number; outputCount?: number; unitRate?: number },
) {
  const billing = new DurableProductBillingService(repository);
  await seedUnconfirmedQuote(repository, workspaceId, quoteId, options);
  return billing.confirm({ quoteId, taskId, workspaceId });
}

async function seedUnconfirmedQuote(
  repository: PostgresProductBillingRepository,
  workspaceId: string,
  quoteId: string,
  options?: { creditCost?: number; outputCount?: number; unitRate?: number },
) {
  return new DurableProductBillingService(repository).buildQuote({
    billingMode: "per_request",
    catalogModelId: "copy-model-1",
    catalogModelRevision: "catalog-r1",
    frozenCandidateDeploymentIds: ["copy-deployment-1"],
    ...(options?.creditCost !== undefined
      ? { creditCost: options.creditCost }
      : {}),
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
  catalogModelId?: string;
  contentPackagePlatform?: "douyin" | "wechat_moments";
  creationMode?: "customized" | "free";
  distributionTarget?: "export" | "manual_copy";
  lens?: "copy" | "image" | "video";
  platformId?: "douyin" | "wechat_moments";
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
      catalogModel: {
        id: input.catalogModelId ?? "copy-model-1",
        revision: "catalog-r1",
      },
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
      creationMode: input.creationMode ?? "customized",
      intent: "为夏日护理项目写一条预约文案",
      lens,
      modelPolicy: { id: "policy-1", mode: "fixed", revision: "policy-r1" },
      platform: { id: input.platformId ?? "douyin" },
      contentPackagePlatform: input.contentPackagePlatform,
      distributionTarget: input.distributionTarget,
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
  void submission;
}

test(
  "Postgres store persists Agent planning through a jsonb round-trip and carries it into start recovery",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresCreationSubmissionStore(pool, {
      async reserve() {},
    });
    const suffix = randomUUID();
    const workspaceId = `spine-planning-${suffix}`;
    const quoteId = `spine-quote-${suffix}`;
    const submission = reserveRecord(workspaceId, quoteId, suffix);
    const agentBinding = {
      threadId: asAgentThreadIdentity(`thread-${suffix}`),
      runId: `run-${suffix}`,
    };
    // ExecutionPlanCompileFreeze's own field order. jsonb stores object keys by
    // length then bytes, so this cannot come back in the order it went in —
    // which is what a byte comparison against the round-trip tripped over.
    const executionPlanFreeze = {
      planId: `plan-${suffix}`,
      planRevision: 1,
      intentDeclaration: { normalizedIntent: "为夏日护理项目写一条预约文案" },
      contextBundleRef: {
        bundleId: `bundle-${suffix}`,
        revision: 1,
        hash: "a".repeat(64),
      },
      executionPlan: { units: [] },
      deliverables: [],
      quoteRef: { id: quoteId, revision: "quote-revision-placeholder" },
      rightsRevisionRefs: ["rights-r1"],
      harnessReleaseId: "harness-release-1",
      approvalBasis: "policy_exempt_copy",
    } as unknown as NonNullable<CreationSubmissionRecord["executionPlanFreeze"]>;

    try {
      await store.applySchema();
      await pool.query(
        `INSERT INTO execution_spine.creation_submissions
           (id, workspace_id, idempotency_key, payload_hash, submission,
            harness_state, task_id, created_at)
         VALUES ($1,$2,$3,$3,$5::jsonb,'reserved',$4,clock_timestamp())`,
        [
          submission.snapshot.id,
          workspaceId,
          `idempotency-${suffix}`,
          submission.task.id,
          JSON.stringify(submission),
        ],
      );

      const persisted = await store.persistAgentPlanning({
        workspaceId,
        submissionId: submission.snapshot.id,
        agentBinding,
        executionPlanFreeze,
      });
      assert.deepEqual(persisted.agentBinding, agentBinding);
      assert.deepEqual(persisted.executionPlanFreeze, executionPlanFreeze);

      const stored = await pool.query<{ freeze: Record<string, unknown> }>(
        `SELECT submission->'executionPlanFreeze' AS freeze
           FROM execution_spine.creation_submissions
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, submission.snapshot.id],
      );
      const storedFreeze = stored.rows[0]?.freeze;
      assert.ok(storedFreeze);
      // The mechanism, pinned: the column really does hand back a different key
      // order, so the retry below can only pass under a canonical comparison.
      assert.notDeepEqual(
        Object.keys(storedFreeze),
        Object.keys(executionPlanFreeze),
      );
      assert.deepEqual(
        [...Object.keys(storedFreeze)].sort(),
        [...Object.keys(executionPlanFreeze)].sort(),
      );

      // A retry of the same planning must be a no-op, not a conflict.
      const replayed = await store.persistAgentPlanning({
        workspaceId,
        submissionId: submission.snapshot.id,
        agentBinding,
        executionPlanFreeze,
      });
      assert.deepEqual(replayed.agentBinding, agentBinding);
      assert.deepEqual(replayed.executionPlanFreeze, executionPlanFreeze);

      // A genuinely different binding still fences.
      await assert.rejects(
        store.persistAgentPlanning({
          workspaceId,
          submissionId: submission.snapshot.id,
          agentBinding: { ...agentBinding, runId: `run-other-${suffix}` },
          executionPlanFreeze,
        }),
        /Agent planning persistence conflict/u,
      );

      const lease = await store.claimHarnessStart({
        submissionId: submission.snapshot.id,
        workspaceId,
      });
      assert.equal(lease.kind, "start");
      await pool.query(
        `UPDATE execution_spine.creation_submissions
            SET harness_lease_expires_at = clock_timestamp() - interval '1 second'
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, submission.snapshot.id],
      );

      const recovered: CreationSubmissionRecord[] = [];
      const coordinator = new CreationSubmissionCoordinator(
        store,
        {
          async start(record) {
            recovered.push(record);
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
        undefined,
        {
          // Planning is already durable, so recovery must reuse it rather than
          // mint a second Thread for the same submission.
          async prepare() {
            throw new Error("Recovery must not re-plan a bound submission.");
          },
        },
      );
      // recoverPendingStarts sweeps every workspace, so the aggregate counts
      // belong to whatever else the database holds. Assert on this submission.
      const outcome = await coordinator.recoverPendingStarts();
      assert.ok(outcome.attempted >= 1);
      const mine = recovered.filter(
        (record) => record.snapshot.workspaceId === workspaceId,
      );
      assert.equal(mine.length, 1);
      assert.deepEqual(mine[0]?.agentBinding, agentBinding);
      assert.deepEqual(mine[0]?.executionPlanFreeze, executionPlanFreeze);
    } finally {
      await pool
        .query(
          `DELETE FROM execution_spine.creation_submissions
         WHERE workspace_id=$1`,
          [workspaceId],
        )
        .catch(() => undefined);
      await pool.end();
    }
  },
);

test(
  "V31-33 listRecoverableHarnessStarts enforces per-workspace fairness under LIMIT",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    const store = new PostgresCreationSubmissionStore(pool, {
      async reserve() {},
    });
    const suffix = randomUUID();
    const workspaceA = `spine-fair-a-${suffix}`;
    const workspaceB = `spine-fair-b-${suffix}`;
    const idsA: string[] = [];
    const idsB: string[] = [];

    try {
      await store.applySchema();
      // One workspace's backlog must not starve the other under a small LIMIT.
      for (let i = 0; i < 8; i += 1) {
        const subA = reserveRecord(
          workspaceA,
          `fair-a-quote-${suffix}-${i}`,
          `fair-a-${suffix}-${i}`,
        );
        const subB = reserveRecord(
          workspaceB,
          `fair-b-quote-${suffix}-${i}`,
          `fair-b-${suffix}-${i}`,
        );
        idsA.push(subA.snapshot.id);
        idsB.push(subB.snapshot.id);
        // A is older so a non-fair global ORDER BY would fill the LIMIT from A.
        await pool.query(
          `INSERT INTO execution_spine.creation_submissions
             (id, workspace_id, idempotency_key, payload_hash, submission,
              harness_state, task_id, created_at, updated_at)
           VALUES ($1,$2,$3,$3,$5::jsonb,'reserved',$4,
                   clock_timestamp() - interval '1 hour',
                   clock_timestamp() - make_interval(secs => $6))`,
          [
            subA.snapshot.id,
            workspaceA,
            `idem-fair-a-${suffix}-${i}`,
            subA.task.id,
            JSON.stringify(subA),
            600 + i,
          ],
        );
        await pool.query(
          `INSERT INTO execution_spine.creation_submissions
             (id, workspace_id, idempotency_key, payload_hash, submission,
              harness_state, task_id, created_at, updated_at)
           VALUES ($1,$2,$3,$3,$5::jsonb,'reserved',$4,
                   clock_timestamp() - interval '1 hour',
                   clock_timestamp() - make_interval(secs => $6))`,
          [
            subB.snapshot.id,
            workspaceB,
            `idem-fair-b-${suffix}-${i}`,
            subB.task.id,
            JSON.stringify(subB),
            500 + i,
          ],
        );
      }

      // limit=4 → default perWorkspaceLimit = ceil(4/4) = 1
      const fair = await store.listRecoverableHarnessStarts({ limit: 4 });
      const fairIds = new Set(
        fair.map((row) => row.submission.snapshot.id),
      );
      const countA = idsA.filter((id) => fairIds.has(id)).length;
      const countB = idsB.filter((id) => fairIds.has(id)).length;
      assert.ok(countA >= 1, `workspace A must receive recovery slots, got ${countA}`);
      assert.ok(countB >= 1, `workspace B must receive recovery slots, got ${countB}`);
      assert.ok(countA <= 1, `workspace A must not exceed per-workspace cap, got ${countA}`);
      assert.ok(countB <= 1, `workspace B must not exceed per-workspace cap, got ${countB}`);
      assert.ok(fair.length <= 4);

      // Explicit cap: perWorkspaceLimit=2 with limit=10 leaves room for both.
      const capped = await store.listRecoverableHarnessStarts({
        limit: 10,
        perWorkspaceLimit: 2,
      });
      const cappedIds = new Set(
        capped.map((row) => row.submission.snapshot.id),
      );
      const cappedA = idsA.filter((id) => cappedIds.has(id)).length;
      const cappedB = idsB.filter((id) => cappedIds.has(id)).length;
      assert.equal(cappedA, 2);
      assert.equal(cappedB, 2);
      assert.equal(cappedA + cappedB, 4);
    } finally {
      await pool
        .query(
          `DELETE FROM execution_spine.creation_submissions
            WHERE workspace_id = ANY($1::text[])`,
          [[workspaceA, workspaceB]],
        )
        .catch(() => undefined);
      await pool.end();
    }
  },
);

test(
  "V31-41 prepare terminal failure refunds reserved credits exactly once",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    const billingRepository = new PostgresProductBillingRepository(pool);
    const creditLedger = new PostgresCreditLedger(pool);
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
    const suffix = randomUUID();
    const workspaceId = `spine-prepare-term-${suffix}`;
    const quoteId = `spine-prepare-term-quote-${suffix}`;
    const submission = reserveRecord(workspaceId, quoteId, suffix);

    try {
      await operations.migrate();
      await billingRepository.migrate();
      const migrationClient = await pool.connect();
      try {
        await creditLedger.migrate(migrationClient);
      } finally {
        migrationClient.release();
      }
      await store.applySchema();
      await pool.query(
        "INSERT INTO workspaces (id, name) VALUES ($1, 'Prepare terminal refund test')",
        [workspaceId],
      );
      await creditLedger.grant({
        id: `prepare-term-credit-${suffix}`,
        workspaceId,
        credits: 10,
        expirationDate: "2026-09-01T00:00:00.000Z",
        transactionType: "PURCHASE_PACKAGE",
        sourceRef: `prepare-term-${suffix}`,
        createdAt: "2026-07-01T00:00:00.000Z",
      });
      const quote = await seedQuote(
        billingRepository,
        workspaceId,
        quoteId,
        submission.task.id,
        { creditCost: 4, outputCount: 1, unitRate: 4 },
      );
      submission.snapshot = createSnapshot({
        contentPackagePlatform: "wechat_moments",
        distributionTarget: "manual_copy",
        platformId: "wechat_moments",
        quoteId,
        quoteRevision: quote.revision,
        submission,
        workspaceId,
      });
      submission.usageReservation = {
        id: submission.usageReservation.id,
        credits: 4,
        units: [],
      };
      // Reachable arm (no agentBinding): prepare actually runs and can fail.
      // policy_exempt_copy keeps recovery from treating this as merchant-gated.
      submission.executionPlanFreeze = recoveryExecutionPlanFreeze(
        submission,
        "policy_exempt_copy",
      );
      await store.claim({
        idempotencyKey: `prepare-term-${suffix}`,
        payloadHash: `payload-prepare-term-${suffix}`,
        submission,
        workspaceId,
      });
      assert.equal(
        (await creditLedger.project(workspaceId, submission.snapshot.createdAt))
          .availableCredits,
        6,
      );
      assert.equal(
        (await billingRepository.getUsage(workspaceId, submission.task.id))
          ?.status,
        "reserved",
      );

      // Age the row past the attempts=0 backoff window so recovery selects it.
      await pool.query(
        `UPDATE execution_spine.creation_submissions
            SET updated_at = clock_timestamp() - interval '10 seconds'
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, submission.snapshot.id],
      );

      let refundCalls = 0;
      const coordinator = new CreationSubmissionCoordinator(
        store,
        {
          async start() {
            throw new Error("start must not run after prepare terminalizes");
          },
          async classifyPrepareFailure() {
            return "terminal_rejection";
          },
        },
        {
          createId() {
            return "unused-prepare-term-id";
          },
          now() {
            return "2026-08-11T00:00:00.000Z";
          },
        },
        {
          async admit() {
            throw new Error("Recovery must not run a new-submission admission.");
          },
        },
        undefined,
        {
          async prepare() {
            throw new Error("payload permanently illegal for prepare");
          },
        },
      );

      const onPrepareTerminalRefund = async (
        record: CreationSubmissionRecord,
      ) => {
        refundCalls += 1;
        await store.refundPrepareTerminalReservation(record);
      };

      const outcome = await coordinator.recoverPendingStarts(100, {
        onPrepareTerminalRefund,
      });
      const mine = (outcome.failureDetails ?? []).filter(
        (d) => d.submissionId === submission.snapshot.id,
      );
      assert.equal(mine.length, 1);
      assert.equal(mine[0]?.terminal, true);
      assert.equal(refundCalls, 1);

      assert.equal(
        (await billingRepository.getUsage(workspaceId, submission.task.id))
          ?.status,
        "refunded",
      );
      assert.equal(
        (await creditLedger.project(workspaceId, new Date().toISOString()))
          .availableCredits,
        10,
      );
      const harness = await pool.query<{ harness_state: string }>(
        `SELECT harness_state
           FROM execution_spine.creation_submissions
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, submission.snapshot.id],
      );
      assert.equal(harness.rows[0]?.harness_state, "failed");
      assert.equal(
        (
          await store.listRecoverableHarnessStarts({ limit: 100 })
        ).some(
          (candidate) =>
            candidate.submission.snapshot.id === submission.snapshot.id,
        ),
        false,
      );

      // Second refund is a no-op on ledger/usage (exactly once).
      await store.refundPrepareTerminalReservation(submission);
      assert.equal(
        (await creditLedger.project(workspaceId, new Date().toISOString()))
          .availableCredits,
        10,
      );
      assert.equal(
        (await billingRepository.getUsage(workspaceId, submission.task.id))
          ?.status,
        "refunded",
      );
      const refundTx = await pool.query<{ n: string }>(
        `SELECT count(*)::text AS n
           FROM p1_credit_lot_transactions
          WHERE workspace_id = $1
            AND transaction_type = 'REFUND'
            AND operation_id = $2`,
        [workspaceId, `prepare-terminal-refund:${submission.task.id}`],
      );
      assert.equal(Number(refundTx.rows[0]?.n ?? 0), 1);
    } finally {
      await cleanup(pool, workspaceId, submission).catch(() => undefined);
      await pool
        .query("DELETE FROM workspaces WHERE id = $1", [workspaceId])
        .catch(() => undefined);
      await pool
        .query(
          `DELETE FROM p1_credit_lot_transactions WHERE workspace_id = $1`,
          [workspaceId],
        )
        .catch(() => undefined);
      await pool
        .query(`DELETE FROM p1_credit_grant_lots WHERE workspace_id = $1`, [
          workspaceId,
        ])
        .catch(() => undefined);
      await pool.end();
    }
  },
);
