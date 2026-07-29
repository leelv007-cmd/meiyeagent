import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { DBOS } from '@dbos-inc/dbos-sdk';
import { contentPackageSchema } from '@meiye/contracts';
import { Pool } from 'pg';

import {
  createCreationExecutionSnapshot,
  OFFICIAL_NEUTRAL_IDENTITY,
} from '../execution-spine/creation-execution-snapshot.js';
import { PostgresContentPackageRevisionWritePort } from '../execution-spine/content-package-revision-port.js';
import type {
  ModelSupplyResult,
  ModelSupplySubmission,
} from '../model-supply/index.js';
import { buildContentPackage } from '../operations/content-package.js';
import { MemoryContextBundleRepository } from '../operations/context-bundle-repository.js';
import { PostgresOperationsRepository } from '../operations/postgres-repository.js';
import { MemoryStoreFactLedger } from '../operations/store-fact-ledger.js';
import {
  DbosHarnessWorkflowStarter,
  registerHarnessDbosWorkflow,
} from './dbos-workflow.js';
import { PostgresNoteMediaAdmissionCoordinator } from './note-media-admission.js';
import { unconfiguredNotePlanEnhancementJudgeResolver } from './note-plan-structured-port.js';
import { LedgerBackedHarnessContextPort } from './production-context-port.js';
import { createProductionHarnessMediaAssembly } from './production-media-assembly.js';
import { ProductionHarnessStagePorts } from './production-stage-ports.js';
import { PostgresHarnessStore } from './postgres-store.js';
import type {
  StructuredNodeRunner,
  StructuredNodeRunnerRequest,
} from './structured-nodes.js';
import {
  HarnessTaskAdmissionService,
  type HarnessWorkflowInput,
} from './task-admission.js';
import { harnessRuntimeId } from './workspace-scope.js';

const databaseUrl = process.env.TEST_DATABASE_URL;
const systemDatabaseUrl = process.env.TEST_DBOS_SYSTEM_DATABASE_URL;
const now = '2026-07-29T09:30:00.000Z';
const expectedStages = [
  'intent_naming',
  'context_injection',
  'brief_compilation',
  'execution_selection',
  'assembly_delivery',
];

