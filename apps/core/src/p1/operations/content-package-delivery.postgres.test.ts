import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import {
  contentPackageDeliveryAttemptId,
  contentPackageSchema,
  type ContentPackage,
} from '@meiye/contracts';
import { Pool } from 'pg';

import {
  ContentPackageDeliveryError,
  ContentPackageDeliveryService,
} from './content-package-delivery.js';
import { insertContentPackageRow } from './postgres-content-package-write-adapter.js';
import { PostgresOperationsRepository } from './postgres-repository.js';
import type { OperationsWorkspaceState } from './types.js';

const connectionString = process.env.TEST_DATABASE_URL;

function workspaceState(workspaceId: string): OperationsWorkspaceState {
  return {
    auditEvents: [],
    commandReceipts: [],
    composerConversations: [],
    contentPackages: [],
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

function assistedPackage(input: {
  approvalReceiptId: string;
  packageId: string;
  workspaceId: string;
}): ContentPackage {
  const createdAt = '2026-08-20T00:00:00.000Z';
  const deliveryAttemptId = contentPackageDeliveryAttemptId(
    input.approvalReceiptId,
  );
  return contentPackageSchema.parse({
    compliance: { aigcLabelEnabled: true, watermarkEnabled: false },
    createdAt,
    deliveryEvents: [
      {
        actorId: 'owner-a',
        artifactReceiptId: 'export-receipt-a',
        deliveryIdentity: {
          approvalReceiptId: input.approvalReceiptId,
          deliveryAttemptId,
          schema: 'approval_receipt_v1',
        },
        id: 'assisted-handoff-a',
        occurredAt: createdAt,
        platform: 'douyin',
        source: 'native',
        type: 'assisted_handoff_prepared',
        variantVersionId: 'douyin-v1',
      },
    ],
    exportReceipts: [],
    generated: { assetIds: [], childRuns: [] },
    id: input.packageId,
    kind: 'image_text',
    lineage: {},
    revision: 3,
    rights: { state: 'authorized' },
    source: { assetIds: [], workflowId: 'workflow-a' },
    status: 'accepted',
    updatedAt: createdAt,
    variants: ['xiaohongshu', 'douyin', 'video_account'].map((platform) => ({
      currentVersionId: `${platform}-v1`,
      id: `variant-${platform}-a`,
      platform,
      versions: [
        {
          body: '正文',
          createdAt,
          id: `${platform}-v1`,
          orderedAssetIds: [],
          title: '标题',
          topics: [],
        },
      ],
    })),
    versions: [],
    workspaceId: input.workspaceId,
  });
}

test(
  'Postgres serializes distinct manual publication writes at one package revision',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID();
    const workspaceId = `workspace-manual-occ-${suffix}`;
    const userId = `owner-manual-occ-${suffix}`;
    const packageId = `package-manual-occ-${suffix}`;
    const approvalReceiptId = `approval-manual-occ-${suffix}`;
    const context = {
      actor: 'owner' as const,
      correlationId: `manual-occ-${suffix}`,
      userId,
      workspaceId,
    };
    const repository = new PostgresOperationsRepository(pool);
    const service = new ContentPackageDeliveryService(repository, {
      approvalPolicy: {
        async resolve() {
          throw new Error('manual result does not resolve approval policy');
        },
      },
      async capability(platform) {
        return { mode: 'assisted' as const, platform, reason: 'test' };
      },
      createId: () => `event-${randomUUID()}`,
      publisher: {
        async publish() {
          throw new Error('manual result does not publish through provider');
        },
      },
    });

    try {
      await repository.migrate();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS workspace_memberships (
          workspace_id text NOT NULL,
          user_id text NOT NULL,
          role text NOT NULL DEFAULT 'owner',
          PRIMARY KEY (workspace_id, user_id)
        )
      `);
      await pool.query(
        `INSERT INTO "user" (id, name, email)
         VALUES ($1, 'Content package delivery owner', $2)
         ON CONFLICT (id) DO NOTHING`,
        [userId, `${userId}@example.test`],
      );
      await pool.query(
        `INSERT INTO workspaces (id, name)
         VALUES ($1, 'Content package delivery OCC')
         ON CONFLICT (id) DO NOTHING`,
        [workspaceId],
      );
      await pool.query(
        `INSERT INTO workspace_memberships (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (workspace_id, user_id) DO NOTHING`,
        [workspaceId, context.userId],
      );
      await repository.saveWorkspace(workspaceState(workspaceId));
      const contentPackage = assistedPackage({
        approvalReceiptId,
        packageId,
        workspaceId,
      });
      await insertContentPackageRow(pool, {
        id: contentPackage.id,
        payload: contentPackage,
        revision: contentPackage.revision,
        updatedAt: contentPackage.updatedAt,
        workspaceId,
      });

      const outcomes = await Promise.allSettled([
        service.recordManualResult(context, {
          expectedRevision: 3,
          packageId,
          platform: 'douyin',
          platformUrl: 'https://www.douyin.com/video/manual-occ-a',
          status: 'published',
          variantVersionId: 'douyin-v1',
        }),
        service.recordManualResult(context, {
          expectedRevision: 3,
          packageId,
          platform: 'douyin',
          platformUrl: 'https://www.douyin.com/video/manual-occ-b',
          status: 'published',
          variantVersionId: 'douyin-v1',
        }),
      ]);

      assert.deepEqual(
        outcomes.map((outcome) => outcome.status).sort(),
        ['fulfilled', 'rejected'],
      );
      const rejected = outcomes.find(
        (outcome): outcome is PromiseRejectedResult =>
          outcome.status === 'rejected',
      );
      assert.ok(rejected?.reason instanceof ContentPackageDeliveryError);
      assert.equal(
        rejected?.reason.code,
        'CONTENT_PACKAGE_REVISION_CONFLICT',
      );

      const stored = await repository.loadWorkspace(workspaceId);
      const updated = stored?.contentPackages.find(({ id }) => id === packageId);
      assert.equal(updated?.revision, 4);
      const manual = updated?.deliveryEvents?.filter(
        (event) => event.type === 'manual_publish_result',
      );
      assert.equal(manual?.length, 1);
      const event = manual?.[0];
      if (event?.type !== 'manual_publish_result') return;
      assert.equal(event.beforeRevision, 3);
      assert.equal(event.afterRevision, 4);
      assert.equal(event.deliveryIdentity?.approvalReceiptId, approvalReceiptId);
      assert.equal(
        event.deliveryIdentity?.deliveryAttemptId,
        contentPackageDeliveryAttemptId(approvalReceiptId),
      );
    } finally {
      await pool
        .query(`DELETE FROM p1_content_packages WHERE workspace_id = $1`, [
          workspaceId,
        ])
        .catch(() => undefined);
      await pool
        .query(`DELETE FROM p1_operations_audit_events WHERE workspace_id = $1`, [
          workspaceId,
        ])
        .catch(() => undefined);
      await pool
        .query(`DELETE FROM workspace_memberships WHERE workspace_id = $1`, [
          workspaceId,
        ])
        .catch(() => undefined);
      await pool
        .query(`DELETE FROM workspaces WHERE id = $1`, [workspaceId])
        .catch(() => undefined);
      await pool
        .query(`DELETE FROM "user" WHERE id = $1`, [userId])
        .catch(() => undefined);
      await pool.end();
    }
  },
);
