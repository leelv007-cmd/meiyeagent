import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';

import { contentPackageSchema } from '@meiye/contracts';

import { buildContentPackage } from '../operations/content-package.js';
import { PostgresStoreFactLedger } from '../operations/postgres-store-fact-ledger.js';
import { PostgresOperationsRepository } from '../operations/postgres-repository.js';
import {
  HarnessDeliveryError,
  PostgresHarnessStore,
} from './postgres-store.js';
import { normalizeHarnessTerminalFailure } from './terminal-failure.js';
import { harnessRuntimeId } from './workspace-scope.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'delivery commits package CAS, trace, audit and outbox atomically',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    const store = new PostgresHarnessStore(pool);
    await operations.migrate();
    await store.applySchema();
    const suffix = randomUUID();
    const packageId = `harness-package-${suffix}`;
    const workflowId = `harness-delivery-${suffix}`;
    await seedPackage(pool, packageId);
    await seedPackage(pool, packageId, 'workspace-2');
    await seedHarnessTask(store, workflowId, 'workspace-1', packageId);
    await seedHarnessTask(store, workflowId, 'workspace-2', packageId);

    try {
      const delivered = await store.deliverCopyRevision(
        deliveryInput(workflowId, packageId),
      );
      assert.equal(delivered.revision, 1);
      assert.deepEqual(
        await store.deliverCopyRevision(deliveryInput(workflowId, packageId)),
        delivered,
      );
      const otherWorkspaceDelivery = await store.deliverCopyRevision({
        ...deliveryInput(workflowId, packageId),
        workspaceId: 'workspace-2',
      });
      assert.equal(otherWorkspaceDelivery.revision, 1);
      const otherWorkspacePackage = await pool.query<{ revision: number }>(
        `select revision::int as revision from p1_content_packages
          where workspace_id='workspace-2' and id=$1`,
        [packageId],
      );
      assert.equal(otherWorkspacePackage.rows[0]?.revision, 1);

      const conflictWorkflowId = `${workflowId}-conflict`;
      await seedHarnessTask(
        store,
        conflictWorkflowId,
        'workspace-1',
        packageId,
      );
      let conflictError: HarnessDeliveryError | undefined;
      for (let attempt = 0; attempt < 2; attempt += 1) {
        await assert.rejects(
          store.deliverCopyRevision(
            deliveryInput(conflictWorkflowId, packageId),
          ),
          (error: unknown) => {
            if (error instanceof HarnessDeliveryError) conflictError = error;
            return (
              error instanceof HarnessDeliveryError &&
              error.code === 'CONTENT_PACKAGE_REVISION_CONFLICT' &&
              error.status === 409
            );
          },
        );
      }
      assert.ok(conflictError);
      await store.recordTerminalFailure({
        workspaceId: 'workspace-1',
        workflowId: conflictWorkflowId,
        failure: normalizeHarnessTerminalFailure(conflictError),
      });
      assert.deepEqual(
        await store.readTerminalFailure('workspace-1', conflictWorkflowId),
        {
        code: 'CONTENT_PACKAGE_REVISION_CONFLICT',
        status: 409,
        packageId,
        expectedRevision: 0,
        currentRevision: 1,
        },
      );
      const persisted = await pool.query(
        `select payload, revision::int as revision
         from p1_content_packages where workspace_id='workspace-1' and id=$1`,
        [packageId],
      );
      assert.equal(persisted.rows[0]?.revision, 1);
      assert.equal(persisted.rows[0]?.payload.versions.length, 3);
      assert.deepEqual(
        persisted.rows[0]?.payload.versions.map(
          (version: { harnessCandidateId: string }) =>
            version.harnessCandidateId,
        ),
        ['c01', 'c02', 'c03'],
      );
      assert.deepEqual(persisted.rows[0]?.payload.harnessSelection, {
        recommendedCandidateId: 'c01',
      });
      assert.equal(
        persisted.rows[0]?.payload.currentVersionId,
        delivered.versionId,
      );
      const trace = await pool.query(
        `select payload from harness_runtime.decision_traces
         where id=$1`,
        [harnessRuntimeId('workspace-1', `trace-${workflowId}-assembly_delivery`)],
      );
      assert.deepEqual(trace.rows[0]?.payload, {
        delivery: delivered,
        recommendation: {
          recommendedCandidateId: 'c01',
          decisionTrace: {
            whyPost: 'promotion_groupbuy_conversion',
            expressionIdentity: 'identity-1',
            factReferences: ['fact-1'],
            platforms: ['xiaohongshu'],
            customerAction: '私信预约',
            complianceStatus: 'seven_gates_passed',
            deliverables: ['copy_revision:1'],
          },
        },
      });
      const evidence = await pool.query(
        `select
           (select count(*)::int from harness_runtime.decision_traces where task_id=$1) as traces,
           (select count(*)::int from harness_runtime.audit_events where workflow_id=$1 and event_type='package_delivered') as deliveries,
           (select count(*)::int from harness_runtime.audit_events where workflow_id=$2 and event_type='revision_conflict') as conflicts`,
        [
          harnessRuntimeId('workspace-1', workflowId),
          harnessRuntimeId('workspace-1', conflictWorkflowId),
        ],
      );
      assert.deepEqual(evidence.rows[0], {
        traces: 1,
        deliveries: 1,
        conflicts: 1,
      });
    } finally {
      await cleanup(pool, workflowId, packageId, true, 'workspace-2');
      await cleanup(pool, `${workflowId}-conflict`, packageId, false);
      await cleanup(pool, workflowId, packageId);
      await pool.end();
    }
  },
);