test(
  'production image media assembly durably joins admission to ContentPackage delivery',
  {
    skip:
      databaseUrl && systemDatabaseUrl
        ? false
        : 'TEST_DATABASE_URL and TEST_DBOS_SYSTEM_DATABASE_URL are required',
  },
  async () => {
    if (!databaseUrl || !systemDatabaseUrl) {
      throw new Error('Production media assembly databases are unavailable.');
    }
    const suffix = randomUUID();
    const workflowId = `production-media-assembly-${suffix}`;
    const workspaceId = `workspace-production-media-assembly-${suffix}`;
    const request = productionMediaRequest(workflowId, workspaceId);
    const snapshot = requireExecutionSnapshot(request);
    const runtimeId = harnessRuntimeId(workspaceId, workflowId);
    const pool = new Pool({ connectionString: databaseUrl });
    const harnessStore = new PostgresHarnessStore(pool);
    const contentPackages = new PostgresContentPackageRevisionWritePort(pool);
    const mediaProviderSubmissions: ModelSupplySubmission[] = [];
    const noteAdmission = new PostgresNoteMediaAdmissionCoordinator(pool);
    let dbosLaunched = false;

    try {
      await new PostgresOperationsRepository(pool).migrate();
      await harnessStore.applySchema();
      await contentPackages.applySchema();
      await noteAdmission.migrate();
      await seedContentPackage(pool, request);

      const runners = {
        create: () => new ExternalModelCompletionFixture(snapshot),
      };
      const copy = new ProductionHarnessStagePorts(
        runners,
        new LedgerBackedHarnessContextPort(
          new MemoryStoreFactLedger(),
          new MemoryContextBundleRepository(),
          () => now,
          undefined,
          undefined,
          undefined,
          {
            async resolve({ assetIds }) {
              return {
                knownAssetIds: [...assetIds],
                unauthorizedAssetIds: [],
              };
            },
          },
        ),
        {
          async deliverCopyRevision() {
            throw new Error('Copy delivery is outside the frozen media route.');
          },
        },
        () => now,
      );
      const stages = createProductionHarnessMediaAssembly({
        contentPackages,
        copy,
        models: {
          async submit(input) {
            mediaProviderSubmissions.push(structuredClone(input));
            return completedImageResult(snapshot);
          },
        },
        noteAdmission,
        noteEnhancementJudge: unconfiguredNotePlanEnhancementJudgeResolver,
        noteSettings: {
          async read() {
            throw new Error('Note settings are outside the frozen image route.');
          },
        },
        now: () => now,
        runners,
      });
      const workflow = registerHarnessDbosWorkflow(stages, harnessStore);
      DBOS.setConfig({
        name: 'beauty-marketing-production-media-assembly',
        systemDatabaseUrl,
        applicationVersion: `production-media-assembly-${suffix}`,
      });
      await DBOS.launch();
      dbosLaunched = true;

      const admission = new HarnessTaskAdmissionService(
        harnessStore,
        new DbosHarnessWorkflowStarter(workflow),
        undefined,
        undefined,
        {
          async resolve() {
            return {
              maxIterations: 4,
              maxCostCents: 'unset' as const,
              maxWallClockMs: 'unset' as const,
              maxDelegations: 'unset' as const,
              requiredLimits: ['maxIterations'] as const,
            };
          },
        },
      );

      assert.deepEqual(
        await admission.submit({ taskId: workflowId, ...request }),
        { workflowId, replayed: false },
      );
      const firstResult = await DBOS.retrieveWorkflow<{
        delivery: {
          packageId: string;
          revision: number;
          versionId: string;
        },
      }>(runtimeId).getResult();
      assert.equal(firstResult.delivery.packageId, request.packageId);
      assert.equal(firstResult.delivery.revision, 1);
      assert.ok(firstResult.delivery.versionId);
      assert.equal(
        await DBOS.retrieveWorkflow(runtimeId)
          .getStatus()
          .then((status) => status?.status),
        'SUCCESS',
      );

      const frozen = await pool.query<{ request: HarnessWorkflowInput }>(
        `SELECT request
           FROM harness_runtime.task_requests
          WHERE runtime_id=$1`,
        [runtimeId],
      );
      assert.deepEqual(frozen.rows[0]?.request.boundedExecution, {
        schemaVersion: 'bounded-execution-snapshot/v1',
        maxIterations: 4,
        maxCostCents: 'unset',
        maxWallClockMs: 'unset',
        maxDelegations: 'unset',
        requiredLimits: ['maxIterations'],
        consumption: {
          iterations: 0,
          costCents: 0,
          wallClockMs: 0,
          delegations: 0,
        },
        stopReason: null,
        triggeredLimit: null,
      });
      assert.equal(mediaProviderSubmissions.length, 1);
      const submission = mediaProviderSubmissions[0];
      assert.ok(submission);
      assert.equal(submission.billingTaskId, snapshot.task.id);
      assert.equal(submission.billingQuoteRevision, snapshot.quote.revision);
      assert.deepEqual(submission.selection, {
        mode: 'fixed',
        catalogModelId: snapshot.catalogModel.id,
      });
      assert.equal(submission.correlationId, workflowId);
      assert.equal(
        submission.idempotencyKey,
        `harness-media:${workflowId}:image`,
      );
      assert.equal(submission.operation, 'image.generate');
      assert.equal(submission.workspaceId, workspaceId);

      const completed = completedImageResult(snapshot);
      assert.equal(completed.snapshot.id, snapshot.route.id);
      assert.equal(
        completed.snapshot.catalogRevisionId,
        snapshot.catalogModel.revision,
      );
      await assertPersistedJoin(pool, request, runtimeId, completed);
      const effectsBeforeReplay = await DBOS.listWorkflowSteps(runtimeId);
      assert.ok(effectsBeforeReplay);

      assert.deepEqual(
        await admission.submit({ taskId: workflowId, ...request }),
        { workflowId, replayed: true },
      );
      await DBOS.retrieveWorkflow(runtimeId).getResult();
      assert.equal(mediaProviderSubmissions.length, 1);
      const effectsAfterReplay = await DBOS.listWorkflowSteps(runtimeId);
      assert.ok(effectsAfterReplay);
      assert.equal(effectsAfterReplay.length, effectsBeforeReplay.length);
      assert.deepEqual(
        effectsAfterReplay.map(({ name }) => name),
        effectsBeforeReplay.map(({ name }) => name),
      );
      await assertPersistedJoin(pool, request, runtimeId, completed);
    } finally {
      if (dbosLaunched) {
        await DBOS.shutdown({ deregister: true });
      }
      await cleanup(pool, request, runtimeId);
      await pool.end();
    }
  },
);

