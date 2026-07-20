import type { Pool, PoolClient } from 'pg';
import { isDeepStrictEqual } from 'node:util';
import type { PostgresSchemaMigrator } from '../../postgres-schema-migration.js';
import type {
  ContentTask,
  CreativeAssetProjection,
  CreativeJob,
} from '../operations/types.js';
import {
  VideoWorkflowCancellationError,
  VideoWorkflowConcurrencyError,
  type DurableVideoWorkflow,
  type DurableVideoWorkflowSaveOptions,
} from './video-workflow-contract.js';
import type { CanonicalVideoRun } from './video-workflow-projection.js';
import {
  liftDurableToCanonical,
  projectDurableVideoWorkflow,
} from './video-workflow-projection.js';
import {
  type AsyncCanonicalVideoRunStore,
  applyCanonicalVideoEdit,
  assertCanonicalVideoMutationAllowed,
  assertCanonicalVideoRunIsRunnable,
  isCanonicalVideoLeaseReleasingStatus,
  normalizeCanonicalVideoRun,
} from './video-workflow-canonical.js';

const TASK_PREFIX = 'video-task:';
const JOB_PREFIX = 'video-job:';
const ASSET_PREFIX = 'video-asset:';

type StoredVideoTask = ContentTask & {
  actorId: string;
  canonicalWorkId?: string;
  videoTask: CanonicalVideoRun['task'];
  videoWorkflowId: string;
};

type StoredVideoJob = CreativeJob & {
  actorId: string;
  clipAssetIds: string[];
  composedAssetId?: string;
  runLeaseToken?: string;
  taskId: string;
  videoJob: CanonicalVideoRun['job'];
  videoWorkflowId: string;
};

type StoredVideoAsset = CreativeAssetProjection & {
  asset: CanonicalVideoRun['assets']['byId'][string];
  assetId: string;
  videoWorkflowId: string;
};

type TaskRow = { payload: StoredVideoTask };
type JobRow = { payload: StoredVideoJob };
type AssetRow = { payload: StoredVideoAsset };

type LegacyVideoWorkflowRow = {
  revision: string | number;
  run_lease_token: string | null;
  workflow: DurableVideoWorkflow;
  workspace_id: string;
};

type DeprecatedCanonicalRow = {
  actor_id: string;
  assets: Record<string, unknown>;
  job: Record<string, unknown>;
  revision: string | number;
  run_id: string;
  run_lease_token: string | null;
  task: Record<string, unknown>;
  work_id: string | null;
  workspace_id: string;
};

export class PostgresCanonicalVideoWorkflowSchema
  implements PostgresSchemaMigrator
{
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    const target = client ?? this.pool;
    await assertGenericCanonicalTables(target);
    await backfillDeprecatedCanonicalRuns(target);
    await backfillLegacyVideoRuns(target);
  }
}

/**
 * VideoWorkflow persistence over the product's existing generic canonical
 * Task / Job / Asset records. No video-run aggregate table is written.
 *
 * - p1_content_tasks owns storyboard plan and presentation edits.
 * - p1_creative_jobs owns lifecycle, OCC revision and the active run lease.
 * - p1_creative_assets owns one immutable row per candidate/composed asset.
 *
 * model_video_workflows and model_canonical_video_runs are compatibility-only
 * migration inputs. Production reads and commands never fall back to them.
 */
