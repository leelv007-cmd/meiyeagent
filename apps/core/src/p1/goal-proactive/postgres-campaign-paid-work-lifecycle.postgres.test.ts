import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import test from 'node:test';

import { Pool } from 'pg';

import { migratePostgresSchema } from '../../postgres-schema-migration.js';
import { PostgresHarnessStore } from '../harness/postgres-store.js';
import { harnessRuntimeId } from '../harness/workspace-scope.js';
import type {
  CampaignPaidWorkLifecycleRecord,
  CampaignPaidWorkResult,
} from './campaign-paid-work-lifecycle.js';
import { PostgresCampaignPaidWorkLifecycleStore } from './postgres-campaign-paid-work-lifecycle.js';

const connectionString = process.env.TEST_DATABASE_URL;

type Submission = { agentThreadId?: string; idempotencyKey: string; intent: string };

test(
  'Campaign lifecycle survives restart, serializes Work claims, and reads canonical delivery',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString });
    const suffix = randomUUID().slice(0, 8);
    const workspaceId = `workspace-campaign-${suffix}`;
    const campaignId = `campaign-${suffix}`;
    const taskId = `task-campaign-${suffix}`;
    const store = new PostgresCampaignPaidWorkLifecycleStore<
      Submission,
      CampaignPaidWorkResult
    >(pool);
    try {
      await migratePostgresSchema(pool, [new PostgresHarnessStore(pool), store]);
      const record: CampaignPaidWorkLifecycleRecord<
        Submission,
        CampaignPaidWorkResult
      > = {
        campaignId,
        campaignPlanRef: { id: `campaign-plan-${suffix}`, revision: 1 },
        planApprovalRequestId: `confirmation-${campaignId}-plan`,
        results: [],
        submissions: [
          { idempotencyKey: `${campaignId}:1`, intent: '第一周' },
          { idempotencyKey: `${campaignId}:2`, intent: '第二周' },
        ],
        workspaceId,
      };
      await store.create(record);

      const restarted = new PostgresCampaignPaidWorkLifecycleStore<
        Submission,
        CampaignPaidWorkResult
      >(pool);
      assert.deepEqual(await restarted.get(workspaceId, campaignId), record);

      const claims = await Promise.all([
        restarted.claimWork(workspaceId, campaignId, 1),
        restarted.claimWork(workspaceId, campaignId, 1),
      ]);
      assert.deepEqual(
        claims.map((claim) => claim.kind).sort(),
        ['busy', 'claimed']
      );

      await pool.query(
        `UPDATE p1_campaign_paid_work_lifecycles
            SET work_1_claimed_at=clock_timestamp() - interval '2 minutes'
          WHERE workspace_id=$1 AND campaign_id=$2`,
        [workspaceId, campaignId]
      );
      assert.equal(
        (await restarted.claimWork(workspaceId, campaignId, 1)).kind,
        'claimed',
        'an expired claim must be recoverable after process restart'
      );

      await restarted.completeWork(workspaceId, campaignId, 1, {
        contentPackage: { id: `package-${suffix}` },
        runId: `run-${suffix}`,
        task: { id: taskId },
        threadId: `thread-${suffix}`,
        work: { id: `work-${suffix}` },
      });
      assert.equal(
        (await restarted.claimWork(workspaceId, campaignId, 1)).kind,
        'complete'
      );
      assert.equal(await restarted.isDelivered(workspaceId, taskId), false);

      const runtimeId = harnessRuntimeId(workspaceId, taskId);
      await pool.query(
        `INSERT INTO harness_runtime.task_requests
           (task_id, workflow_id, runtime_id, fingerprint, request)
         VALUES ($1,$2,$3,$4,$5::jsonb)`,
        [
          runtimeId,
          taskId,
          runtimeId,
          `fingerprint-${suffix}`,
          JSON.stringify({ workspaceId }),
        ]
      );
      await pool.query(
        `INSERT INTO harness_runtime.audit_events
           (id, workflow_id, stage, event_type, payload)
         VALUES ($1,$2,'assembly_delivery','package_delivered','{}'::jsonb)`,
        [`audit-${runtimeId}`, runtimeId]
      );

      assert.equal(await restarted.isDelivered(workspaceId, taskId), true);
    } finally {
      await pool.query(
        'DELETE FROM p1_campaign_paid_work_lifecycles WHERE workspace_id=$1',
        [workspaceId]
      ).catch(() => undefined);
      await pool.query(
        `DELETE FROM harness_runtime.audit_events WHERE id=$1`,
        [`audit-${harnessRuntimeId(workspaceId, taskId)}`]
      ).catch(() => undefined);
      await pool.query(
        'DELETE FROM harness_runtime.task_requests WHERE task_id=$1',
        [harnessRuntimeId(workspaceId, taskId)]
      ).catch(() => undefined);
      await pool.end();
    }
  }
);