class ExternalModelCompletionFixture implements StructuredNodeRunner {
  constructor(
    private readonly snapshot: NonNullable<
      HarnessWorkflowInput['executionSnapshot']
    >,
  ) {}

  async run<Output>(request: StructuredNodeRunnerRequest<Output>) {
    await request.beforeProviderAttempt?.();
    let output: unknown;
    if (request.schemaName === 'harness_intent_naming_v1') {
      output = {
        normalizedIntent: '制作夏日护理项目图片',
        taskType: 'daily_service_exposure',
        deliveryLayer: 'finished_media',
        relevantAssetCategories: ['material'],
        usedAssetCategories: ['material'],
        route: 'customized',
        implicitConstraints: ['只使用已授权素材'],
        blockingGap: null,
      };
    } else if (request.schemaName === 'harness_image_brief_v1') {
      const assetId = this.snapshot.sources.assets[0]?.id;
      assert.ok(assetId);
      output = {
        kind: 'image',
        intent: {
          operation: 'image.generate',
          purpose: '夏日护理活动海报',
          subject: '夏日护理项目',
          scene: '真实门店护理区',
          composition: '竖版主视觉，主体清晰',
          references: [
            {
              assetId,
              assetRevision: 'asset-r1',
              slot: 'style_ref',
              mimeType: 'image/jpeg',
              sizeBytes: 1024,
              factRefs: [],
              rightsRefs: [assetId],
            },
          ],
          exactText: [],
          changes: [],
          invariants: [],
          factRefs: [],
          rightsRefs: [assetId],
          outputPlan: { kind: 'single' },
        },
        prompt: '为夏日护理项目生成一张竖版活动海报，保留真实门店护理氛围。',
        referenceAssetIds: [assetId],
        parameters: { ratio: '9:16', resolution: '1080p' },
        constraints: ['不得编造价格或护理效果'],
      };
    } else {
      throw new Error(`Unexpected production schema ${request.schemaName}.`);
    }
    return {
      output: request.schema.parse(output),
      attempts: 1,
      providerTaskRef: `brief-provider-${this.snapshot.task.id}`,
      replayed: false,
      usage: { inputTokens: 10, outputTokens: 20 },
    };
  }
}

function productionMediaRequest(
  workflowId: string,
  workspaceId: string,
): HarnessWorkflowInput {
  const snapshot = createCreationExecutionSnapshot(
    {
      actorId: 'owner-production-media-assembly',
      workspaceId,
      idempotencyKey: `submission-${workflowId}`,
      taskId: workflowId,
      workId: `work-${workflowId}`,
      contentPackageId: `package-${workflowId}`,
      expectedContentPackageRevision: 0,
      creationMode: 'customized',
      intent: '制作夏日护理项目图片',
      surface: { id: 'surface-production-media', revision: 'surface-r1' },
      recipe: { id: 'recipe-production-media', revision: 'recipe-r1' },
      lens: 'image',
      operation: 'image.generate',
      platform: { id: 'xiaohongshu' },
      contentPackagePlatform: 'xiaohongshu',
      distributionTarget: 'export',
      deliverable: {
        kind: 'image_set',
        quantity: 1,
        aspectRatio: '9:16',
      },
      deliverables: [
        {
          id: 'image-main',
          kind: 'image',
          order: 0,
          quantity: 1,
          aspectRatio: '9:16',
        },
      ],
      sources: {
        assets: [
          {
            id: `source-asset-${workflowId}`,
            revision: 'asset-r1',
            role: 'reference',
          },
        ],
      },
      rights: { revision: 'rights-r1', summary: 'authorized' },
      identity: OFFICIAL_NEUTRAL_IDENTITY,
      modelPolicy: {
        id: 'policy-production-media',
        revision: 'policy-r1',
        mode: 'fixed',
      },
      catalogModel: {
        id: 'model-production-media',
        revision: 'model-r1',
      },
      quote: { id: `quote-${workflowId}`, revision: 'quote-r1' },
      route: { id: `route-${workflowId}`, revision: 'route-r1' },
      briefContext: { id: `brief-${workflowId}`, revision: 1 },
      contentModules: ['social_cover'],
    },
    now,
  );
  return {
    actorId: snapshot.actorId,
    workspaceId,
    packageId: snapshot.contentPackage.id,
    expectedRevision: snapshot.contentPackage.expectedRevision,
    workflowRevision: snapshot.revision,
    creationMode: snapshot.creationMode,
    rawInput: snapshot.intent.text,
    intent: {
      context: {
        workId: snapshot.work.id,
        intent: snapshot.intent.text,
        sourceSummaries: [],
      },
      assetReferences: [`source-asset-${workflowId}`],
    },
    executionSnapshot: snapshot,
  };
}