export class PostgresCanonicalVideoRunStore
  implements AsyncCanonicalVideoRunStore
{
  private ready?: Promise<void>;

  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string,
  ) {}

  initialize() {
    this.ready ??= assertGenericCanonicalTables(this.pool);
    return this.ready;
  }

  async getRun(runId: string) {
    await this.initialize();
    return loadRun(this.pool, this.workspaceId, runId);
  }

  async listRuns(workspaceId: string, actorId: string) {
    this.assertWorkspace(workspaceId);
    await this.initialize();
    const result = await this.pool.query<{ run_id: string }>(
      `SELECT payload->>'videoWorkflowId' AS run_id
         FROM p1_creative_jobs
        WHERE workspace_id = $1
          AND payload->>'actorId' = $2
          AND payload->>'videoWorkflowId' IS NOT NULL
        ORDER BY payload->>'updatedAt' DESC,
                 payload->>'videoWorkflowId' DESC`,
      [this.workspaceId, actorId],
    );
    const runs = await Promise.all(
      result.rows.map((row) => loadRun(this.pool, this.workspaceId, row.run_id)),
    );
    return runs.filter((run): run is CanonicalVideoRun => Boolean(run));
  }

  async findLatestRun(workspaceId: string, actorId: string, workId?: string) {
    const runs = (await this.listRuns(workspaceId, actorId)).filter(
      (run) => !workId || run.workId === workId,
    );
    runs.sort((left, right) => {
      if (workId) {
        const storyboard =
          right.task.storyboardVersion - left.task.storyboardVersion;
        if (storyboard !== 0) return storyboard;
      }
      const leftTerminal = isTerminal(left.job.status) ? 1 : 0;
      const rightTerminal = isTerminal(right.job.status) ? 1 : 0;
      if (leftTerminal !== rightTerminal) return leftTerminal - rightTerminal;
      if (!workId) {
        const storyboard =
          right.task.storyboardVersion - left.task.storyboardVersion;
        if (storyboard !== 0) return storyboard;
      }
      const updated = right.job.updatedAt.localeCompare(left.job.updatedAt);
      return updated === 0 ? right.runId.localeCompare(left.runId) : updated;
    });
    return runs[0];
  }

  async putRun(
    run: CanonicalVideoRun,
    options: DurableVideoWorkflowSaveOptions = {},
  ) {
    await this.initialize();
    const candidate = normalizeCanonicalVideoRun(run);
    this.assertWorkspace(candidate.workspaceId);
    return this.withRunLock(candidate.runId, async (client, jobRow) => {
      if (!jobRow) {
        if ((options.expectedRevision ?? candidate.job.revision) !== 0) {
          throw new VideoWorkflowConcurrencyError(
            'Video workflow creation used a stale revision.',
          );
        }
        await insertRun(client, candidate, undefined);
        return candidate;
      }

      const current = await loadRunFromLockedJob(
        client,
        this.workspaceId,
        candidate.runId,
        jobRow,
      );
      const expectedRevision =
        options.expectedRevision ?? candidate.job.revision;
      assertCanonicalVideoMutationAllowed(
        current,
        candidate,
        expectedRevision,
        jobRow.payload.runLeaseToken,
        options,
      );
      if (
        JSON.stringify(projectDurableVideoWorkflow(current)) ===
        JSON.stringify(projectDurableVideoWorkflow(candidate))
      ) {
        return current;
      }
      const saved = normalizeCanonicalVideoRun({
        ...candidate,
        job: { ...candidate.job, revision: current.job.revision + 1 },
      });
      const lease = isCanonicalVideoLeaseReleasingStatus(saved.job.status)
        ? undefined
        : jobRow.payload.runLeaseToken;
      await updateRun(client, saved, expectedRevision, options.runLeaseToken, lease);
      return saved;
    });
  }

  async claimRun(runId: string, workspaceId: string, leaseToken: string) {
    this.assertWorkspace(workspaceId);
    await this.initialize();
    return this.withRunLock(runId, async (client, jobRow) => {
      if (!jobRow) throw new Error(`Unknown durable video workflow ${runId}.`);
      const current = await loadRunFromLockedJob(
        client,
        this.workspaceId,
        runId,
        jobRow,
      );
      if (
        current.job.status === 'cancel_requested' ||
        current.job.status === 'cancelled'
      ) {
        throw new VideoWorkflowCancellationError(
          'Video workflow cancellation was requested.',
        );
      }
      if (isTerminal(current.job.status)) return current;
      if (!current.job.confirmed) {
        throw new Error(
          'Storyboard must be confirmed before clip attempts are created.',
        );
      }
      const claimed = normalizeCanonicalVideoRun({
        ...current,
        job: {
          ...current.job,
          revision: current.job.revision + 1,
          status: 'running',
        },
      });
      await updateRun(
        client,
        claimed,
        current.job.revision,
        undefined,
        leaseToken,
      );
      return claimed;
    });
  }

  async requestCancel(runId: string, workspaceId: string, requestedAt: string) {
    this.assertWorkspace(workspaceId);
    await this.initialize();
    return this.withRunLock(runId, async (client, jobRow) => {
      if (!jobRow) throw new Error(`Unknown durable video workflow ${runId}.`);
      const current = await loadRunFromLockedJob(
        client,
        this.workspaceId,
        runId,
        jobRow,
      );
      if (current.job.status === 'completed' || current.job.status === 'failed') {
        throw new Error('A terminal video workflow cannot be cancelled.');
      }
      if (
        current.job.status === 'cancel_requested' ||
        current.job.status === 'cancelled'
      ) {
        return current;
      }
      const requested = normalizeCanonicalVideoRun({
        ...current,
        job: {
          ...current.job,
          cancelRequestedAt: requestedAt,
          revision: current.job.revision + 1,
          status: 'cancel_requested',
          updatedAt: requestedAt,
        },
      });
      await updateRun(
        client,
        requested,
        current.job.revision,
        undefined,
        undefined,
      );
      return requested;
    });
  }

  async editRun(
    input: Parameters<AsyncCanonicalVideoRunStore['editRun']>[0],
    editedAt: string,
  ) {
    this.assertWorkspace(input.workspaceId);
    await this.initialize();
    return this.withRunLock(input.workflowId, async (client, jobRow) => {
      if (!jobRow) {
        throw new Error(`Unknown durable video workflow ${input.workflowId}.`);
      }
      const current = await loadRunFromLockedJob(
        client,
        this.workspaceId,
        input.workflowId,
        jobRow,
      );
      const edited = applyCanonicalVideoEdit(current, input, editedAt);
      await updateRun(
        client,
        edited,
        input.expectedRevision,
        undefined,
        jobRow.payload.runLeaseToken,
      );
      return edited;
    });
  }

  async assertRunnable(
    runId: string,
    workspaceId: string,
    revision: number,
    leaseToken: string,
  ) {
    this.assertWorkspace(workspaceId);
    await this.initialize();
    const job = await this.pool.query<JobRow>(
      `SELECT payload FROM p1_creative_jobs
        WHERE workspace_id = $1 AND id = $2`,
      [this.workspaceId, jobId(runId)],
    );
    const row = job.rows[0];
    if (!row) throw new Error(`Unknown durable video workflow ${runId}.`);
    const current = await loadRun(this.pool, this.workspaceId, runId);
    if (!current) throw new Error(`Unknown durable video workflow ${runId}.`);
    assertCanonicalVideoRunIsRunnable(
      current,
      revision,
      row.payload.runLeaseToken,
      leaseToken,
    );
  }

  private assertWorkspace(workspaceId: string) {
    if (workspaceId !== this.workspaceId) {
      throw new Error('Video workflow workspace does not match its durable store.');
    }
  }

  private async withRunLock<T>(
    runId: string,
    action: (client: PoolClient, row: JobRow | undefined) => Promise<T>,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `${this.workspaceId}:${runId}`,
      ]);
      const result = await client.query<JobRow>(
        `SELECT payload FROM p1_creative_jobs
          WHERE workspace_id = $1 AND id = $2
          FOR UPDATE`,
        [this.workspaceId, jobId(runId)],
      );
      const value = await action(client, result.rows[0]);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function assertGenericCanonicalTables(
  target: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
) {
  const result = await target.query<{
    assets: string | null;
    jobs: string | null;
    tasks: string | null;
  }>(
    `SELECT to_regclass('public.p1_content_tasks')::text AS tasks,
            to_regclass('public.p1_creative_jobs')::text AS jobs,
            to_regclass('public.p1_creative_assets')::text AS assets`,
  );
  if (!result.rows[0]?.tasks || !result.rows[0]?.jobs || !result.rows[0]?.assets) {
    throw new Error(
      'Generic canonical Task/Job/Asset schema must migrate before video projections.',
    );
  }
}

