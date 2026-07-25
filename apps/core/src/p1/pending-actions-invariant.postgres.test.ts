import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import type { ContentPackage } from '@meiye/contracts';
import { Pool } from 'pg';

import { PostgresHarnessStore } from './harness/postgres-store.js';
import { HarnessTaskAdmissionService } from './harness/task-admission.js';
import { harnessRuntimeId } from './harness/workspace-scope.js';
import { createPendingApprovalRequest } from './operations/content-package-approval.js';
import {
  OperationsApplicationService,
  PostgresOperationsRepository,
  RecordedCanvasExportAdapter,
  RecordedImageGenerationAdapter,
  TaskBlockingNodeConflictError,
  type OperationsWorkspaceState,
} from './operations/index.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'Postgres pending-actions invariant rejects question registration while approval is pending',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const fixture = await createFixture(true);
    try {
      await assert.rejects(
        fixture.harness.registerPending(
          fixture.workspaceId,
          question(fixture.taskId),
        ),
        blockingConflict(fixture.taskId),
      );
      assert.equal(
        await fixture.harness.readPending(
          fixture.workspaceId,
          fixture.taskId,
        ),
        null,
      );
    } finally {
      await fixture.cleanup();
    }
  },
);

test(
  'Postgres pending-actions invariant rejects approval creation while question is pending',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const fixture = await createFixture(false);
    let exportEffects = 0;
    const service = new OperationsApplicationService(fixture.operations, {
      canvasExporter: new RecordedCanvasExportAdapter(),
      contentPackageExporter: {
        async export() {
          exportEffects += 1;
          return {
            artifactAssetId: `artifact-${fixture.suffix}`,
            artifactObjectKey: `${fixture.workspaceId}/exports/douyin.zip`,
            contentType: 'application/zip' as const,
            sha256: 'a'.repeat(64),
            sizeBytes: 128,
          };
        },
      },
      imageGenerator: new RecordedImageGenerationAdapter(),
      notifier: { async send() {} },
    });
    try {
      await fixture.harness.registerPending(
        fixture.workspaceId,
        question(fixture.taskId),
      );

      await assert.rejects(
        service.exportContentPackage(
          {
            actor: 'owner',
            correlationId: `corr-${fixture.suffix}`,
            userId: fixture.userId,
            workspaceId: fixture.workspaceId,
          },
          {
            expectedRevision: 0,
            packageId: fixture.packageId,
            platform: 'douyin',
          },
        ),
        blockingConflict(fixture.taskId),
      );
      assert.equal(exportEffects, 0);
      const stored = await fixture.operations.loadWorkspace(fixture.workspaceId);
      assert.deepEqual(stored?.contentPackages[0]?.approvalRequests ?? [], []);
      assert.equal(
        stored?.auditEvents.some(
          (event) => event.action === 'content_package.exported',
        ),
        false,
      );
    } finally {
      await fixture.cleanup();
    }
  },
);