function completedImageResult(
  snapshot: NonNullable<HarnessWorkflowInput['executionSnapshot']>,
): ModelSupplyResult {
  const suffix = snapshot.task.id.replace('production-media-assembly-', '');
  const attempt = {
    acceptance: 'accepted' as const,
    catalogModelId: snapshot.catalogModel.id,
    createdAt: now,
    deploymentId: 'deployment-production-media',
    id: `attempt-${suffix}`,
    jobId: `job-${suffix}`,
    providerTaskRef: `provider-task-${suffix}`,
    status: 'completed' as const,
  };
  const providerCost = {
    amount: 1,
    currency: 'CNY' as const,
    id: `cost-${suffix}`,
    status: 'observed' as const,
    usage: { mediaUnits: 1 },
  };
  return {
    jobId: attempt.jobId,
    status: 'completed',
    snapshot: {
      actualCatalogModelId: snapshot.catalogModel.id,
      catalogRevisionId: snapshot.catalogModel.revision,
      deploymentId: attempt.deploymentId,
      id: snapshot.route.id,
    } as ModelSupplyResult['snapshot'],
    attempt,
    attempts: [attempt],
    asset: {
      contentType: 'image/png',
      id: `image-asset-${suffix}`,
      objectKey: `owned/image-asset-${suffix}`,
      sha256: 'b'.repeat(64),
      sizeBytes: 1024,
      sourceTaskRef: attempt.providerTaskRef,
    },
    usage: {
      id: `usage-${suffix}`,
      quantity: 0,
      status: 'committed',
    },
    providerCost,
    providerCosts: [providerCost],
  };
}

async function seedContentPackage(
  pool: Pool,
  request: HarnessWorkflowInput,
) {
  const snapshot = requireExecutionSnapshot(request);
  const contentPackage = buildContentPackage({
    id: request.packageId,
    kind: 'image_text',
    source: {
      assetIds: snapshot.sources.assets.map(({ id }) => id),
      creationExecutionSnapshot: {
        id: snapshot.id,
        revision: snapshot.revision,
        schemaVersion: snapshot.schemaVersion,
      },
      targetPlatform: 'xiaohongshu',
      workflowId: snapshot.task.id,
      workflowRevision: snapshot.revision,
      workId: snapshot.work.id,
    },
    timestamp: now,
    workspaceId: request.workspaceId,
  });
  await pool.query(
    `INSERT INTO p1_content_packages
       (workspace_id, id, payload, revision, updated_at)
     VALUES ($1, $2, $3::jsonb, 0, $4::timestamptz)`,
    [
      request.workspaceId,
      request.packageId,
      JSON.stringify(contentPackage),
      now,
    ],
  );
}