test(
  'audit write failure rolls the package revision back',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    const store = new PostgresHarnessStore(pool);
    await operations.migrate();
    await store.applySchema();
    const suffix = randomUUID();
    const identifier = suffix.replaceAll('-', '');
    const packageId = `harness-package-audit-${suffix}`;
    const workflowId = `harness-audit-failure-${suffix}`;
    const runtimeWorkflowId = harnessRuntimeId('workspace-1', workflowId);
    const functionName = `fail_harness_audit_${identifier}`;
    const triggerName = `fail_harness_audit_trigger_${identifier}`;
    await seedPackage(pool, packageId);
    await seedHarnessTask(store, workflowId, 'workspace-1', packageId);
    await pool.query(`
      create function harness_runtime.${functionName}() returns trigger
      language plpgsql as $$
      begin
        if new.workflow_id = '${runtimeWorkflowId}' then
          raise exception 'simulated harness audit failure';
        end if;
        return new;
      end $$;
      create trigger ${triggerName}
      before insert on harness_runtime.audit_events
      for each row execute function harness_runtime.${functionName}();
    `);

    try {
      await assert.rejects(
        store.deliverCopyRevision(deliveryInput(workflowId, packageId)),
        /simulated harness audit failure/u,
      );
      const persisted = await pool.query(
        `select payload, revision::int as revision
         from p1_content_packages where workspace_id='workspace-1' and id=$1`,
        [packageId],
      );
      assert.equal(persisted.rows[0]?.revision, 0);
      assert.equal(persisted.rows[0]?.payload.versions.length, 0);
    } finally {
      await pool.query(
        `drop trigger if exists ${triggerName} on harness_runtime.audit_events;
         drop function if exists harness_runtime.${functionName}();`,
      );
      await cleanup(pool, workflowId, packageId);
      await pool.end();
    }
  },
);

test(
  'legacy delivery receipt replays after runtime identity migration',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    const store = new PostgresHarnessStore(pool);
    await operations.migrate();
    await store.applySchema();
    const suffix = randomUUID();
    const packageId = `legacy-delivery-package-${suffix}`;
    const workflowId = `legacy-delivery-workflow-${suffix}`;
    const input = deliveryInput(workflowId, packageId);
    await seedPackage(pool, packageId);
    await seedLegacyHarnessTask(pool, workflowId, packageId);

    try {
      const delivered = await store.deliverCopyRevision(input);
      await pool.query(
        `update harness_runtime.audit_events
            set payload=$2::jsonb
          where id=$1`,
        [
          `audit-${workflowId}-package-delivered`,
          JSON.stringify(delivered),
        ],
      );

      const restartedStore = new PostgresHarnessStore(pool);
      assert.deepEqual(
        await restartedStore.deliverCopyRevision(input),
        delivered,
      );
      await assert.rejects(
        restartedStore.deliverCopyRevision({
          ...input,
          expectedRevision: 1,
        }),
        /Stored harness delivery receipt is invalid/u,
      );
    } finally {
      await cleanupLegacy(pool, workflowId, packageId);
      await pool.end();
    }
  },
);

