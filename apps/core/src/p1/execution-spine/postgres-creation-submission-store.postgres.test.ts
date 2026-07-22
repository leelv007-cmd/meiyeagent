import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { contentPackageSchema } from "@meiye/contracts";
import { Pool } from "pg";

import { DurableProductBillingService } from "../product-billing/durable-service.js";
import { PostgresProductBillingRepository } from "../product-billing/postgres-repository.js";
import { PostgresOperationsRepository } from "../operations/postgres-repository.js";
import { buildContentPackage } from "../operations/content-package.js";
import { PostgresHarnessStore } from "../harness/postgres-store.js";
import { harnessRuntimeId } from "../harness/workspace-scope.js";
import { createCreationExecutionSnapshot } from "./creation-execution-snapshot.js";
import {
  ContentPackageRevisionWriteError,
  PostgresContentPackageRevisionWritePort,
} from "./content-package-revision-port.js";
import {
  PostgresCreationSubmissionPersistence,
  PostgresCreationSubmissionStore,
  PostgresProductBillingUsageReservation,
} from "./postgres-creation-submission-store.js";
import {
  CreationSubmissionCoordinator,
  type CreationSubmissionRecord,
} from "./submission-coordinator.js";

const connectionString = process.env.TEST_DATABASE_URL;

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
        new PostgresProductBillingUsageReservation(pool),
      ),
      { harnessStartLeaseMs: 60_000 },
    );
    const harnessStore = new PostgresHarnessStore(pool, {
      async currentRevision() {
        return 1;
      },
    });
    let assetRightsAvailable = true;
    const packageWriter = new PostgresContentPackageRevisionWritePort(pool, {
      async resolve({ assetIds }) {
        return {
          knownAssetIds: assetIds,
          unauthorizedAssetIds: assetRightsAvailable ? [] : assetIds,
        };
      },
    });
    const suffix = randomUUID();
    const workspaceId = `spine-workspace-${suffix}`;
    const quoteId = `spine-quote-${suffix}`;
    const submission = reserveRecord(workspaceId, quoteId, suffix);

    try {
      await operations.migrate();
      await billingRepository.migrate();
      await store.applySchema();
      await harnessStore.applySchema();
      await packageWriter.applySchema();
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

      const persisted = await pool.query<{
        packages: number;
        tasks: number;
        usage: number;
        works: number;
      }>(
        `SELECT
           (SELECT count(*)::int FROM p1_content_packages
             WHERE workspace_id = $1 AND id = $2) AS packages,
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
        tasks: 1,
        usage: 1,
        works: 1,
      });
      await harnessStore.claim({
        taskId: submission.task.id,
        fingerprint: "composer-harness-request",
        request: {
          actorId: submission.snapshot.actorId,
          workspaceId,
          packageId: submission.contentPackage.id,
          expectedRevision: submission.contentPackage.expectedRevision,
          workflowRevision: submission.snapshot.revision,
          rawInput: submission.snapshot.intent.text,
          intent: {
            context: {
              workId: submission.work.id,
              intent: submission.snapshot.intent.text,
              sourceSummaries: [],
            },
            assetReferences: submission.snapshot.sources.assets.map((asset) => asset.id),
          },
          executionSnapshot: submission.snapshot,
        },
      });
      for (const [stage, payload] of [
        ["context_injection", { sourceRevisions: { facts: 1 } }],
        ["brief_compilation", { factRefs: ["store_fact:offer:1"] }],
        [
          "execution_selection",
          {
            winnerCandidateId: "candidate-a",
            candidateScores: [
              { candidateId: "candidate-a", reason: "适合当前预约需求" },
            ],
          },
        ],
      ] as const) {
        await harnessStore.recordStageTrace({
          workspaceId,
          id: `trace-${submission.task.id}-${stage}`,
          taskId: submission.task.id,
          stage,
          payload,
        });
      }
      const sourceContentPackage = submission.snapshot.sources.contentPackage;
      if (!sourceContentPackage) {
        throw new Error("Expected the Composer snapshot to bind a source ContentPackage.");
      }
      await seedSourceContentPackage(
        pool,
        workspaceId,
        sourceContentPackage,
      );
      const deliveryInput = {
        additionalVersions: [
          {
            body: "候选版本 B 正文",
            conversionHook: "了解详情",
            createdAt: "2026-07-22T09:00:00.000Z",
            createdBy: `harness-${submission.task.id}`,
            harnessCandidateId: "candidate-b",
            harnessScore: 85,
            id: `copy-version-b-${suffix}`,
            orderedAssetIds: ["asset-1"],
            source: "ai_generated" as const,
            title: "候选版本 B",
            topics: [],
          },
        ],
        expectedRevision: submission.contentPackage.expectedRevision,
        generated: { assetIds: [], childRuns: [] },
        harnessSelection: { recommendedCandidateId: "candidate-a" },
        idempotencyKey: `copy-harness-${suffix}`,
        kind: "image_text" as const,
        occurredAt: "2026-07-22T09:00:00.000Z",
        packageId: submission.contentPackage.id,
        platform: "douyin" as const,
        snapshotId: submission.snapshot.id,
        snapshot: {
          id: submission.snapshot.id,
          revision: submission.snapshot.revision,
          schemaVersion: submission.snapshot.schemaVersion,
        },
        sourceContentPackage: submission.snapshot.sources.contentPackage,
        taskId: submission.task.id,
        version: {
          body: "候选版本 A 正文",
          conversionHook: "私信预约",
          createdAt: "2026-07-22T09:00:00.000Z",
          createdBy: `harness-${submission.task.id}`,
          harnessCandidateId: "candidate-a",
          harnessScore: 91,
          id: `copy-version-a-${suffix}`,
          orderedAssetIds: ["asset-1"],
          source: "ai_generated" as const,
          title: "候选版本 A",
          topics: [],
        },
        workId: submission.work.id,
        workflowId: submission.task.id,
        workflowRevision: submission.snapshot.revision,
        workspaceId,
      };
      const delivered = await packageWriter.write(deliveryInput);
      assert.deepEqual(delivered, {
        packageId: submission.contentPackage.id,
        revision: 1,
        versionId: deliveryInput.version.id,
      });
      assert.deepEqual(await packageWriter.write(deliveryInput), delivered);
      assetRightsAvailable = false;
      await assert.rejects(
        packageWriter.write({
          ...deliveryInput,
          idempotencyKey: `copy-harness-after-rights-revocation-${suffix}`,
          version: {
            ...deliveryInput.version,
            id: `copy-version-after-rights-revocation-${suffix}`,
          },
        }),
        (error: unknown) =>
          error instanceof ContentPackageRevisionWriteError &&
          error.code === "CONTENT_PACKAGE_ASSET_RIGHTS_UNAVAILABLE",
      );
      assetRightsAvailable = true;
      const deliveryAudit = await pool.query<{
        payload: {
          expectedRevision: number;
          packageId: string;
          revision: number;
          versionId: string;
          workspaceId: string;
        };
        outbox_status: string;
      }>(
        `SELECT audit.payload - 'requestFingerprint' AS payload,
                outbox.status AS outbox_status
           FROM harness_runtime.audit_events audit
           JOIN harness_runtime.langfuse_outbox outbox ON outbox.audit_id = audit.id
          WHERE audit.workflow_id = $1 AND audit.event_type = 'package_delivered'`,
        [harnessRuntimeId(workspaceId, submission.task.id)],
      );
      assert.deepEqual(deliveryAudit.rows, [
        {
          payload: {
            expectedRevision: 0,
            packageId: submission.contentPackage.id,
            revision: 1,
            versionId: deliveryInput.version.id,
            workspaceId,
          },
          outbox_status: "queued",
        },
      ]);
      const recommendation = await harnessStore.readTodayRecommendation(workspaceId);
      assert.equal(recommendation.recommendation?.packageId, submission.contentPackage.id);
      assert.equal(recommendation.recommendation?.versionId, deliveryInput.version.id);
      assert.equal(recommendation.recommendation?.whyNow, "适合当前预约需求");
      const deliveredPackage = await pool.query<{ payload: unknown }>(
        `SELECT payload FROM p1_content_packages
          WHERE workspace_id = $1 AND id = $2`,
        [workspaceId, submission.contentPackage.id],
      );
      const packagePayload = contentPackageSchema.parse(deliveredPackage.rows[0]?.payload);
      assert.equal(packagePayload.currentVersionId, deliveryInput.version.id);
      assert.deepEqual(packagePayload.harnessSelection, {
        recommendedCandidateId: "candidate-a",
      });
      assert.deepEqual(packagePayload.source.creationExecutionSnapshot, {
        id: submission.snapshot.id,
        revision: 1,
        schemaVersion: "creation-execution-snapshot/v1",
      });
      assert.deepEqual(
        packagePayload.source.sourceContentPackage,
        submission.snapshot.sources.contentPackage,
      );
      assert.deepEqual(packagePayload.lineage, {
        reusedFromPackageId: submission.snapshot.sources.contentPackage?.id,
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
        (await store.listRecoverableHarnessStarts({ limit: 10 })).map(
          (candidate) => candidate.submission.snapshot.id,
        ),
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
  "a quoted ProductQuote is never auto-confirmed by a Composer reservation",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    const billingRepository = new PostgresProductBillingRepository(pool);
    const store = new PostgresCreationSubmissionStore(
      pool,
      new PostgresCreationSubmissionPersistence(
        new PostgresProductBillingUsageReservation(pool),
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
  "a failed product reservation rolls back every Composer shell",
  { skip: connectionString ? false : "TEST_DATABASE_URL is not configured" },
  async () => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    const billingRepository = new PostgresProductBillingRepository(pool);
    const store = new PostgresCreationSubmissionStore(
      pool,
      new PostgresCreationSubmissionPersistence(
        new PostgresProductBillingUsageReservation(pool),
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
): CreationSubmissionRecord {
  const taskId = `spine-task-${suffix}`;
  const submission: CreationSubmissionRecord = {
    contentPackage: { expectedRevision: 0, id: `spine-package-${suffix}` },
    snapshot: createSnapshot({
      quoteId,
      quoteRevision: "quote-revision-placeholder",
      submission: {
        contentPackage: { expectedRevision: 0, id: `spine-package-${suffix}` },
        task: { id: taskId },
        work: { id: `spine-work-${suffix}` },
      },
      workspaceId,
    }),
    task: { id: taskId },
    usageReservation: { id: `spine-usage-${suffix}` },
    work: { id: `spine-work-${suffix}` },
  };
  return submission;
}

async function seedQuote(
  repository: PostgresProductBillingRepository,
  workspaceId: string,
  quoteId: string,
  taskId: string,
) {
  const billing = new DurableProductBillingService(repository);
  await seedUnconfirmedQuote(repository, workspaceId, quoteId);
  return billing.confirm({ quoteId, taskId, workspaceId });
}

async function seedUnconfirmedQuote(
  repository: PostgresProductBillingRepository,
  workspaceId: string,
  quoteId: string,
) {
  return new DurableProductBillingService(repository).buildQuote({
    billingMode: "per_request",
    catalogModelId: "copy-model-1",
    catalogModelRevision: "catalog-r1",
    frozenCandidateDeploymentIds: ["copy-deployment-1"],
    quoteId,
    quotePolicyRevision: "quote-policy-1",
    routeSnapshotRef: "route-1",
    unitRate: 1,
    workspaceId,
  });
}

function createSnapshot(input: {
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
      catalogModel: { id: "copy-model-1", revision: "catalog-r1" },
      contentModules: ["social_cover"],
      contentPackageId: input.submission.contentPackage.id,
      deliverables: [
        {
          id: "copy-main",
          kind: "copy",
          order: 1,
          quantity: 1,
        },
      ],
      expectedContentPackageRevision:
        input.submission.contentPackage.expectedRevision,
      identity: { id: "identity-1", revision: "identity-r1" },
      idempotencyKey: "submission-key",
      intent: "为夏日护理项目写一条预约文案",
      lens: "copy",
      modelPolicy: { id: "policy-1", mode: "fixed", revision: "policy-r1" },
      platform: { id: "douyin" },
      quote: { id: input.quoteId, revision: input.quoteRevision },
      recipe: { id: "recipe-1", revision: "recipe-r1" },
      rights: { revision: "rights-r1", summary: "authorized source assets" },
      route: { id: "route-1", revision: "route-r1" },
      sources: {
        assets: [{ id: "asset-1", revision: "asset-r1", role: "reference" }],
        contentPackage: {
          id: `source-package-${input.submission.task.id}`,
          revision: "3",
        },
      },
      surface: { id: "surface-1", revision: "surface-r1" },
      taskId: input.submission.task.id,
      workId: input.submission.work.id,
      workspaceId: input.workspaceId,
    },
    "2026-07-22T09:00:00.000Z",
  );
}

async function seedSourceContentPackage(
  pool: Pool,
  workspaceId: string,
  source: { id: string; revision: string },
) {
  const sourcePackage = {
    ...buildContentPackage({
      id: source.id,
      kind: "image_text",
      source: { assetIds: ["source-asset-1"], targetPlatform: "xiaohongshu" },
      timestamp: "2026-07-22T09:00:00.000Z",
      workspaceId,
    }),
    currentVersionId: "source-version-1",
    revision: Number(source.revision),
    status: "accepted" as const,
    versions: [
      {
        body: "来源内容正文",
        createdAt: "2026-07-22T09:00:00.000Z",
        id: "source-version-1",
        orderedAssetIds: ["source-asset-1"],
        title: "来源内容",
        topics: [],
      },
    ],
  };
  await pool.query(
    `INSERT INTO p1_content_packages
       (workspace_id, id, payload, revision, updated_at)
     VALUES ($1, $2, $3::jsonb, $4, $5::timestamptz)`,
    [
      workspaceId,
      source.id,
      JSON.stringify(sourcePackage),
      sourcePackage.revision,
      "2026-07-22T09:00:00.000Z",
    ],
  );
}

async function cleanup(
  pool: Pool,
  workspaceId: string,
  submission: CreationSubmissionRecord,
) {
	const runtimeTaskId = harnessRuntimeId(workspaceId, submission.task.id);
	await pool.query(
		`DELETE FROM harness_runtime.langfuse_outbox
		  WHERE audit_id IN (
		    SELECT id FROM harness_runtime.audit_events WHERE workflow_id = $1
		  )`,
		[runtimeTaskId],
	);
	await pool.query(
		"DELETE FROM harness_runtime.audit_events WHERE workflow_id = $1",
		[runtimeTaskId],
	);
	await pool.query(
		"DELETE FROM harness_runtime.decision_traces WHERE task_id = $1",
		[runtimeTaskId],
	);
	await pool.query(
		"DELETE FROM harness_runtime.task_requests WHERE task_id = $1",
		[runtimeTaskId],
	);
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