async function loadRun(
  target: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  workspaceId: string,
  runId: string,
) {
  const [task, job, assets] = await Promise.all([
    target.query<TaskRow>(
      `SELECT payload FROM p1_content_tasks
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, taskId(runId)],
    ),
    target.query<JobRow>(
      `SELECT payload FROM p1_creative_jobs
        WHERE workspace_id = $1 AND id = $2`,
      [workspaceId, jobId(runId)],
    ),
    target.query<AssetRow>(
      `SELECT payload FROM p1_creative_assets
        WHERE workspace_id = $1
          AND payload->>'videoWorkflowId' = $2
        ORDER BY id`,
      [workspaceId, runId],
    ),
  ]);
  if (!task.rows[0] || !job.rows[0]) return undefined;
  return runFromRows(task.rows[0], job.rows[0], assets.rows);
}

async function loadRunFromLockedJob(
  client: PoolClient,
  workspaceId: string,
  runId: string,
  job: JobRow,
) {
  const [task, assets] = await Promise.all([
    client.query<TaskRow>(
      `SELECT payload FROM p1_content_tasks
        WHERE workspace_id = $1 AND id = $2
        FOR UPDATE`,
      [workspaceId, taskId(runId)],
    ),
    client.query<AssetRow>(
      `SELECT payload FROM p1_creative_assets
        WHERE workspace_id = $1
          AND payload->>'videoWorkflowId' = $2
        ORDER BY id
        FOR UPDATE`,
      [workspaceId, runId],
    ),
  ]);
  if (!task.rows[0]) throw new Error(`Canonical video task ${runId} is missing.`);
  return runFromRows(task.rows[0], job, assets.rows);
}

function runFromRows(taskRow: TaskRow, jobRow: JobRow, assetRows: AssetRow[]) {
  const task = taskRow.payload;
  const job = jobRow.payload;
  const byId = Object.fromEntries(
    assetRows.map(({ payload }) => [payload.assetId, structuredClone(payload.asset)]),
  );
  return normalizeCanonicalVideoRun({
    actorId: task.actorId,
    assets: {
      byId,
      clipAssetIds: structuredClone(job.clipAssetIds ?? []),
      ...(job.composedAssetId
        ? { composedAssetId: job.composedAssetId }
        : {}),
    },
    job: omitStoredJob(job),
    runId: task.videoWorkflowId,
    task: omitStoredTask(task),
    ...(task.canonicalWorkId ? { workId: task.canonicalWorkId } : {}),
    workspaceId: task.workspaceId,
  });
}

async function insertRun(
  target: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  run: CanonicalVideoRun,
  leaseToken: string | undefined,
) {
  const timestamp = run.job.updatedAt;
  await target.query(
    `INSERT INTO p1_content_tasks (workspace_id, id, payload, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::timestamptz)
     ON CONFLICT (workspace_id, id) DO NOTHING`,
    [run.workspaceId, taskId(run.runId), JSON.stringify(storedTask(run)), timestamp],
  );
  await target.query(
    `INSERT INTO p1_creative_jobs (workspace_id, id, payload, updated_at)
     VALUES ($1, $2, $3::jsonb, $4::timestamptz)
     ON CONFLICT (workspace_id, id) DO NOTHING`,
    [
      run.workspaceId,
      jobId(run.runId),
      JSON.stringify(storedJob(run, leaseToken)),
      timestamp,
    ],
  );
  await syncAssets(target, run);
}

async function updateRun(
  client: PoolClient,
  run: CanonicalVideoRun,
  expectedRevision: number,
  requiredLease: string | undefined,
  nextLease: string | undefined,
) {
  await updateJobOnly(client, run, expectedRevision, requiredLease, nextLease);
  const task = storedTask(run);
  const taskUpdate = await client.query(
    `UPDATE p1_content_tasks
        SET payload = $3::jsonb, updated_at = $4::timestamptz
      WHERE workspace_id = $1 AND id = $2`,
    [run.workspaceId, taskId(run.runId), JSON.stringify(task), run.job.updatedAt],
  );
  if (taskUpdate.rowCount !== 1) {
    throw new VideoWorkflowConcurrencyError('Canonical video task is missing.');
  }
  await syncAssets(client, run);
}

async function updateJobOnly(
  client: PoolClient,
  run: CanonicalVideoRun,
  expectedRevision: number,
  requiredLease: string | undefined,
  nextLease: string | undefined,
) {
  const result = await client.query(
    `UPDATE p1_creative_jobs
        SET payload = $3::jsonb, updated_at = $4::timestamptz
      WHERE workspace_id = $1 AND id = $2
        AND (payload->'videoJob'->>'revision')::bigint = $5
        AND ($6::text IS NULL OR payload->>'runLeaseToken' = $6)`,
    [
      run.workspaceId,
      jobId(run.runId),
      JSON.stringify(storedJob(run, nextLease)),
      run.job.updatedAt,
      expectedRevision,
      requiredLease ?? null,
    ],
  );
  if (result.rowCount !== 1) {
    throw new VideoWorkflowConcurrencyError(
      requiredLease
        ? 'Video workflow result belongs to a stale run lease.'
        : 'Video workflow revision is stale.',
    );
  }
}

async function syncAssets(
  target: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
  run: CanonicalVideoRun,
) {
  for (const [assetId, asset] of Object.entries(run.assets.byId)) {
    if (asset.contentType !== 'video/mp4') {
      throw new Error(`Canonical video Asset ${assetId} must be video/mp4.`);
    }
    const payload: StoredVideoAsset = {
      asset: structuredClone(asset),
      assetId,
      createdAt: run.job.createdAt,
      contentType: asset.contentType,
      id: assetRowId(run.runId, assetId),
      jobId: jobId(run.runId),
      kind: 'video',
      objectKey: asset.objectKey,
      ownedAssetId: asset.id,
      sha256: asset.sha256,
      sizeBytes: asset.sizeBytes,
      title:
        run.assets.composedAssetId === assetId
          ? 'Composed video candidate'
          : 'Video shot candidate',
      videoWorkflowId: run.runId,
      workId: run.workId ?? `video-work:${run.runId}`,
      workspaceId: run.workspaceId,
    };
    await target.query(
      `INSERT INTO p1_creative_assets (workspace_id, id, payload, updated_at)
       VALUES ($1, $2, $3::jsonb, $4::timestamptz)
       ON CONFLICT (workspace_id, id) DO NOTHING`,
      [
        run.workspaceId,
        payload.id,
        JSON.stringify(payload),
        run.job.updatedAt,
      ],
    );
    const stored = await target.query<AssetRow>(
      `SELECT payload FROM p1_creative_assets
        WHERE workspace_id = $1 AND id = $2`,
      [run.workspaceId, payload.id],
    );
    if (
      !stored.rows[0] ||
      !isDeepStrictEqual(stored.rows[0].payload.asset, asset)
    ) {
      throw new VideoWorkflowConcurrencyError(
        `Canonical video Asset ${assetId} conflicts with immutable truth.`,
      );
    }
  }
}

function storedTask(run: CanonicalVideoRun): StoredVideoTask {
  return {
    actorId: run.actorId,
    ...(run.workId ? { canonicalWorkId: run.workId } : {}),
    createdAt: run.job.createdAt,
    dueAt: run.job.createdAt,
    executable: !isTerminal(run.job.status),
    id: taskId(run.runId),
    ...(run.workId
      ? { relatedObject: { id: run.workId, kind: 'work' as const } }
      : {}),
    risk: 'normal',
    source: 'manual',
    status: contentTaskStatus(run.job.status),
    title: `Video workflow ${run.runId}`,
    updatedAt: run.job.updatedAt,
    videoTask: structuredClone(run.task),
    videoWorkflowId: run.runId,
    workspaceId: run.workspaceId,
  };
}

function storedJob(
  run: CanonicalVideoRun,
  runLeaseToken: string | undefined,
): StoredVideoJob {
  return {
    actorId: run.actorId,
    contract: videoCreativeContract(run),
    createdAt: run.job.createdAt,
    clipAssetIds: structuredClone(run.assets.clipAssetIds),
    ...(run.assets.composedAssetId
      ? { composedAssetId: run.assets.composedAssetId }
      : {}),
    id: jobId(run.runId),
    outputAssetIds: Object.keys(run.assets.byId),
    outputContentIds: [],
    productUsageQuantity: 1,
    ...(runLeaseToken ? { runLeaseToken } : {}),
    status: creativeJobStatus(run.job.status),
    submissionKey: `video:${run.runId}`,
    taskId: taskId(run.runId),
    updatedAt: run.job.updatedAt,
    videoJob: structuredClone(run.job),
    videoWorkflowId: run.runId,
    workId: run.workId ?? `video-work:${run.runId}`,
    workspaceId: run.workspaceId,
  };
}

function omitStoredTask(value: StoredVideoTask): CanonicalVideoRun['task'] {
  return structuredClone(value.videoTask);
}

function omitStoredJob(value: StoredVideoJob): CanonicalVideoRun['job'] {
  return structuredClone(value.videoJob);
}

async function backfillDeprecatedCanonicalRuns(
  target: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
) {
  const exists = await target.query<{ table_name: string | null }>(
    `SELECT to_regclass('public.model_canonical_video_runs')::text AS table_name`,
  );
  if (!exists.rows[0]?.table_name) return;
  const rows = await target.query<DeprecatedCanonicalRow>(
    `SELECT workspace_id, run_id, actor_id, work_id, task, job, assets,
            revision, run_lease_token
       FROM model_canonical_video_runs deprecated
      WHERE NOT EXISTS (
        SELECT 1 FROM p1_creative_jobs generic
         WHERE generic.workspace_id = deprecated.workspace_id
           AND generic.payload->>'videoWorkflowId' = deprecated.run_id
      )`,
  );
  for (const row of rows.rows) {
    const run = liftDeprecatedCanonicalRow(row);
    await insertRun(target, run, row.run_lease_token ?? undefined);
  }
}

async function backfillLegacyVideoRuns(
  target: Pick<Pool, 'query'> | Pick<PoolClient, 'query'>,
) {
  const exists = await target.query<{ table_name: string | null }>(
    `SELECT to_regclass('public.model_video_workflows')::text AS table_name`,
  );
  if (!exists.rows[0]?.table_name) return;
  const rows = await target.query<LegacyVideoWorkflowRow>(
    `SELECT legacy.workspace_id, legacy.workflow, legacy.revision,
            legacy.run_lease_token
       FROM model_video_workflows legacy
      WHERE NOT EXISTS (
        SELECT 1 FROM p1_creative_jobs generic
         WHERE generic.workspace_id = legacy.workspace_id
           AND generic.payload->>'videoWorkflowId' = legacy.workflow_id
      )`,
  );
  for (const row of rows.rows) {
    const run = liftDurableToCanonical({
      ...row.workflow,
      workspaceId: row.workspace_id,
      revision: Number(row.revision),
    });
    await insertRun(target, normalizeCanonicalVideoRun(run), row.run_lease_token ?? undefined);
  }
}

function liftDeprecatedCanonicalRow(row: DeprecatedCanonicalRow) {
  const task = row.task as unknown as {
    shots: DurableVideoWorkflow['shots'];
    [key: string]: unknown;
  };
  const job = row.job as unknown as CanonicalVideoRun['job'];
  const assets = row.assets as unknown as {
    attempts: DurableVideoWorkflow['attempts'];
    clipAssets: DurableVideoWorkflow['clipAssets'];
    composedAsset?: DurableVideoWorkflow['composedAsset'];
    routeSnapshot?: DurableVideoWorkflow['routeSnapshot'];
  };
  const durable = {
    actorId: row.actor_id,
    aigcLabelEnabled: Boolean(task.aigcLabelEnabled),
    attempts: structuredClone(assets.attempts ?? []),
    catalogModelId: String(task.catalogModelId),
    clipAssets: structuredClone(assets.clipAssets ?? []),
    confirmed: Boolean(job.confirmed),
    createdAt: job.createdAt,
    dataClass: structuredClone(task.dataClass ?? []) as DurableVideoWorkflow['dataClass'],
    id: row.run_id,
    revision: Number(row.revision),
    shots: structuredClone(task.shots ?? []),
    status: job.status,
    storyboardRevision: String(task.storyboardRevision),
    storyboardVersion: Number(task.storyboardVersion),
    updatedAt: job.updatedAt,
    workspaceId: row.workspace_id,
    ...(row.work_id ? { workId: row.work_id } : {}),
    ...(task.approvalReceiptId
      ? { approvalReceiptId: String(task.approvalReceiptId) }
      : {}),
    ...(task.derivedFromRunId
      ? { derivedFromWorkflowId: String(task.derivedFromRunId) }
      : {}),
    ...(task.deliveryMode
      ? { deliveryMode: task.deliveryMode as DurableVideoWorkflow['deliveryMode'] }
      : {}),
    ...(task.brandWatermarkText
      ? { brandWatermarkText: String(task.brandWatermarkText) }
      : {}),
    ...(task.referenceAssetIds
      ? { referenceAssetIds: structuredClone(task.referenceAssetIds) as string[] }
      : {}),
    ...(task.executionContract
      ? {
          executionContract: structuredClone(
            task.executionContract,
          ) as DurableVideoWorkflow['executionContract'],
        }
      : {}),
    ...(job.failureCode ? { failureCode: job.failureCode } : {}),
    ...(job.cancelRequestedAt
      ? { cancelRequestedAt: job.cancelRequestedAt }
      : {}),
    ...(assets.composedAsset
      ? { composedAsset: structuredClone(assets.composedAsset) }
      : {}),
    ...(assets.routeSnapshot
      ? { routeSnapshot: structuredClone(assets.routeSnapshot) }
      : {}),
  } satisfies DurableVideoWorkflow;
  return normalizeCanonicalVideoRun(liftDurableToCanonical(durable));
}

function taskId(runId: string) {
  return `${TASK_PREFIX}${runId}`;
}

function jobId(runId: string) {
  return `${JOB_PREFIX}${runId}`;
}

function assetRowId(runId: string, assetId: string) {
  return `${ASSET_PREFIX}${runId}:${assetId}`;
}

function isTerminal(status: CanonicalVideoRun['job']['status']) {
  return status === 'completed' || status === 'cancelled' || status === 'failed';
}

function contentTaskStatus(
  status: CanonicalVideoRun['job']['status'],
): ContentTask['status'] {
  switch (status) {
    case 'draft':
      return 'todo';
    case 'running':
      return 'in_progress';
    case 'awaiting_quality_review':
      return 'needs_review';
    case 'completed':
      return 'done';
    case 'cancelled':
      return 'archived';
    case 'cancel_requested':
    case 'failed':
      return 'blocked';
  }
}

function creativeJobStatus(
  status: CanonicalVideoRun['job']['status'],
): CreativeJob['status'] {
  switch (status) {
    case 'draft':
      return 'submitting';
    case 'running':
      return 'running';
    case 'awaiting_quality_review':
    case 'cancel_requested':
      return 'recoverable';
    case 'completed':
      return 'completed';
    case 'cancelled':
    case 'failed':
      return 'failed';
  }
}

function videoCreativeContract(run: CanonicalVideoRun): CreativeJob['contract'] {
  if (run.task.executionContract) {
    return structuredClone(run.task.executionContract);
  }
  return {
    aigcLabelEnabled: run.task.aigcLabelEnabled,
    aspectRatio: '9:16',
    catalogModelId: run.task.catalogModelId,
    catalogRevision: 'legacy-unknown',
    currency: 'CNY',
    dataClass: structuredClone(run.task.dataClass),
    durationSeconds: Math.max(
      1,
      run.task.shots.reduce(
        (total, shot) => total + (shot.durationSeconds ?? 0),
        0,
      ) || 15,
    ),
    estimatedAmount: 0,
    operation: 'video.generate',
    outputCount: 1,
    outputLabel: 'Legacy composed video',
    quoteAcceptedAt: run.job.createdAt,
    quoteRevision: 'legacy-unknown',
    watermarkEnabled: Boolean(run.task.brandWatermarkText),
  };
}