// GL-25 attribution (test bug, not implementation):
// deliverCopyRevision already writes lineage.reusedFromPackageId when reuseSeed
// is present (postgres-store.ts). The flaky red was the stale-content scan using
// bare substring "199", which false-positives when randomUUID()/hex digests in
// package or version ids contain "199" (~0.5% of runs). Keep unique source
// markers only ("旧价格 199", Chinese tokens, asset-old).
test(
  'reuse delivery creates a new lineage package without copying source deliverable content',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    const store = new PostgresHarnessStore(pool);
    await operations.migrate();
    await store.applySchema();
    const suffix = randomUUID();
    const sourcePackageId = `reuse-source-${suffix}`;
    const packageId = `reuse-target-${suffix}`;
    const workflowId = `reuse-workflow-${suffix}`;
    await seedReusablePackage(pool, sourcePackageId);
    await seedHarnessTask(store, workflowId, 'workspace-1', packageId);
    try {
      const input = {
        ...deliveryInput(workflowId, packageId),
        assetIds: ['asset-current'],
        reuseSeed: {
          assetId: 'series-a',
          assetRevision: 1,
          sourcePackageId,
          sourceVersionId: `${sourcePackageId}-source-v1`,
          sourcePackageRevision: 3,
          assetRevisionId: 'series-a:1',
          fixedItemKeys: ['structure.three-part'],
          variableSlotKeys: ['offer.price'],
        },
      };
      const delivered = await store.deliverCopyRevision(input);
      assert.deepEqual(await store.deliverCopyRevision(input), delivered);
      const target = await pool.query(
        `select payload, revision::int as revision
           from p1_content_packages
          where workspace_id='workspace-1' and id=$1`,
        [packageId],
      );
      const contentPackage = contentPackageSchema.parse(
        target.rows[0]?.payload,
      );
      assert.equal(target.rows[0]?.revision, 1);
      assert.deepEqual(contentPackage.lineage, {
        reusedFromPackageId: sourcePackageId,
      });
      assert.equal(
        contentPackage.versions[0]?.body,
        '基于当前已确认团购事实的文案。',
      );
      assert.deepEqual(contentPackage.versions[0]?.orderedAssetIds, [
        'asset-current',
      ]);
      assert.equal(contentPackage.versions[0]?.derivedFromVersionId, undefined);
      const serialized = JSON.stringify(contentPackage);
      for (const stale of [
        '旧正文',
        '旧价格 199',
        '旧标题',
        '旧话题',
        'asset-old',
      ]) {
        assert.equal(serialized.includes(stale), false);
      }
      const source = await pool.query(
        `select payload, revision::int as revision
           from p1_content_packages
          where workspace_id='workspace-1' and id=$1`,
        [sourcePackageId],
      );
      assert.equal(source.rows[0]?.revision, 3);
      assert.equal(
        source.rows[0]?.payload.versions[0].body,
        '旧正文，旧价格 199。',
      );
      const trace = await pool.query(
        `select payload from harness_runtime.decision_traces where id=$1`,
        [harnessRuntimeId('workspace-1', `trace-${workflowId}-assembly_delivery`)],
      );
      assert.deepEqual(trace.rows[0]?.payload.reuse, input.reuseSeed);
      const audit = await pool.query(
        `select payload from harness_runtime.audit_events where id=$1`,
        [harnessRuntimeId('workspace-1', `audit-${workflowId}-package-delivered`)],
      );
      assert.deepEqual(audit.rows[0]?.payload.reuse, input.reuseSeed);
    } finally {
      await cleanup(pool, workflowId, packageId);
      await pool.query(
        `delete from p1_content_packages where workspace_id='workspace-1' and id=$1`,
        [sourcePackageId],
      );
      await pool.end();
    }
  },
);