async function createFixture(withPendingApproval: boolean) {
  const pool = new Pool({ connectionString });
  const operations = new PostgresOperationsRepository(pool);
  const harness = new PostgresHarnessStore(pool);
  const suffix = randomUUID();
  const workspaceId = `workspace-pending-${suffix}`;
  const userId = `owner-pending-${suffix}`;
  const taskId = `task-pending-${suffix}`;
  const packageId = `package-pending-${suffix}`;
  const runtimeTaskId = harnessRuntimeId(workspaceId, taskId);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS "user" (
      id text PRIMARY KEY,
      name text NOT NULL,
      email text NOT NULL UNIQUE,
      email_verified boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id text PRIMARY KEY,
      name text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS workspace_memberships (
      workspace_id text NOT NULL,
      user_id text NOT NULL,
      role text NOT NULL DEFAULT 'owner',
      created_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY (workspace_id, user_id)
    );
  `);
  await operations.migrate();
  await harness.applySchema();
  await pool.query(
    `INSERT INTO "user" (id, name, email)
     VALUES ($1, 'Pending actions owner', $2)`,
    [userId, `${userId}@example.test`],
  );
  await pool.query(
    `INSERT INTO workspaces (id, name) VALUES ($1, 'Pending actions')`,
    [workspaceId],
  );
  await pool.query(
    `INSERT INTO workspace_memberships (workspace_id, user_id)
     VALUES ($1, $2)`,
    [workspaceId, userId],
  );
  await operations.saveWorkspace(
    workspaceState(
      contentPackage({
        packageId,
        taskId,
        workspaceId,
        withPendingApproval,
      }),
      workspaceId,
    ),
  );
  const admission = new HarnessTaskAdmissionService(harness, {
    async start({ workflowId }) {
      return { workflowId };
    },
  });
  await admission.submit({
    actorId: userId,
    expectedRevision: 0,
    intent: {
      assetReferences: [],
      context: {
        intent: '生成并发布抖音内容',
        sourceSummaries: [],
        workId: `work-${suffix}`,
      },
    },
    packageId,
    rawInput: '生成并发布抖音内容',
    taskId,
    workflowRevision: 1,
    creationMode: 'customized',
    workspaceId,
  });

  return {
    cleanup: async () => {
      await pool.query(
        'DELETE FROM harness_runtime.pending_questions WHERE task_id=$1',
        [runtimeTaskId],
      );
      await pool.query(
        'DELETE FROM harness_runtime.task_requests WHERE task_id=$1',
        [runtimeTaskId],
      );
      await pool.query(
        'DELETE FROM p1_operations_audit_events WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM p1_content_packages WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM workspace_memberships WHERE workspace_id=$1',
        [workspaceId],
      );
      await pool.query('DELETE FROM workspaces WHERE id=$1', [workspaceId]);
      await pool.query('DELETE FROM "user" WHERE id=$1', [userId]);
      await pool.end();
    },
    harness,
    operations,
    packageId,
    suffix,
    taskId,
    userId,
    workspaceId,
  };
}

function contentPackage(input: {
  packageId: string;
  taskId: string;
  workspaceId: string;
  withPendingApproval: boolean;
}): ContentPackage {
  const now = '2026-07-18T10:00:00.000Z';
  const variantVersionId = `douyin-version-${input.packageId}`;
  return {
    ...(input.withPendingApproval
      ? {
          approvalRequests: [
            createPendingApprovalRequest({
              actionKind: 'publish',
              contentPackageRevision: 0,
              createdAt: now,
              packageId: input.packageId,
              platform: 'douyin',
              purpose: 'publish_current_variant',
              taskId: input.taskId,
              variantVersionId,
              workflowId: input.taskId,
              workflowRevision: 1,
              workspaceId: input.workspaceId,
            }),
          ],
        }
      : {}),
    compliance: { aigcLabelEnabled: false, watermarkEnabled: false },
    createdAt: now,
    exportReceipts: [],
    generated: { assetIds: [], childRuns: [] },
    id: input.packageId,
    kind: 'image_text',
    lineage: {},
    revision: 0,
    rights: { state: 'authorized' },
    source: {
      assetIds: [],
      targetPlatform: 'douyin',
      workflowId: input.taskId,
      workflowRevision: 1,
    },
    status: 'accepted',
    updatedAt: now,
    variants: [
      {
        currentVersionId: variantVersionId,
        id: `douyin-${input.packageId}`,
        platform: 'douyin',
        versions: [
          {
            body: '抖音正文',
            createdAt: now,
            id: variantVersionId,
            orderedAssetIds: [],
            title: '抖音标题',
            topics: [],
          },
        ],
      },
      {
        currentVersionId: `xiaohongshu-version-${input.packageId}`,
        id: `xiaohongshu-${input.packageId}`,
        platform: 'xiaohongshu',
        versions: [
          {
            body: '小红书正文',
            createdAt: now,
            id: `xiaohongshu-version-${input.packageId}`,
            orderedAssetIds: [],
            title: '小红书标题',
            topics: [],
          },
        ],
      },
      {
        currentVersionId: `video-account-version-${input.packageId}`,
        id: `video-account-${input.packageId}`,
        platform: 'video_account',
        versions: [
          {
            body: '视频号正文',
            createdAt: now,
            id: `video-account-version-${input.packageId}`,
            orderedAssetIds: [],
            title: '视频号标题',
            topics: [],
          },
        ],
      },
    ],
    versions: [],
    workspaceId: input.workspaceId,
  };
}

function workspaceState(
  contentPackage: ContentPackage,
  workspaceId: string,
): OperationsWorkspaceState {
  return {
    auditEvents: [],
    commandReceipts: [],
    contentPackages: [contentPackage],
    creationEvents: [],
    creativeAssets: [],
    creativeContents: [],
    creativeJobs: [],
    creativeWorks: [],
    exportReceipts: [],
    imageJobs: [],
    taskEvents: [],
    taskSourceLinks: [],
    tasks: [],
    templateShortcuts: [],
    triggerConfigs: [],
    triggerRuns: [],
    userTemplates: [],
    weeklyBatchExecutions: [],
    weeklyFacts: [],
    weeklyReviews: [],
    works: [],
    workspaceId,
  };
}

function question(taskId: string) {
  return {
    freeText: { enabled: true },
    options: [],
    question: '请确认唯一缺口',
    questionId: `question-${taskId}`,
    response: { field: 'intent.cta', reason: '继续生成所必需' },
    scope: 'current_task' as const,
    workflowId: taskId,
    workflowRevision: 1,
  };
}

function blockingConflict(taskId: string) {
  return (error: unknown) =>
    error instanceof TaskBlockingNodeConflictError &&
    error.code === 'TASK_BLOCKING_NODE_CONFLICT' &&
    error.status === 409 &&
    error.message === `Task ${taskId} already has a pending blocking node.`;
}