async function assertPersistedJoin(
  pool: Pool,
  request: HarnessWorkflowInput,
  runtimeId: string,
  completed: ModelSupplyResult,
) {
  const snapshot = requireExecutionSnapshot(request);
  const asset = completed.asset;
  assert.ok(asset);
  const traces = await pool.query<{ stage: string }>(
    `SELECT stage
       FROM harness_runtime.decision_traces
      WHERE task_id=$1
      ORDER BY created_at, id`,
    [runtimeId],
  );
  assert.deepEqual(
    traces.rows.map(({ stage }) => stage),
    expectedStages,
  );

  const persisted = await pool.query<{
    payload: unknown;
    revision: string;
  }>(
    `SELECT payload, revision::text AS revision
       FROM p1_content_packages
      WHERE workspace_id=$1 AND id=$2`,
    [request.workspaceId, request.packageId],
  );
  assert.equal(persisted.rows[0]?.revision, '1');
  const contentPackage = contentPackageSchema.parse(
    persisted.rows[0]?.payload,
  );
  assert.equal(contentPackage.revision, 1);
  assert.equal(contentPackage.status, 'review_ready');
  assert.equal(contentPackage.source.creationExecutionSnapshot?.id, snapshot.id);
  assert.equal(contentPackage.source.workflowId, snapshot.task.id);
  assert.equal(contentPackage.source.workId, snapshot.work.id);
  assert.deepEqual(contentPackage.generated.assetIds, [asset.id]);
  assert.deepEqual(contentPackage.generated.ownedAssets, [asset]);
  assert.equal(contentPackage.generated.childRuns.length, 1);
  const childRun = contentPackage.generated.childRuns[0];
  assert.ok(childRun);
  assert.equal(childRun.runId, completed.jobId);
  assert.equal(childRun.actualCatalogModelId, snapshot.catalogModel.id);
  assert.equal(childRun.routeSnapshot?.id, snapshot.route.id);
  assert.equal(
    childRun.routeSnapshot?.catalogRevisionId,
    snapshot.catalogModel.revision,
  );
  assert.equal(childRun.providerAttempts?.length, 1);
  assert.equal(
    childRun.providerAttempts?.[0]?.providerTaskRef,
    completed.attempt.providerTaskRef,
  );
  assert.equal(childRun.providerAttempts?.[0]?.status, 'completed');
  assert.deepEqual(childRun.productUsage, {
    quantity: completed.usage.quantity,
    status: completed.usage.status,
  });
  assert.deepEqual(childRun.providerCost, {
    amount: completed.providerCost.amount,
    currency: completed.providerCost.currency,
    status: completed.providerCost.status,
  });
  assert.deepEqual(childRun.providerCosts, completed.providerCosts);
  const currentVersion = contentPackage.versions.find(
    ({ id }) => id === contentPackage.currentVersionId,
  );
  assert.equal(currentVersion?.title, '夏日护理活动海报');
  assert.deepEqual(currentVersion?.orderedAssetIds, [asset.id]);

  const receipts = await pool.query<{
    delivery: { packageId: string; revision: number; versionId: string };
    idempotency_key: string;
  }>(
    `SELECT idempotency_key, delivery
       FROM execution_spine.content_package_write_receipts
      WHERE workspace_id=$1 AND package_id=$2`,
    [request.workspaceId, request.packageId],
  );
  assert.deepEqual(receipts.rows, [
    {
      idempotency_key: `harness-media:${snapshot.task.id}:image`,
      delivery: {
        packageId: request.packageId,
        revision: 1,
        versionId: contentPackage.currentVersionId,
      },
    },
  ]);
}

async function cleanup(
  pool: Pool,
  request: HarnessWorkflowInput,
  runtimeId: string,
) {
  await pool.query(
    `DELETE FROM harness_runtime.langfuse_outbox
      WHERE audit_id IN (
        SELECT id FROM harness_runtime.audit_events WHERE workflow_id=$1
      )`,
    [runtimeId],
  );
  await pool.query(
    'DELETE FROM harness_runtime.audit_events WHERE workflow_id=$1',
    [runtimeId],
  );
  await pool.query(
    'DELETE FROM harness_runtime.decision_traces WHERE task_id=$1',
    [runtimeId],
  );
  await pool.query(
    'DELETE FROM harness_runtime.task_requests WHERE runtime_id=$1',
    [runtimeId],
  );
  await pool.query(
    `DELETE FROM execution_spine.content_package_write_receipts
      WHERE workspace_id=$1 AND package_id=$2`,
    [request.workspaceId, request.packageId],
  );
  await pool.query(
    'DELETE FROM p1_content_packages WHERE workspace_id=$1 AND id=$2',
    [request.workspaceId, request.packageId],
  );
}

function requireExecutionSnapshot(request: HarnessWorkflowInput) {
  if (!request.executionSnapshot) {
    throw new Error('Production media assembly requires a frozen snapshot.');
  }
  return request.executionSnapshot;
}
