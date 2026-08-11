import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';
import { PostgresOperationsRepository } from '../operations/postgres-repository.js';
import type { DurableVideoWorkflow } from './video-workflow-contract.js';
import type { CanonicalVideoRun } from './video-workflow-projection.js';
import {
  liftDurableToCanonical,
  projectDurableVideoWorkflow,
} from './video-workflow-projection.js';
import {
  PostgresCanonicalVideoWorkflowSchema,
  PostgresCanonicalVideoRunStore,
} from './video-workflow-canonical-postgres.js';

const databaseUrl = process.env.TEST_DATABASE_URL;

function legacyFixture(
  workspaceId: string,
  workflowId: string,
): DurableVideoWorkflow {
  return {
    actorId: 'owner-video',
    aigcLabelEnabled: true,
    attempts: [],
    catalogModelId: 'seedance-2',
    clipAssets: [],
    confirmed: false,
    createdAt: '2026-07-20T00:00:00.000Z',
    dataClass: [],
    id: workflowId,
    revision: 0,
    shots: [
      {
        candidates: [],
        candidatesPerShot: 1,
        id: 'opening',
        prompt: '门店开场',
      },
    ],
    status: 'draft',
    storyboardRevision: 'story-v1',
    storyboardVersion: 1,
    updatedAt: '2026-07-20T00:00:00.000Z',
    workId: 'work-video',
    workspaceId,
  };
}