test(
  'reads the delivered recommendation only at its persisted fact revision',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const operations = new PostgresOperationsRepository(pool);
    const facts = new PostgresStoreFactLedger(pool);
    const store = new PostgresHarnessStore(pool);
    await operations.migrate();
    await facts.migrate();
    await store.applySchema();
    const suffix = randomUUID();
    const workspaceId = `harness-recommendation-workspace-${suffix}`;
    const packageId = `harness-recommendation-package-${suffix}`;
    const workflowId = `harness-recommendation-workflow-${suffix}`;
    await seedPackage(pool, packageId, workspaceId);

    try {
      await facts.append({
        factId: 'offer-price',
        workspaceId,
        kind: 'price',
        key: 'offer.price',
        value: { amount: 398, currency: 'CNY' },
        scope: { storeId: 'store-1' },
        source: {
          kind: 'user_confirmation',
          referenceId: 'confirmation-1',
          capturedAt: '2026-07-18T00:00:00.000Z',
        },
        effectiveFrom: '2026-07-18T00:00:00.000Z',
        expiresAt: null,
        recordedAt: '2026-07-18T00:00:00.000Z',
        recordedBy: 'owner-1',
        expectedRevision: 0,
      });
      await store.claim({
        taskId: workflowId,
        fingerprint: 'recommendation-request-v1',
        request: {
          actorId: 'owner-1',
          workspaceId,
          packageId,
          expectedRevision: 0,
          workflowRevision: 1,
          rawInput: '把新团购做一套能发的',
          intent: {
            context: {
              workId: 'work-1',
              intent: '把新团购做一套能发的',
              sourceSummaries: [],
            },
            assetReferences: [],
          },
        },
      });
      for (const [stage, payload] of [
        ['context_injection', { sourceRevisions: { facts: 1 } }],
        [
          'brief_compilation',
          { factRefs: ['store_fact:offer-price:1'] },
        ],
        [
          'execution_selection',
          {
            winnerCandidateId: 'c01',
            candidateScores: [
              { candidateId: 'c01', reason: '适合当前换季场景' },
            ],
          },
        ],
      ] as const) {
        await store.recordStageTrace({
          workspaceId,
          id: `trace-${workflowId}-${stage}`,
          taskId: workflowId,
          stage,
          payload,
        });
      }
      const delivered = await store.deliverCopyRevision(
        deliveryInput(workflowId, packageId, workspaceId),
      );

      const current = await store.readTodayRecommendation(workspaceId);
      assert.equal(current.recommendation?.packageId, packageId);
      assert.equal(current.recommendation?.versionId, delivered.versionId);
      assert.equal(current.recommendation?.factsRevision, 1);
      assert.equal(current.recommendation?.whyNow, '适合当前换季场景');

      await facts.append({
        factId: 'offer-price',
        workspaceId,
        kind: 'price',
        key: 'offer.price',
        value: { amount: 428, currency: 'CNY' },
        scope: { storeId: 'store-1' },
        source: {
          kind: 'user_confirmation',
          referenceId: 'confirmation-2',
          capturedAt: '2026-07-18T00:02:00.000Z',
        },
        effectiveFrom: '2026-07-18T00:02:00.000Z',
        expiresAt: null,
        recordedAt: '2026-07-18T00:02:00.000Z',
        recordedBy: 'owner-1',
        expectedRevision: 1,
      });
      assert.deepEqual(await store.readTodayRecommendation(workspaceId), {
        workspaceId,
        currentFactsRevision: 2,
        recommendation: null,
        stale: true,
      });
    } finally {
      await cleanup(pool, workflowId, packageId, true, workspaceId);
      await facts.deleteWorkspaceForTest(workspaceId);
      await pool.end();
    }
  },
);

async function seedPackage(
  pool: Pool,
  packageId: string,
  workspaceId = 'workspace-1',
) {
  const timestamp = '2026-07-18T00:00:00.000Z';
  const contentPackage = buildContentPackage({
    id: packageId,
    workspaceId,
    kind: 'image_text',
    source: { assetIds: [] },
    timestamp,
  });
  await pool.query(
    `insert into p1_content_packages
       (workspace_id, id, payload, revision, updated_at)
     values ($1,$2,$3,0,$4)`,
    [workspaceId, packageId, JSON.stringify(contentPackage), timestamp],
  );
}

async function seedReusablePackage(pool: Pool, packageId: string) {
  const timestamp = '2026-07-18T00:00:00.000Z';
  const contentPackage = contentPackageSchema.parse({
    ...buildContentPackage({
      id: packageId,
      workspaceId: 'workspace-1',
      kind: 'image_text',
      source: { assetIds: ['asset-old'] },
      timestamp,
    }),
    revision: 3,
    status: 'accepted',
    currentVersionId: `${packageId}-source-v1`,
    versions: [
      {
        id: `${packageId}-source-v1`,
        title: '旧标题',
        body: '旧正文，旧价格 199。',
        orderedAssetIds: ['asset-old'],
        topics: ['旧话题'],
        createdAt: timestamp,
        createdBy: 'owner-source',
        source: 'merchant_edited',
      },
    ],
  });
  await pool.query(
    `insert into p1_content_packages
       (workspace_id, id, payload, revision, updated_at)
     values ('workspace-1',$1,$2,3,$3)`,
    [packageId, JSON.stringify(contentPackage), timestamp],
  );
}