describe(
  'Postgres canonical video workflow store',
  { skip: databaseUrl ? false : 'TEST_DATABASE_URL is not configured' },
  () => {
    const pool = new Pool({ connectionString: databaseUrl });
    const workspaceId = `canonical-video-${randomUUID()}`;
    const workflowId = `workflow-${randomUUID()}`;

    before(async () => {
      await new PostgresOperationsRepository(pool).migrate();
      await pool.query(`
        CREATE TABLE IF NOT EXISTS model_video_workflows (
          workspace_id text NOT NULL,
          workflow_id text NOT NULL,
          workflow jsonb NOT NULL,
          revision bigint NOT NULL DEFAULT 0,
          run_lease_token text,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (workspace_id, workflow_id)
        )
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS model_canonical_video_runs (
          workspace_id text NOT NULL,
          run_id text NOT NULL,
          actor_id text NOT NULL,
          work_id text,
          task jsonb NOT NULL,
          job jsonb NOT NULL,
          assets jsonb NOT NULL,
          revision bigint NOT NULL DEFAULT 0,
          run_lease_token text,
          migrated_from_legacy boolean NOT NULL DEFAULT false,
          updated_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (workspace_id, run_id)
        )
      `);
    });

    after(async () => {
      await pool.query(
        `DELETE FROM p1_creative_assets
          WHERE workspace_id = $1 AND payload->>'videoWorkflowId' IS NOT NULL`,
        [workspaceId],
      );
      await pool.query(
        `DELETE FROM p1_creative_jobs
          WHERE workspace_id = $1 AND payload->>'videoWorkflowId' IS NOT NULL`,
        [workspaceId],
      );
      await pool.query(
        `DELETE FROM p1_content_tasks
          WHERE workspace_id = $1 AND payload->>'videoWorkflowId' IS NOT NULL`,
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM model_video_workflows WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.query(
        'DELETE FROM model_canonical_video_runs WHERE workspace_id = $1',
        [workspaceId],
      );
      await pool.end();
    });

    it('backfills legacy projection into existing generic Task/Job/Asset truth and never writes an independent run authority', async () => {
      const legacy = legacyFixture(workspaceId, workflowId);
      await pool.query(
        `INSERT INTO model_video_workflows
           (workspace_id, workflow_id, workflow, revision, run_lease_token)
         VALUES ($1, $2, $3::jsonb, 0, NULL)`,
        [workspaceId, workflowId, JSON.stringify(legacy)],
      );
      await new PostgresCanonicalVideoWorkflowSchema(pool).migrate();

      const store = new PostgresCanonicalVideoRunStore(pool, workspaceId);
      const migratedRun = await store.getRun(workflowId);
      const migrated = migratedRun
        ? projectDurableVideoWorkflow(migratedRun)
        : undefined;
      assert.deepEqual(migrated, legacy);

      const generic = await pool.query<{
        asset_count: number;
        job: Record<string, unknown>;
        job_record: Record<string, unknown>;
        task: Record<string, unknown>;
        task_record: Record<string, unknown>;
      }>(
        `SELECT task.payload->'videoTask' AS task,
                job.payload->'videoJob' AS job,
                task.payload AS task_record,
                job.payload AS job_record,
                (SELECT count(*)::int
                   FROM p1_creative_assets asset
                  WHERE asset.workspace_id = task.workspace_id
                    AND asset.payload->>'videoWorkflowId' = $2) AS asset_count
           FROM p1_content_tasks task
           JOIN p1_creative_jobs job
             ON job.workspace_id = task.workspace_id
            AND job.payload->>'videoWorkflowId' = task.payload->>'videoWorkflowId'
          WHERE task.workspace_id = $1
            AND task.payload->>'videoWorkflowId' = $2`,
        [workspaceId, workflowId],
      );
      assert.equal(generic.rows[0]?.task.kind, 'video.composed');
      assert.equal(generic.rows[0]?.job.status, 'draft');
      assert.equal(generic.rows[0]?.task_record.source, 'manual');
      assert.equal(generic.rows[0]?.task_record.status, 'todo');
      assert.equal(generic.rows[0]?.job_record.status, 'submitting');
      assert.equal(
        (generic.rows[0]?.job_record.contract as Record<string, unknown>)
          ?.operation,
        'video.generate',
      );
      assert.equal(generic.rows[0]?.asset_count, 0);

      const independentTable = await pool.query<{ table_name: string | null }>(
        `SELECT to_regclass('public.model_canonical_video_runs')::text AS table_name`,
      );
      if (independentTable.rows[0]?.table_name) {
        const independent = await pool.query<{ count: number }>(
          `SELECT count(*)::int AS count FROM model_canonical_video_runs
            WHERE workspace_id = $1 AND run_id = $2`,
          [workspaceId, workflowId],
        );
        assert.equal(independent.rows[0]?.count, 0);
      }

      const confirmed = projectDurableVideoWorkflow(
        await store.putRun(
          liftDurableToCanonical({
          ...migrated!,
          confirmed: true,
          updatedAt: '2026-07-20T00:00:01.000Z',
          }),
          { expectedRevision: 0 },
        ),
      );
      assert.equal(confirmed.revision, 1);
      assert.equal(confirmed.confirmed, true);

      const legacyAfter = await pool.query<{
        workflow: DurableVideoWorkflow;
        row_version: string;
      }>(
        `SELECT workflow, xmin::text AS row_version FROM model_video_workflows
          WHERE workspace_id = $1 AND workflow_id = $2`,
        [workspaceId, workflowId],
      );
      assert.equal(legacyAfter.rows[0]?.workflow.confirmed, false);
      assert.equal(legacyAfter.rows[0]?.workflow.revision, 0);
      const legacyRowVersion = legacyAfter.rows[0]?.row_version;

      const restarted = new PostgresCanonicalVideoRunStore(
        pool,
        workspaceId,
      );
      const restored = await restarted.getRun(workflowId);
      assert.equal(restored?.job.confirmed, true);
      assert.equal(restored?.job.revision, 1);
      const legacyFinal = await pool.query<{
        count: string;
        row_version: string;
      }>(
        `SELECT count(*) OVER ()::text AS count, xmin::text AS row_version
           FROM model_video_workflows
          WHERE workspace_id = $1 AND workflow_id = $2`,
        [workspaceId, workflowId],
      );
      assert.equal(legacyFinal.rows[0]?.count, '1');
      assert.equal(legacyFinal.rows[0]?.row_version, legacyRowVersion);
    });

    it('enforces runnable leases and releases the lease at a terminal status', async () => {
      await new PostgresCanonicalVideoWorkflowSchema(pool).migrate();
      const runId = `lease-policy-${randomUUID()}`;
      const initial = liftDurableToCanonical({
        ...legacyFixture(workspaceId, runId),
        confirmed: true,
      });
      const postgres = new PostgresCanonicalVideoRunStore(pool, workspaceId);
      await postgres.putRun(initial, { expectedRevision: 0 });

      const postgresClaimed = await postgres.claimRun(
        runId,
        workspaceId,
        'lease-1',
      );
      assert.equal(postgresClaimed.job.status, 'running');
      assert.equal(postgresClaimed.job.revision, 1);
      const claimedTask = await pool.query<{ status: string }>(
        `SELECT payload->>'status' AS status FROM p1_content_tasks
          WHERE workspace_id = $1 AND payload->>'videoWorkflowId' = $2`,
        [workspaceId, runId],
      );
      assert.equal(claimedTask.rows[0]?.status, 'in_progress');
      await postgres.assertRunnable(
        runId,
        workspaceId,
        postgresClaimed.job.revision,
        'lease-1',
      );
      await assert.rejects(
        postgres.assertRunnable(
          runId,
          workspaceId,
          postgresClaimed.job.revision,
          'stale-lease',
        ),
        /stale run lease/,
      );

      const completed = {
        ...postgresClaimed,
        job: { ...postgresClaimed.job, status: 'completed' as const },
      };
      const saved = await postgres.putRun(completed, {
        expectedRevision: postgresClaimed.job.revision,
        runLeaseToken: 'lease-1',
      });
      assert.equal(saved.job.status, 'completed');
      assert.equal(saved.job.revision, 2);
      const completedTask = await pool.query<{ status: string }>(
        `SELECT payload->>'status' AS status FROM p1_content_tasks
          WHERE workspace_id = $1 AND payload->>'videoWorkflowId' = $2`,
        [workspaceId, runId],
      );
      assert.equal(completedTask.rows[0]?.status, 'done');
      const persistedLease = await pool.query<{ run_lease_token: string | null }>(
        `SELECT payload->>'runLeaseToken' AS run_lease_token
           FROM p1_creative_jobs
          WHERE workspace_id = $1 AND payload->>'videoWorkflowId' = $2`,
        [workspaceId, runId],
      );
      assert.equal(persistedLease.rows[0]?.run_lease_token, null);
    });

    it('lists, recovers, and cancels canonical runs without a legacy facade', async () => {
      await new PostgresCanonicalVideoWorkflowSchema(pool).migrate();
      const actorId = `actor-${randomUUID()}`;
      const workId = `work-${randomUUID()}`;
      const firstId = `list-first-${randomUUID()}`;
      const secondId = `list-second-${randomUUID()}`;
      const store = new PostgresCanonicalVideoRunStore(pool, workspaceId);
      await store.putRun(
        liftDurableToCanonical({
          ...legacyFixture(workspaceId, firstId),
          actorId,
          workId,
          updatedAt: '2026-07-20T00:00:01.000Z',
        }),
        { expectedRevision: 0 },
      );
      await store.putRun(
        liftDurableToCanonical({
          ...legacyFixture(workspaceId, secondId),
          actorId,
          workId,
          storyboardVersion: 2,
          updatedAt: '2026-07-20T00:00:02.000Z',
        }),
        { expectedRevision: 0 },
      );

      assert.deepEqual(
        (await store.listRuns(workspaceId, actorId)).map((run) => run.runId),
        [secondId, firstId],
      );
      assert.equal(
        (await store.findLatestRun(workspaceId, actorId, workId))?.runId,
        secondId,
      );

      const requestedAt = '2026-07-20T00:00:03.000Z';
      const cancelled = await store.requestCancel(
        firstId,
        workspaceId,
        requestedAt,
      );
      assert.equal(cancelled.job.status, 'cancel_requested');
      assert.equal(cancelled.job.cancelRequestedAt, requestedAt);
      const replayed = await store.requestCancel(
        firstId,
        workspaceId,
        '2026-07-20T00:00:04.000Z',
      );
      assert.equal(replayed.job.revision, cancelled.job.revision);

      const restarted = new PostgresCanonicalVideoRunStore(pool, workspaceId);
      assert.equal((await restarted.getRun(firstId))?.job.status, 'cancel_requested');
      await assert.rejects(
        restarted.listRuns('another-workspace', actorId),
        /workspace does not match/,
      );
    });

    it('imports the superseded independent run row once as read-only compatibility evidence', async () => {
      const runId = `deprecated-canonical-${randomUUID()}`;
      const durable = legacyFixture(workspaceId, runId);
      const oldCanonical = {
        task: {
          kind: 'video.composed',
          storyboardVersion: durable.storyboardVersion,
          storyboardRevision: durable.storyboardRevision,
          catalogModelId: durable.catalogModelId,
          dataClass: durable.dataClass,
          aigcLabelEnabled: durable.aigcLabelEnabled,
          shots: durable.shots,
        },
        job: {
          status: durable.status,
          confirmed: durable.confirmed,
          revision: durable.revision,
          createdAt: durable.createdAt,
          updatedAt: durable.updatedAt,
        },
        assets: {
          attempts: durable.attempts,
          clipAssets: durable.clipAssets,
        },
      };
      await pool.query(
        `INSERT INTO model_canonical_video_runs
           (workspace_id, run_id, actor_id, work_id, task, job, assets,
            revision, run_lease_token)
         VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, 0, NULL)`,
        [
          workspaceId,
          runId,
          durable.actorId,
          durable.workId,
          JSON.stringify(oldCanonical.task),
          JSON.stringify(oldCanonical.job),
          JSON.stringify(oldCanonical.assets),
        ],
      );
      const before = await pool.query<{ xmin: string }>(
        `SELECT xmin::text AS xmin FROM model_canonical_video_runs
          WHERE workspace_id = $1 AND run_id = $2`,
        [workspaceId, runId],
      );

      await new PostgresCanonicalVideoWorkflowSchema(pool).migrate();
      await new PostgresCanonicalVideoWorkflowSchema(pool).migrate();
      const restored = await new PostgresCanonicalVideoRunStore(
        pool,
        workspaceId,
      ).getRun(runId);
      assert.equal(restored?.runId, runId);
      assert.equal(restored?.task.kind, 'video.composed');
      const after = await pool.query<{ count: number; xmin: string }>(
        `SELECT count(*) OVER ()::int AS count, xmin::text AS xmin
           FROM model_canonical_video_runs
          WHERE workspace_id = $1 AND run_id = $2`,
        [workspaceId, runId],
      );
      assert.equal(after.rows[0]?.count, 1);
      assert.equal(after.rows[0]?.xmin, before.rows[0]?.xmin);
    });

    it('persists composed outputs as generic Asset rows and restores review-time OCC edits', async () => {
      await new PostgresCanonicalVideoWorkflowSchema(pool).migrate();
      const runId = `generic-assets-${randomUUID()}`;
      const candidateAsset = {
        id: `candidate-${randomUUID()}`,
        objectKey: `${workspaceId}/candidate.mp4`,
        sha256: 'a'.repeat(64),
        sizeBytes: 10,
        contentType: 'video/mp4' as const,
        technicalValidation: {
          playable: true,
          codec: 'h264' as const,
          durationSeconds: 15,
          hashVerified: true,
        },
      };
      const composedAsset = {
        ...candidateAsset,
        id: `composition-${randomUUID()}`,
        objectKey: `${workspaceId}/composition.mp4`,
        sha256: 'b'.repeat(64),
      };
      const run = liftDurableToCanonical({
        ...legacyFixture(workspaceId, runId),
        clipAssets: [candidateAsset],
        composedAsset,
        confirmed: true,
        subtitleText: '历史字幕只读',
        shots: [
          {
            candidates: [
              {
                index: 0,
                generationKey: `${runId}:shot:opening:candidate:0`,
                prompt: '门店开场',
                status: 'completed',
                attempt: { jobId: 'child-job' },
                attempts: [],
                providerCost: { id: 'cost-1' },
                providerCosts: [],
                latencyMs: 100,
                asset: candidateAsset,
                technicalValidation: candidateAsset.technicalValidation,
                routeSnapshot: { id: 'route-1' },
              },
            ],
            candidatesPerShot: 1,
            id: 'opening',
            prompt: '门店开场',
            selectedCandidateIndex: 0,
          },
        ],
        status: 'awaiting_quality_review',
      } as unknown as DurableVideoWorkflow);
      const store = new PostgresCanonicalVideoRunStore(pool, workspaceId);
      await store.putRun(run, { expectedRevision: 0 });

      const assetRows = await pool.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM p1_creative_assets
          WHERE workspace_id = $1 AND payload->>'videoWorkflowId' = $2`,
        [workspaceId, runId],
      );
      assert.equal(assetRows.rows[0]?.count, 2);
      const assetVersionsBefore = await pool.query<{ id: string; xmin: string }>(
        `SELECT id, xmin::text AS xmin
           FROM p1_creative_assets
          WHERE workspace_id = $1 AND payload->>'videoWorkflowId' = $2
          ORDER BY id`,
        [workspaceId, runId],
      );

      const edited = await store.editRun(
        {
          actorId: 'owner-video',
          correlationId: 'corr-pg-edit',
          edit: {
            kind: 'select_candidate',
            shotId: 'opening',
            candidateIndex: 0,
          },
          expectedRevision: 0,
          workflowId: runId,
          workspaceId,
        },
        '2026-07-20T08:30:00.000Z',
      );
      assert.equal(edited.job.revision, 1);
      assert.equal(edited.task.shots[0]?.selectedCandidateIndex, 0);
      const restarted = new PostgresCanonicalVideoRunStore(pool, workspaceId);
      const restored = (await restarted.getRun(runId)) as CanonicalVideoRun;
      assert.equal(restored.job.revision, 1);
      assert.equal(restored.task.shots[0]?.selectedCandidateIndex, 0);
      assert.equal(restored.task.subtitleText, '历史字幕只读');
      assert.deepEqual(Object.keys(restored.assets.byId).sort(), [
        candidateAsset.id,
        composedAsset.id,
      ].sort());
      const assetVersionsAfter = await pool.query<{ id: string; xmin: string }>(
        `SELECT id, xmin::text AS xmin
           FROM p1_creative_assets
          WHERE workspace_id = $1 AND payload->>'videoWorkflowId' = $2
          ORDER BY id`,
        [workspaceId, runId],
      );
      assert.deepEqual(assetVersionsAfter.rows, assetVersionsBefore.rows);
      await assert.rejects(
        store.editRun(
          {
            actorId: 'owner-video',
            correlationId: 'corr-pg-stale',
            edit: {
              kind: 'select_candidate',
              shotId: 'opening',
              candidateIndex: 0,
            },
            expectedRevision: 0,
            workflowId: runId,
            workspaceId,
          },
          '2026-07-20T08:30:01.000Z',
        ),
        /revision is stale/,
      );
    });
  },
);