async function seedHarnessTask(
  store: PostgresHarnessStore,
  workflowId: string,
  workspaceId: string,
  packageId: string,
) {
  await store.claim({
    taskId: workflowId,
    fingerprint: `fixture:${workspaceId}:${workflowId}`,
    request: {
      actorId: 'owner-1',
      workspaceId,
      packageId,
      expectedRevision: 0,
      workflowRevision: 1,
      rawInput: '生成团购文案',
      factScope: { storeId: workspaceId },
      intent: {
        context: {
          workId: workflowId,
          intent: '生成团购文案',
          sourceSummaries: [],
        },
        assetReferences: [],
      },
    },
  });
}

async function seedLegacyHarnessTask(
  pool: Pool,
  workflowId: string,
  packageId: string,
) {
  await pool.query(
    `insert into harness_runtime.task_requests
       (task_id, workflow_id, runtime_id, fingerprint, request)
     values ($1,$1,$1,$2,$3::jsonb)`,
    [
      workflowId,
      `legacy:${workflowId}`,
      JSON.stringify({
        actorId: 'owner-1',
        workspaceId: 'workspace-1',
        packageId,
        expectedRevision: 0,
        workflowRevision: 1,
        rawInput: '生成团购文案',
        intent: {
          context: {
            workId: workflowId,
            intent: '生成团购文案',
            sourceSummaries: [],
          },
          assetReferences: [],
        },
      }),
    ],
  );
}

function deliveryInput(
  workflowId: string,
  packageId: string,
  workspaceId = 'workspace-1',
) {
  return {
    workflowId,
    workspaceId,
    packageId,
    expectedRevision: 0,
    platform: 'xiaohongshu' as const,
    occurredAt: '2026-07-18T00:01:00.000Z',
    workflowRevision: 0,
    winner: {
      candidateId: 'c01',
      title: '新团购上线',
      body: '基于当前已确认团购事实的文案。',
      conversionHook: '私信预约',
    },
    candidates: [
      {
        candidateId: 'c01',
        title: '新团购上线',
        body: '基于当前已确认团购事实的文案。',
        conversionHook: '私信预约',
        score: 93,
      },
      {
        candidateId: 'c02',
        title: '换季护理提醒',
        body: '把服务价值和预约方式说清楚。',
        conversionHook: '了解详情',
        score: 86,
      },
      {
        candidateId: 'c03',
        title: '到店护理建议',
        body: '适合近期有护理需求的顾客。',
        conversionHook: '私信咨询',
        score: 81,
      },
    ],
    recommendation: {
      whyPost: 'promotion_groupbuy_conversion',
      expressionIdentity: 'identity-1',
      factReferences: ['fact-1'],
      platforms: ['xiaohongshu'],
      customerAction: '私信预约',
      complianceStatus: 'seven_gates_passed',
    },
  };
}

async function cleanup(
  pool: Pool,
  workflowId: string,
  packageId: string,
  removePackage = true,
  workspaceId = 'workspace-1',
) {
  await pool.query(
    `delete from harness_runtime.decision_traces where task_id=$1`,
    [harnessRuntimeId(workspaceId, workflowId)],
  );
  await pool.query(
    `delete from harness_runtime.audit_events where workflow_id=$1`,
    [harnessRuntimeId(workspaceId, workflowId)],
  );
  await pool.query(
    `delete from harness_runtime.task_requests where task_id=$1`,
    [harnessRuntimeId(workspaceId, workflowId)],
  );
  if (removePackage) {
    await pool.query(
      `delete from p1_content_packages where workspace_id=$1 and id=$2`,
      [workspaceId, packageId],
    );
  }
}

async function cleanupLegacy(
  pool: Pool,
  workflowId: string,
  packageId: string,
) {
  await pool.query(
    `delete from harness_runtime.decision_traces where task_id=$1`,
    [workflowId],
  );
  await pool.query(
    `delete from harness_runtime.audit_events where workflow_id=$1`,
    [workflowId],
  );
  await pool.query(
    `delete from harness_runtime.task_requests where task_id=$1`,
    [workflowId],
  );
  await pool.query(
    `delete from p1_content_packages where workspace_id='workspace-1' and id=$1`,
    [packageId],
  );
}
