import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { P1DomainError } from '../foundation/domain.js';
import type { CatalogRevision, PreferenceView } from './catalog.js';
import {
  ContentWorkflowRunner,
  InMemoryDurableVideoWorkflowStore,
  VersionedHumanCalibratedVideoQualityScorer,
  liftDurableToCanonical,
  projectDurableVideoWorkflow,
  runDurableVideoWorkflow,
  type CreateVideoWorkflowInput,
  type AsyncCanonicalVideoRunStore,
  type DurableVideoWorkflow,
  type DurableVideoWorkflowSaveOptions,
  type EditVideoWorkflowInput,
  type ModelSupplyApplicationService,
  type ModelSupplyResult,
  type QualityEvent,
  type SelectVideoCandidateInput,
  type VideoCompositionPort,
  type VideoQualityScoringPort,
} from './index.js';
import type {
  BeautyQualityEvaluationCaseResult,
  BeautyQualityEvaluationRun,
  RevisionRollbackAudit,
} from './quality-evaluation.js';
import type {
  ActivationProbeRun,
  CanvasTextGenerationOutboxRecord,
  ModelSupplyJobListPage,
  ModelSupplyJobListQuery,
  PersistedCanvasGenerationQuote,
} from './foundation-module.js';

const JOB_OPERATION_SQL = `COALESCE(result->>'operation', 'copy.generate')`;
const JOB_STATUS_SQL = `CASE
  WHEN result->>'status' = 'completed' THEN 'succeeded'
  WHEN result->>'status' = 'failed' THEN 'failed'
  WHEN result #>> '{attempt,acceptance}' = 'accepted' THEN 'accepted'
  WHEN result #>> '{attempt,acceptance}' = 'acceptance_unknown' THEN 'acceptance_unknown'
  ELSE 'rejected_before_accept'
END`;
const JOB_MODALITY_SQL = `CASE
  WHEN ${JOB_OPERATION_SQL} LIKE 'image.%' THEN 'image'
  WHEN ${JOB_OPERATION_SQL} LIKE 'video.%' THEN 'video'
  WHEN ${JOB_OPERATION_SQL} LIKE 'audio.%' THEN 'audio'
  ELSE 'llm'
END`;

interface PersistedJobReadRow {
  result: ModelSupplyResult;
  ended_at: Date | string | null;
  latency_ms: number | string | null;
}

function terminalJobTiming(result: ModelSupplyResult): {
  endedAt: string | null;
  latencyMs: number | null;
} {
  if (result.status === 'unknown') {
    return { endedAt: null, latencyMs: null };
  }
  const endedAt = result.endedAt ?? new Date().toISOString();
  const startedAtMs = Date.parse(result.attempt.createdAt);
  const endedAtMs = Date.parse(endedAt);
  return {
    endedAt,
    latencyMs: result.latencyMs ?? Math.max(0, endedAtMs - startedAtMs),
  };
}

function projectPersistedJob(row: PersistedJobReadRow): ModelSupplyResult {
  const endedAt = row.ended_at
    ? row.ended_at instanceof Date
      ? row.ended_at.toISOString()
      : new Date(row.ended_at).toISOString()
    : undefined;
  const latencyMs = row.latency_ms == null ? undefined : Number(row.latency_ms);
  return {
    ...row.result,
    ...(endedAt ? { endedAt } : {}),
    ...(latencyMs !== undefined ? { latencyMs } : {}),
  };
}

type StoredQualityEvaluationRunHeader = Omit<
  BeautyQualityEvaluationRun,
  'cases' | 'rejectionCases' | 'summary' | 'evidenceKind'
> & {
  evidenceKind?: BeautyQualityEvaluationRun['evidenceKind'];
  summary: Omit<
    BeautyQualityEvaluationRun['summary'],
    'rejectionCaseCount' | 'rejectionsCaught'
  > &
    Partial<
      Pick<
        BeautyQualityEvaluationRun['summary'],
        'rejectionCaseCount' | 'rejectionsCaught'
      >
    >;
  rejectionCases?: BeautyQualityEvaluationRun['rejectionCases'];
};

export class PostgresModelSupplyRepository {
  constructor(private readonly pool: Pool) {}

  async migrate(client?: PoolClient) {
    await (client ?? this.pool).query(`
      CREATE TABLE IF NOT EXISTS model_catalog_revisions (
        workspace_id text NOT NULL,
        revision_id text NOT NULL,
        stage text NOT NULL,
        revision jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, revision_id)
      );
      CREATE TABLE IF NOT EXISTS model_catalog_heads (
        workspace_id text PRIMARY KEY,
        revision_id text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS model_workspace_preferences (
        workspace_id text NOT NULL,
        operation text NOT NULL,
        default_model_id text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, operation)
      );
      CREATE TABLE IF NOT EXISTS model_user_preferences (
        workspace_id text NOT NULL,
        user_id text NOT NULL,
        operation text NOT NULL,
        default_model_id text,
        favorites text[] NOT NULL DEFAULT '{}',
        recent text[] NOT NULL DEFAULT '{}',
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, user_id, operation)
      );
      CREATE TABLE IF NOT EXISTS model_generation_jobs (
        workspace_id text NOT NULL,
        job_id text NOT NULL,
        status text NOT NULL,
        result jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, job_id)
      );
      ALTER TABLE model_generation_jobs
        ADD COLUMN IF NOT EXISTS ended_at timestamptz;
      ALTER TABLE model_generation_jobs
        ADD COLUMN IF NOT EXISTS latency_ms bigint;
      UPDATE model_generation_jobs
         SET ended_at = COALESCE(ended_at, created_at),
             latency_ms = COALESCE(
               latency_ms,
               GREATEST(
                 0,
                 FLOOR(
                   EXTRACT(
                     EPOCH FROM (
                       COALESCE(ended_at, created_at) -
                       (result #>> '{attempt,createdAt}')::timestamptz
                     )
                   ) * 1000
                 )::bigint
               )
             )
       WHERE status IN ('completed', 'failed')
         AND (ended_at IS NULL OR latency_ms IS NULL)
         AND result #>> '{attempt,createdAt}' IS NOT NULL;
      CREATE INDEX IF NOT EXISTS model_generation_jobs_workspace_latency_idx
        ON model_generation_jobs (workspace_id, latency_ms, job_id);
      CREATE TABLE IF NOT EXISTS model_canvas_generation_quotes (
        workspace_id text NOT NULL,
        quote_id text NOT NULL,
        payload_hash text NOT NULL,
        quote jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, quote_id)
      );
      CREATE TABLE IF NOT EXISTS model_canvas_text_generation_outbox (
        outbox_id text PRIMARY KEY,
        workspace_id text NOT NULL,
        status text NOT NULL CHECK (status IN ('pending', 'claimed', 'completed')),
        submission jsonb NOT NULL,
        claim_token text,
        lease_expires_at timestamptz,
        created_at timestamptz NOT NULL
      );
      ALTER TABLE model_canvas_text_generation_outbox
        ADD COLUMN IF NOT EXISTS provider_effect_key text;
      ALTER TABLE model_canvas_text_generation_outbox
        ADD COLUMN IF NOT EXISTS provider_effect_status text;
      ALTER TABLE model_canvas_text_generation_outbox
        ADD COLUMN IF NOT EXISTS provider_effect_result jsonb;
      ALTER TABLE model_canvas_text_generation_outbox
        DROP CONSTRAINT IF EXISTS model_canvas_text_generation_outbox_provider_effect_status_check;
      ALTER TABLE model_canvas_text_generation_outbox
        ADD CONSTRAINT model_canvas_text_generation_outbox_provider_effect_status_check
        CHECK (provider_effect_status IS NULL OR provider_effect_status IN ('started', 'completed'));
      CREATE TABLE IF NOT EXISTS model_quality_events (
        workspace_id text NOT NULL,
        event_id text NOT NULL,
        event jsonb NOT NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, event_id)
      );
      CREATE TABLE IF NOT EXISTS model_prompt_heads (
        workspace_id text PRIMARY KEY,
        revision_id text NOT NULL,
        updated_at timestamptz NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS model_quality_evaluation_runs (
        workspace_id text NOT NULL,
        run_id text NOT NULL,
        run jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, run_id)
      );
      CREATE TABLE IF NOT EXISTS model_activation_probe_runs (
        workspace_id text NOT NULL,
        run_id text NOT NULL,
        deployment_id text NOT NULL,
        catalog_model_id text NOT NULL,
        outcome text NOT NULL CHECK (outcome IN ('passed', 'failed')),
        run jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, run_id)
      );
      CREATE TABLE IF NOT EXISTS model_quality_evaluation_cases (
        workspace_id text NOT NULL,
        run_id text NOT NULL,
        case_id text NOT NULL,
        ordinal integer NOT NULL,
        result jsonb NOT NULL,
        PRIMARY KEY (workspace_id, run_id, case_id),
        FOREIGN KEY (workspace_id, run_id)
          REFERENCES model_quality_evaluation_runs (workspace_id, run_id)
          ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS model_revision_rollback_audits (
        workspace_id text NOT NULL,
        audit_id text NOT NULL,
        kind text NOT NULL,
        audit jsonb NOT NULL,
        created_at timestamptz NOT NULL,
        PRIMARY KEY (workspace_id, audit_id)
      );
      CREATE TABLE IF NOT EXISTS model_video_workflows (
        workspace_id text NOT NULL,
        workflow_id text NOT NULL,
        workflow jsonb NOT NULL,
        revision bigint NOT NULL DEFAULT 0,
        run_lease_token text,
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (workspace_id, workflow_id)
      );
      ALTER TABLE model_video_workflows
        ADD COLUMN IF NOT EXISTS revision bigint NOT NULL DEFAULT 0;
      ALTER TABLE model_video_workflows
        ADD COLUMN IF NOT EXISTS run_lease_token text;
      CREATE INDEX IF NOT EXISTS model_generation_jobs_workspace_status_idx
        ON model_generation_jobs (workspace_id, status);
      CREATE INDEX IF NOT EXISTS model_canvas_generation_quotes_created_idx
        ON model_canvas_generation_quotes (workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS model_canvas_text_outbox_claim_idx
        ON model_canvas_text_generation_outbox (status, lease_expires_at, created_at);
      CREATE INDEX IF NOT EXISTS model_quality_workspace_created_idx
        ON model_quality_events (workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS model_quality_evaluation_created_idx
        ON model_quality_evaluation_runs (workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS model_activation_probe_created_idx
        ON model_activation_probe_runs (workspace_id, created_at DESC);
      CREATE INDEX IF NOT EXISTS model_revision_rollback_created_idx
        ON model_revision_rollback_audits (workspace_id, created_at DESC);
    `);
  }

  async saveActivationProbeRun(workspaceId: string, run: ActivationProbeRun) {
    await this.pool.query(
      `INSERT INTO model_activation_probe_runs (
         workspace_id, run_id, deployment_id, catalog_model_id, outcome, run, created_at
       ) VALUES ($1, $2, $3, $4, $5, $6::jsonb, $7::timestamptz)
       ON CONFLICT (workspace_id, run_id) DO NOTHING`,
      [
        workspaceId,
        run.id,
        run.deploymentId,
        run.catalogModelId,
        run.outcome,
        JSON.stringify(run),
        run.createdAt,
      ],
    );
  }

  async getActivationProbeRun(workspaceId: string, runId: string) {
    const result = await this.pool.query<{ run: ActivationProbeRun }>(
      `SELECT run FROM model_activation_probe_runs
       WHERE workspace_id = $1 AND run_id = $2`,
      [workspaceId, runId],
    );
    return result.rows[0]?.run ?? null;
  }

  async listActivationProbeRuns(workspaceId: string) {
    const result = await this.pool.query<{ run: ActivationProbeRun }>(
      `SELECT run FROM model_activation_probe_runs
       WHERE workspace_id = $1
       ORDER BY created_at DESC, run_id DESC`,
      [workspaceId],
    );
    return result.rows.map((row) => row.run);
  }

  async saveCatalogRevision(workspaceId: string, revision: CatalogRevision) {
    await this.pool.query(
      `INSERT INTO model_catalog_revisions (workspace_id, revision_id, stage, revision)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (workspace_id, revision_id) DO NOTHING`,
      [workspaceId, revision.id, revision.stage, JSON.stringify(revision)]
    );
  }

  async listCatalogRevisions(workspaceId: string) {
    const result = await this.pool.query<{ revision: CatalogRevision }>(
      `SELECT revision FROM model_catalog_revisions
        WHERE workspace_id = $1
        ORDER BY (revision->>'number')::integer, revision_id`,
      [workspaceId]
    );
    return result.rows.map((row) => row.revision);
  }

  async getCurrentPublishedCatalogRevision(workspaceId: string) {
    const result = await this.pool.query<{ revision: CatalogRevision }>(
      `SELECT revisions.revision
         FROM model_catalog_heads heads
         JOIN model_catalog_revisions revisions
           ON revisions.workspace_id = heads.workspace_id
          AND revisions.revision_id = heads.revision_id
        WHERE heads.workspace_id = $1 AND revisions.stage = 'published'`,
      [workspaceId]
    );
    return result.rows[0]?.revision ?? null;
  }

  async setCurrentPublishedCatalogRevision(
    workspaceId: string,
    revision: CatalogRevision,
    expectedHeadRevisionId: string | null,
  ) {
    if (revision.stage !== 'published') {
      throw new Error('Only a published catalog revision can become current.');
    }
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO model_catalog_revisions (workspace_id, revision_id, stage, revision)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (workspace_id, revision_id) DO NOTHING`,
        [workspaceId, revision.id, revision.stage, JSON.stringify(revision)]
      );
      const head = expectedHeadRevisionId === null
        ? await client.query(
            `INSERT INTO model_catalog_heads (workspace_id, revision_id, updated_at)
             VALUES ($1, $2, now())
             ON CONFLICT (workspace_id) DO NOTHING
             RETURNING revision_id`,
            [workspaceId, revision.id],
          )
        : await client.query(
            `UPDATE model_catalog_heads
                SET revision_id = $2, updated_at = now()
              WHERE workspace_id = $1 AND revision_id = $3
              RETURNING revision_id`,
            [workspaceId, revision.id, expectedHeadRevisionId],
          );
      if (head.rowCount !== 1) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Catalog head changed before publication could be applied.',
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async clearCurrentPublishedCatalogRevision(
    workspaceId: string,
    expectedRevisionId: string
  ) {
    await this.pool.query(
      `DELETE FROM model_catalog_heads
        WHERE workspace_id = $1 AND revision_id = $2`,
      [workspaceId, expectedRevisionId]
    );
  }

  async applyCatalogRollback(
    workspaceId: string,
    expectedHeadRevisionId: string | null,
    targetRevision: CatalogRevision | null,
    audit: RevisionRollbackAudit,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ revision_id: string }>(
        `SELECT revision_id FROM model_catalog_heads
          WHERE workspace_id = $1 FOR UPDATE`,
        [workspaceId],
      );
      if ((current.rows[0]?.revision_id ?? null) !== expectedHeadRevisionId) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Catalog head changed before rollback could be applied.',
        );
      }
      if (targetRevision) {
        await client.query(
          `INSERT INTO model_catalog_revisions
             (workspace_id, revision_id, stage, revision)
           VALUES ($1, $2, $3, $4::jsonb)
           ON CONFLICT (workspace_id, revision_id) DO NOTHING`,
          [
            workspaceId,
            targetRevision.id,
            targetRevision.stage,
            JSON.stringify(targetRevision),
          ],
        );
        await client.query(
          `INSERT INTO model_catalog_heads (workspace_id, revision_id, updated_at)
           VALUES ($1, $2, now())
           ON CONFLICT (workspace_id)
           DO UPDATE SET revision_id = EXCLUDED.revision_id, updated_at = now()`,
          [workspaceId, targetRevision.id],
        );
      } else {
        await client.query(
          `DELETE FROM model_catalog_heads WHERE workspace_id = $1`,
          [workspaceId],
        );
      }
      await this.insertRollbackAudit(client, workspaceId, audit);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getCurrentPromptRevision(workspaceId: string) {
    const result = await this.pool.query<{ revision_id: string }>(
      `SELECT revision_id FROM model_prompt_heads WHERE workspace_id = $1`,
      [workspaceId],
    );
    return result.rows[0]?.revision_id ?? null;
  }

  async applyPromptRollback(
    workspaceId: string,
    expectedHeadRevisionId: string | null,
    targetRevisionId: string,
    audit: RevisionRollbackAudit,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const current = await client.query<{ revision_id: string }>(
        `SELECT revision_id FROM model_prompt_heads
          WHERE workspace_id = $1 FOR UPDATE`,
        [workspaceId],
      );
      if ((current.rows[0]?.revision_id ?? null) !== expectedHeadRevisionId) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Prompt head changed before rollback could be applied.',
        );
      }
      await client.query(
        `INSERT INTO model_prompt_heads (workspace_id, revision_id, updated_at)
         VALUES ($1, $2, now())
         ON CONFLICT (workspace_id)
         DO UPDATE SET revision_id = EXCLUDED.revision_id, updated_at = now()`,
        [workspaceId, targetRevisionId],
      );
      await this.insertRollbackAudit(client, workspaceId, audit);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async setWorkspaceDefault(
    workspaceId: string,
    operation: string,
    modelId: string
  ) {
    await this.pool.query(
      `INSERT INTO model_workspace_preferences
         (workspace_id, operation, default_model_id, updated_at)
       VALUES ($1, $2, $3, now())
       ON CONFLICT (workspace_id, operation)
       DO UPDATE SET default_model_id = EXCLUDED.default_model_id, updated_at = now()`,
      [workspaceId, operation, modelId]
    );
  }

  async setUserDefault(
    workspaceId: string,
    userId: string,
    operation: string,
    modelId: string
  ) {
    await this.ensureUserPreference(workspaceId, userId, operation);
    await this.pool.query(
      `UPDATE model_user_preferences
          SET default_model_id = $4, updated_at = now()
        WHERE workspace_id = $1 AND user_id = $2 AND operation = $3`,
      [workspaceId, userId, operation, modelId]
    );
  }

  async setFavorite(
    workspaceId: string,
    userId: string,
    operation: string,
    modelId: string,
    favorite: boolean
  ) {
    await this.ensureUserPreference(workspaceId, userId, operation);
    if (favorite) {
      await this.pool.query(
        `UPDATE model_user_preferences
            SET favorites = CASE
              WHEN $4 = ANY(favorites) THEN favorites
              ELSE array_append(favorites, $4)
            END,
            updated_at = now()
          WHERE workspace_id = $1 AND user_id = $2 AND operation = $3`,
        [workspaceId, userId, operation, modelId]
      );
      return;
    }
    await this.pool.query(
      `UPDATE model_user_preferences
          SET favorites = array_remove(favorites, $4), updated_at = now()
        WHERE workspace_id = $1 AND user_id = $2 AND operation = $3`,
      [workspaceId, userId, operation, modelId]
    );
  }

  async recordRecent(
    workspaceId: string,
    userId: string,
    operation: string,
    modelId: string
  ) {
    await this.ensureUserPreference(workspaceId, userId, operation);
    await this.pool.query(
      `UPDATE model_user_preferences
          SET recent = (ARRAY[$4::text] || array_remove(recent, $4))[1:20],
              updated_at = now()
        WHERE workspace_id = $1 AND user_id = $2 AND operation = $3`,
      [workspaceId, userId, operation, modelId]
    );
  }

  async getPreferences(
    workspaceId: string,
    userId: string,
    operation: string
  ): Promise<PreferenceView> {
    const [workspace, user] = await Promise.all([
      this.pool.query<{ default_model_id: string }>(
        `SELECT default_model_id FROM model_workspace_preferences
          WHERE workspace_id = $1 AND operation = $2`,
        [workspaceId, operation]
      ),
      this.pool.query<{
        default_model_id: string | null;
        favorites: string[];
        recent: string[];
      }>(
        `SELECT default_model_id, favorites, recent FROM model_user_preferences
          WHERE workspace_id = $1 AND user_id = $2 AND operation = $3`,
        [workspaceId, userId, operation]
      ),
    ]);
    const workspaceDefault = workspace.rows[0]?.default_model_id;
    const userPreference = user.rows[0];
    return {
      ...(workspaceDefault ? { workspaceDefault } : {}),
      ...(userPreference?.default_model_id
        ? { userDefault: userPreference.default_model_id }
        : {}),
      favorites: [...(userPreference?.favorites ?? [])],
      recent: [...(userPreference?.recent ?? [])],
    };
  }

  async saveResult(workspaceId: string, result: ModelSupplyResult) {
    // Denormalized read model only. Foundation owns RouteSnapshot, Attempt,
    // Asset, Product Usage and Provider Cost append-only facts.
    const timing = terminalJobTiming(result);
    await this.pool.query(
      `INSERT INTO model_generation_jobs
         (workspace_id, job_id, status, result, ended_at, latency_ms)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, $6::bigint)
       ON CONFLICT (workspace_id, job_id)
       DO UPDATE SET status = EXCLUDED.status, result = EXCLUDED.result,
                     ended_at = COALESCE(model_generation_jobs.ended_at, EXCLUDED.ended_at),
                     latency_ms = COALESCE(model_generation_jobs.latency_ms, EXCLUDED.latency_ms)`,
      [
        workspaceId,
        result.jobId,
        result.status,
        JSON.stringify(result),
        timing.endedAt,
        timing.latencyMs,
      ]
    );
  }

  async saveCanvasGenerationQuote(
    workspaceId: string,
    quote: PersistedCanvasGenerationQuote,
  ) {
    await this.pool.query(
      `INSERT INTO model_canvas_generation_quotes
         (workspace_id, quote_id, payload_hash, quote, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)
       ON CONFLICT (workspace_id, quote_id) DO NOTHING`,
      [
        workspaceId,
        quote.quoteId,
        quote.payloadHash,
        JSON.stringify(quote),
        quote.createdAt,
      ],
    );
    const stored = await this.getCanvasGenerationQuote(
      workspaceId,
      quote.quoteId,
    );
    if (stored?.payloadHash !== quote.payloadHash) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Canvas generation quote idempotency key conflicts with another payload.',
      );
    }
  }

  async getCanvasGenerationQuote(workspaceId: string, quoteId: string) {
    const result = await this.pool.query<{
      quote: PersistedCanvasGenerationQuote;
    }>(
      `SELECT quote FROM model_canvas_generation_quotes
        WHERE workspace_id = $1 AND quote_id = $2`,
      [workspaceId, quoteId],
    );
    return result.rows[0]?.quote ?? null;
  }

  async enqueueCanvasTextGeneration(
    workspaceId: string,
    queued: ModelSupplyResult,
    outbox: CanvasTextGenerationOutboxRecord,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const timing = terminalJobTiming(queued);
      await client.query(
        `INSERT INTO model_generation_jobs
           (workspace_id, job_id, status, result, ended_at, latency_ms)
         VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, $6::bigint)
         ON CONFLICT (workspace_id, job_id) DO NOTHING`,
        [
          workspaceId,
          queued.jobId,
          queued.status,
          JSON.stringify(queued),
          timing.endedAt,
          timing.latencyMs,
        ],
      );
      await client.query(
        `INSERT INTO model_canvas_text_generation_outbox
           (outbox_id, workspace_id, status, submission, created_at)
         VALUES ($1, $2, 'pending', $3::jsonb, $4::timestamptz)
         ON CONFLICT (outbox_id) DO NOTHING`,
        [outbox.id, workspaceId, JSON.stringify(outbox.submission), outbox.createdAt],
      );
      const existing = await client.query<{
        submission: CanvasTextGenerationOutboxRecord['submission'];
        workspace_id: string;
      }>(
        `SELECT workspace_id, submission
           FROM model_canvas_text_generation_outbox
          WHERE outbox_id = $1`,
        [outbox.id],
      );
      if (
        existing.rows[0]?.workspace_id !== workspaceId ||
        existing.rows[0]?.submission.idempotencyKey !==
          outbox.submission.idempotencyKey
      ) {
        throw new P1DomainError(
          'IDEMPOTENCY_CONFLICT',
          'Canvas text generation outbox conflicts with another request.',
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async claimCanvasTextGeneration(input: {
    claimToken: string;
    leaseExpiresAt: string;
    now: string;
  }) {
    const result = await this.pool.query<{
      claim_token: string;
      created_at: Date;
      lease_expires_at: Date;
      outbox_id: string;
      status: CanvasTextGenerationOutboxRecord['status'];
      submission: CanvasTextGenerationOutboxRecord['submission'];
      workspace_id: string;
    }>(
      `WITH candidate AS (
         SELECT outbox_id
           FROM model_canvas_text_generation_outbox
          WHERE status = 'pending'
             OR (status = 'claimed' AND lease_expires_at <= $1::timestamptz)
          ORDER BY created_at, outbox_id
          FOR UPDATE SKIP LOCKED
          LIMIT 1
       )
       UPDATE model_canvas_text_generation_outbox AS outbox
          SET status = 'claimed', claim_token = $2,
              lease_expires_at = $3::timestamptz
         FROM candidate
        WHERE outbox.outbox_id = candidate.outbox_id
       RETURNING outbox.*`,
      [input.now, input.claimToken, input.leaseExpiresAt],
    );
    const row = result.rows[0];
    return row
      ? {
          claimToken: row.claim_token,
          createdAt: row.created_at.toISOString(),
          id: row.outbox_id,
          leaseExpiresAt: row.lease_expires_at.toISOString(),
          status: row.status,
          submission: row.submission,
          workspaceId: row.workspace_id,
        }
      : null;
  }

  async completeCanvasTextGeneration(input: {
    claimToken: string;
    id: string;
    result: ModelSupplyResult;
  }) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const completed = await client.query<{
        provider_effect_result: ModelSupplyResult;
        workspace_id: string;
      }>(
        `UPDATE model_canvas_text_generation_outbox
            SET status = 'completed', claim_token = NULL,
                lease_expires_at = NULL
          WHERE outbox_id = $1 AND status = 'claimed' AND claim_token = $2
            AND provider_effect_status = 'completed'
        RETURNING workspace_id, provider_effect_result`,
        [input.id, input.claimToken],
      );
      const completedEffect = completed.rows[0];
      if (!completedEffect) {
        await client.query('ROLLBACK');
        return false;
      }
      const result = completedEffect.provider_effect_result;
      const timing = terminalJobTiming(result);
      await client.query(
        `INSERT INTO model_generation_jobs
           (workspace_id, job_id, status, result, ended_at, latency_ms)
         VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz, $6::bigint)
         ON CONFLICT (workspace_id, job_id)
         DO UPDATE SET status = EXCLUDED.status, result = EXCLUDED.result,
                       ended_at = COALESCE(model_generation_jobs.ended_at, EXCLUDED.ended_at),
                       latency_ms = COALESCE(model_generation_jobs.latency_ms, EXCLUDED.latency_ms)`,
        [
          completedEffect.workspace_id,
          result.jobId,
          result.status,
          JSON.stringify(result),
          timing.endedAt,
          timing.latencyMs,
        ],
      );
      await client.query('COMMIT');
      return true;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async renewCanvasTextGenerationLease(input: {
    claimToken: string;
    id: string;
    leaseExpiresAt: string;
  }) {
    const result = await this.pool.query(
      `UPDATE model_canvas_text_generation_outbox
          SET lease_expires_at = $3::timestamptz
        WHERE outbox_id = $1 AND status = 'claimed' AND claim_token = $2
      RETURNING outbox_id`,
      [input.id, input.claimToken, input.leaseExpiresAt],
    );
    return result.rowCount === 1;
  }

  async beginCanvasTextGenerationProviderEffect(input: {
    claimToken: string;
    effectKey: string;
    id: string;
  }) {
    const started = await this.pool.query(
      `UPDATE model_canvas_text_generation_outbox
          SET provider_effect_key = $3, provider_effect_status = 'started'
        WHERE outbox_id = $1 AND status = 'claimed' AND claim_token = $2
          AND provider_effect_status IS NULL
      RETURNING outbox_id`,
      [input.id, input.claimToken, input.effectKey],
    );
    if (started.rowCount === 1) return { status: 'execute' as const };
    const result = await this.pool.query<{
      claim_token: string | null;
      provider_effect_key: string | null;
      provider_effect_result: ModelSupplyResult | null;
      provider_effect_status: 'started' | 'completed' | null;
      status: CanvasTextGenerationOutboxRecord['status'];
    }>(
      `SELECT status, claim_token, provider_effect_key,
              provider_effect_status, provider_effect_result
         FROM model_canvas_text_generation_outbox
        WHERE outbox_id = $1`,
      [input.id],
    );
    const row = result.rows[0];
    if (row?.status !== 'claimed' || row.claim_token !== input.claimToken) {
      throw new Error('Canvas text generation outbox claim was lost.');
    }
    if (row.provider_effect_key !== input.effectKey) {
      throw new P1DomainError(
        'IDEMPOTENCY_CONFLICT',
        'Canvas text provider effect key conflicts with the persisted effect.',
      );
    }
    if (row.provider_effect_status === 'completed') {
      if (!row.provider_effect_result) {
        throw new Error('Completed canvas text provider effect has no result.');
      }
      return {
        result: row.provider_effect_result,
        status: 'completed' as const,
      };
    }
    return { status: 'acceptance_unknown' as const };
  }

  async completeCanvasTextGenerationProviderEffect(input: {
    claimToken: string;
    effectKey: string;
    id: string;
    result: ModelSupplyResult;
  }) {
    const completed = await this.pool.query(
      `UPDATE model_canvas_text_generation_outbox
          SET provider_effect_status = 'completed', provider_effect_result = $4::jsonb
        WHERE outbox_id = $1 AND status = 'claimed' AND claim_token = $2
          AND provider_effect_status = 'started' AND provider_effect_key = $3
      RETURNING outbox_id`,
      [input.id, input.claimToken, input.effectKey, JSON.stringify(input.result)],
    );
    return completed.rowCount === 1;
  }

  async releaseCanvasTextGeneration(input: {
    claimToken: string;
    id: string;
  }) {
    const result = await this.pool.query(
      `UPDATE model_canvas_text_generation_outbox
          SET status = 'pending', claim_token = NULL, lease_expires_at = NULL
        WHERE outbox_id = $1 AND status = 'claimed' AND claim_token = $2
      RETURNING outbox_id`,
      [input.id, input.claimToken],
    );
    return result.rowCount === 1;
  }

  async getJob(workspaceId: string, jobId: string) {
    const result = await this.pool.query<PersistedJobReadRow>(
      `SELECT result, ended_at, latency_ms FROM model_generation_jobs
        WHERE workspace_id = $1 AND job_id = $2`,
      [workspaceId, jobId]
    );
    return result.rows[0] ? projectPersistedJob(result.rows[0]) : null;
  }

  async listJobs(workspaceId: string): Promise<ModelSupplyResult[]>;
  async listJobs(
    workspaceId: string,
    query: ModelSupplyJobListQuery
  ): Promise<ModelSupplyJobListPage>;
  async listJobs(
    workspaceId: string,
    query?: ModelSupplyJobListQuery
  ): Promise<ModelSupplyResult[] | ModelSupplyJobListPage> {
    if (!query) {
      const result = await this.pool.query<PersistedJobReadRow>(
        `SELECT result, ended_at, latency_ms FROM model_generation_jobs
          WHERE workspace_id = $1 ORDER BY created_at DESC, job_id DESC`,
        [workspaceId]
      );
      return result.rows.map(projectPersistedJob);
    }

    const page = Number.isInteger(query.page) && query.page > 0 ? query.page : 1;
    const pageSize =
      Number.isInteger(query.pageSize) && query.pageSize > 0
        ? Math.min(query.pageSize, 100)
        : 20;
    const values: unknown[] = [workspaceId];
    const where = ['workspace_id = $1'];
    const bind = (value: unknown) => {
      values.push(value);
      return `$${values.length}`;
    };

    if (query.operation) where.push(`${JOB_OPERATION_SQL} = ${bind(query.operation)}`);
    if (query.status) where.push(`${JOB_STATUS_SQL} = ${bind(query.status)}`);
    if (query.modality) where.push(`${JOB_MODALITY_SQL} = ${bind(query.modality)}`);
    if (query.catalogModelId) {
      where.push(`result #>> '{attempt,catalogModelId}' = ${bind(query.catalogModelId)}`);
    }
    if (query.deploymentId) {
      where.push(`result #>> '{attempt,deploymentId}' = ${bind(query.deploymentId)}`);
    }
    if (query.deploymentIds) {
      where.push(
        query.deploymentIds.length === 0
          ? 'FALSE'
          : `result #>> '{attempt,deploymentId}' = ANY(${bind(query.deploymentIds)}::text[])`
      );
    }
    if (query.dataClass) {
      where.push(
        query.dataClass === 'public'
          ? `jsonb_array_length(COALESCE(result #> '{snapshot,dataClass}', '[]'::jsonb)) = 0`
          : `COALESCE(result #> '{snapshot,dataClass}', '[]'::jsonb) ? ${bind(query.dataClass)}`
      );
    }
    if (query.taskId) where.push(`job_id = ${bind(query.taskId)}`);
    if (query.q) {
      where.push(
        `concat_ws(' ', job_id, result #>> '{attempt,id}', result #>> '{attempt,catalogModelId}', result #>> '{attempt,deploymentId}', result->>'failureCode') ILIKE ${bind(`%${query.q}%`)}`
      );
    }

    const sortExpression: Record<ModelSupplyJobListQuery['sort'], string> = {
      startedAt: `(result #>> '{attempt,createdAt}')::timestamptz`,
      latencyMs: 'latency_ms',
      status: JOB_STATUS_SQL,
      operation: JOB_OPERATION_SQL,
      costMicros: `(result #>> '{providerCost,amount}')::numeric`,
    };
    const direction = query.dir === 'asc' ? 'ASC' : 'DESC';
    const predicate = where.join(' AND ');
    const limit = bind(pageSize);
    const offset = bind((page - 1) * pageSize);
    const itemValues = [...values];
    const countValues = values.slice(0, -2);

    const [items, total, facetValues, dataClassValues] = await Promise.all([
      this.pool.query<PersistedJobReadRow>(
        `SELECT result, ended_at, latency_ms FROM model_generation_jobs
          WHERE ${predicate}
          ORDER BY ${sortExpression[query.sort]} ${direction} NULLS LAST, job_id ${direction}
          LIMIT ${limit} OFFSET ${offset}`,
        itemValues
      ),
      this.pool.query<{ total: string | number }>(
        `SELECT count(*) AS total FROM model_generation_jobs WHERE ${predicate}`,
        countValues
      ),
      this.pool.query<{
        operations: string[] | null;
        statuses: string[] | null;
        modalities: string[] | null;
      }>(
        `SELECT array_agg(DISTINCT operation ORDER BY operation) AS operations,
                array_agg(DISTINCT status ORDER BY status) AS statuses,
                array_agg(DISTINCT modality ORDER BY modality) AS modalities
           FROM (SELECT ${JOB_OPERATION_SQL} AS operation,
                        ${JOB_STATUS_SQL} AS status,
                        ${JOB_MODALITY_SQL} AS modality
                   FROM model_generation_jobs WHERE workspace_id = $1) facets`,
        [workspaceId]
      ),
      this.pool.query<{ data_class: string }>(
        `SELECT DISTINCT COALESCE(classes.data_class, 'public') AS data_class
           FROM model_generation_jobs jobs
           LEFT JOIN LATERAL jsonb_array_elements_text(
             COALESCE(jobs.result #> '{snapshot,dataClass}', '[]'::jsonb)
           ) AS classes(data_class) ON TRUE
          WHERE jobs.workspace_id = $1 ORDER BY data_class`,
        [workspaceId]
      ),
    ]);
    const facets = facetValues.rows[0];
    return {
      items: items.rows.map(projectPersistedJob),
      total: Number(total.rows[0]?.total ?? 0),
      page,
      pageSize,
      facets: {
        operations: (facets?.operations ?? []) as ModelSupplyJobListPage['facets']['operations'],
        statuses: (facets?.statuses ?? []) as ModelSupplyJobListPage['facets']['statuses'],
        modalities: (facets?.modalities ?? []) as ModelSupplyJobListPage['facets']['modalities'],
        dataClasses: dataClassValues.rows.map((row) => row.data_class) as ModelSupplyJobListPage['facets']['dataClasses'],
      },
    };
  }

  async saveQualityEvent(workspaceId: string, event: QualityEvent) {
    const stored: QualityEvent = {
      ...event,
      id: event.id ?? randomUUID(),
      createdAt: event.createdAt ?? new Date().toISOString(),
    };
    await this.pool.query(
      `INSERT INTO model_quality_events (workspace_id, event_id, event)
       VALUES ($1, $2, $3::jsonb)
       ON CONFLICT (workspace_id, event_id) DO NOTHING`,
      [workspaceId, stored.id, JSON.stringify(stored)]
    );
    return stored;
  }

  async listQualityEvents(workspaceId: string) {
    const result = await this.pool.query<{ event: QualityEvent }>(
      `SELECT event FROM model_quality_events
        WHERE workspace_id = $1 ORDER BY created_at, event_id`,
      [workspaceId]
    );
    return result.rows.map((row) => row.event);
  }

  async saveQualityEvaluationRun(
    workspaceId: string,
    run: BeautyQualityEvaluationRun,
  ) {
    const { cases, ...header } = run;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO model_quality_evaluation_runs
           (workspace_id, run_id, run, created_at)
         VALUES ($1, $2, $3::jsonb, $4::timestamptz)
         ON CONFLICT (workspace_id, run_id) DO NOTHING`,
        [workspaceId, run.id, JSON.stringify(header), run.createdAt],
      );
      for (const result of cases) {
        await client.query(
          `INSERT INTO model_quality_evaluation_cases
             (workspace_id, run_id, case_id, ordinal, result)
           VALUES ($1, $2, $3, $4, $5::jsonb)
           ON CONFLICT (workspace_id, run_id, case_id) DO NOTHING`,
          [workspaceId, run.id, result.id, result.ordinal, JSON.stringify(result)],
        );
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async getQualityEvaluationRun(workspaceId: string, runId: string) {
    const run = await this.pool.query<{
      run: StoredQualityEvaluationRunHeader;
    }>(
      `SELECT run FROM model_quality_evaluation_runs
        WHERE workspace_id = $1 AND run_id = $2`,
      [workspaceId, runId],
    );
    const header = run.rows[0]?.run;
    if (!header) return null;
    const rejectionCases = Array.isArray(header.rejectionCases)
      ? header.rejectionCases
      : [];
    const cases = await this.pool.query<{ result: BeautyQualityEvaluationCaseResult }>(
      `SELECT result FROM model_quality_evaluation_cases
        WHERE workspace_id = $1 AND run_id = $2
        ORDER BY ordinal, case_id`,
      [workspaceId, runId],
    );
    return {
      ...header,
      evidenceKind: header.evidenceKind ?? 'historical_unknown',
      summary: {
        ...header.summary,
        rejectionCaseCount:
          header.summary.rejectionCaseCount ?? rejectionCases.length,
        rejectionsCaught:
          header.summary.rejectionsCaught ??
          rejectionCases.filter((result) => result.caught).length,
      },
      rejectionCases,
      cases: cases.rows.map((row) => ({
        ...row.result,
        evidenceKind: row.result.evidenceKind ?? 'historical_unknown',
        deploymentId: row.result.deploymentId ?? 'historical-unknown',
      })),
    };
  }

  async listQualityEvaluationRuns(workspaceId: string) {
    const result = await this.pool.query<{ run_id: string }>(
      `SELECT run_id FROM model_quality_evaluation_runs
        WHERE workspace_id = $1 ORDER BY created_at DESC, run_id`,
      [workspaceId],
    );
    const runs: BeautyQualityEvaluationRun[] = [];
    for (const row of result.rows) {
      const run = await this.getQualityEvaluationRun(workspaceId, row.run_id);
      if (run) runs.push(run);
    }
    return runs;
  }

  async listRevisionRollbackAudits(workspaceId: string) {
    const result = await this.pool.query<{ audit: RevisionRollbackAudit }>(
      `SELECT audit FROM model_revision_rollback_audits
        WHERE workspace_id = $1 ORDER BY created_at DESC, audit_id`,
      [workspaceId],
    );
    return result.rows.map((row) => row.audit);
  }

  async deleteWorkspaceForTest(workspaceId: string) {
    for (const table of [
      'model_activation_probe_runs',
      'model_canvas_text_generation_outbox',
      'model_quality_evaluation_cases',
      'model_quality_evaluation_runs',
      'model_revision_rollback_audits',
      'model_prompt_heads',
      'model_generation_jobs',
      'model_catalog_heads',
      'model_workspace_preferences',
      'model_user_preferences',
      'model_catalog_revisions',
      'model_quality_events',
      'model_video_workflows',
    ]) {
      await this.pool.query(`DELETE FROM ${table} WHERE workspace_id = $1`, [workspaceId]);
    }
  }

  private async ensureUserPreference(
    workspaceId: string,
    userId: string,
    operation: string
  ) {
    await this.pool.query(
      `INSERT INTO model_user_preferences (workspace_id, user_id, operation)
       VALUES ($1, $2, $3)
       ON CONFLICT (workspace_id, user_id, operation) DO NOTHING`,
      [workspaceId, userId, operation]
    );
  }

  private insertRollbackAudit(
    client: PoolClient,
    workspaceId: string,
    audit: RevisionRollbackAudit,
  ) {
    return client.query(
      `INSERT INTO model_revision_rollback_audits
         (workspace_id, audit_id, kind, audit, created_at)
       VALUES ($1, $2, $3, $4::jsonb, $5::timestamptz)`,
      [workspaceId, audit.id, audit.kind, JSON.stringify(audit), audit.createdAt],
    );
  }

}

export interface AsyncDurableVideoWorkflowStore {
  get(id: string): Promise<DurableVideoWorkflow | undefined>;
  list(
    workspaceId: string,
    actorId: string,
  ): Promise<DurableVideoWorkflow[]>;
  findLatest(
    workspaceId: string,
    actorId: string,
    workId?: string,
  ): Promise<DurableVideoWorkflow | undefined>;
  save(
    workflow: DurableVideoWorkflow,
    options?: DurableVideoWorkflowSaveOptions,
  ): Promise<DurableVideoWorkflow>;
  claimRun(
    id: string,
    workspaceId: string,
    leaseToken: string,
  ): Promise<DurableVideoWorkflow>;
  requestCancel(
    id: string,
    workspaceId: string,
    requestedAt: string,
  ): Promise<DurableVideoWorkflow>;
  assertRunnable(
    id: string,
    workspaceId: string,
    revision: number,
    leaseToken: string,
  ): Promise<void>;
}

/** Async wrapper that persists every runner checkpoint and restores after restart. */
export class PersistentContentWorkflowRunner {
  constructor(
    private readonly models: ModelSupplyApplicationService,
    private readonly composer: VideoCompositionPort,
    private readonly workflows:
      | AsyncDurableVideoWorkflowStore
      | AsyncCanonicalVideoRunStore,
    private readonly qualityScorer: VideoQualityScoringPort = new VersionedHumanCalibratedVideoQualityScorer(),
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async createVideoWorkflow(input: CreateVideoWorkflowInput) {
    if (input.workflowId) {
      const existing = await this.getStored(input.workflowId);
      if (existing) {
        const memory = new InMemoryDurableVideoWorkflowStore();
        memory.restore(existing);
        return new ContentWorkflowRunner(
          this.models,
          this.composer,
          memory,
          this.qualityScorer,
          this.clock,
        ).createVideoWorkflow(input);
      }
    }
    const memory = new InMemoryDurableVideoWorkflowStore();
    if (input.derivedFromWorkflowId) {
      const source = await this.getStored(input.derivedFromWorkflowId);
      if (!source) {
        throw new Error(`Unknown workflow ${input.derivedFromWorkflowId}.`);
      }
      memory.restore(source);
    }
    const workflow = new ContentWorkflowRunner(
      this.models,
      this.composer,
      memory,
      this.qualityScorer,
      this.clock,
    ).createVideoWorkflow(input);
    return this.saveStored(workflow);
  }

  async getVideoWorkflow(id: string, workspaceId?: string) {
    const workflow = await this.getStored(id);
    if (!workflow) throw new Error(`Unknown durable video workflow ${id}.`);
    if (workspaceId && workflow.workspaceId !== workspaceId) {
      throw new Error('Video workflow belongs to another workspace.');
    }
    return structuredClone(workflow);
  }

  listVideoWorkflows(workspaceId: string, actorId: string) {
    return this.listStored(workspaceId, actorId);
  }

  async findLatestVideoWorkflow(
    workspaceId: string,
    actorId: string,
    workId?: string,
  ) {
    return this.findLatestStored(workspaceId, actorId, workId);
  }

  async confirmVideoWorkflow(id: string, workspaceId?: string) {
    const { runner, workflow: current } = await this.restore(id);
    const workflow = runner.confirmVideoWorkflow(id, workspaceId);
    return this.saveStored(workflow, {
      expectedRevision: current.revision,
    });
  }

  async selectVideoCandidate(input: SelectVideoCandidateInput) {
    const { runner, workflow: current } = await this.restore(input.workflowId);
    const workflow = runner.selectVideoCandidate(input);
    return this.saveStored(workflow, {
      expectedRevision: current.revision,
    });
  }

  async editVideoWorkflow(input: EditVideoWorkflowInput) {
    const canonical = this.canonicalStore();
    if (!canonical) {
      throw new Error(
        'Canonical video editing requires the generic Task/Job/Asset store.',
      );
    }
    const edited = await canonical.editRun(
      input,
      new Date(this.clock()).toISOString(),
    );
    return projectDurableVideoWorkflow(edited);
  }

  async runVideoWorkflow(id: string, workspaceId?: string) {
    const current = await this.getVideoWorkflow(id, workspaceId);
    if (
      current.status === 'completed' ||
      current.status === 'cancelled' ||
      current.status === 'failed'
    ) {
      return current;
    }
    const leaseToken = randomUUID();
    const workflow = await this.claimStored(
      id,
      current.workspaceId,
      leaseToken,
    );
    return runDurableVideoWorkflow({
      workflow,
      models: this.models,
      composer: this.composer,
      qualityScorer: this.qualityScorer,
      clock: this.clock,
      guard: async (checkpoint) =>
        this.workflows.assertRunnable(
          checkpoint.id,
          checkpoint.workspaceId,
          checkpoint.revision,
          leaseToken,
        ),
      checkpoint: async (checkpoint) =>
        this.saveStored(checkpoint, { runLeaseToken: leaseToken }),
    });
  }

  async requestVideoWorkflowCancel(id: string, workspaceId?: string) {
    const current = await this.getVideoWorkflow(id, workspaceId);
    const cancelled = await this.requestCancelStored(
      id,
      current.workspaceId,
      new Date(this.clock()).toISOString(),
    );
    return this.projectStored(cancelled);
  }

  async cancelVideoWorkflow(id: string, workspaceId?: string) {
    const requested = await this.requestVideoWorkflowCancel(id, workspaceId);
    if (requested.status === 'cancelled') return requested;
    const memory = new InMemoryDurableVideoWorkflowStore();
    memory.restore(requested);
    const workflow = await new ContentWorkflowRunner(
      this.models,
      this.composer,
      memory,
      this.qualityScorer,
      this.clock,
    ).cancelVideoWorkflow(id, workspaceId);
    return this.saveStored(workflow, {
      completeCancellation: true,
      expectedRevision: requested.revision,
    });
  }

  private canonicalStore(): AsyncCanonicalVideoRunStore | null {
    return 'getRun' in this.workflows ? this.workflows : null;
  }

  private durableStore(): AsyncDurableVideoWorkflowStore | null {
    return 'get' in this.workflows ? this.workflows : null;
  }

  private projectStored(
    value: DurableVideoWorkflow | ReturnType<typeof liftDurableToCanonical>,
  ): DurableVideoWorkflow {
    return 'runId' in value
      ? projectDurableVideoWorkflow(value)
      : structuredClone(value);
  }

  private async getStored(id: string) {
    const canonical = this.canonicalStore();
    if (!canonical) return this.durableStore()!.get(id);
    const run = await canonical.getRun(id);
    return run ? projectDurableVideoWorkflow(run) : undefined;
  }

  private async listStored(workspaceId: string, actorId: string) {
    const canonical = this.canonicalStore();
    return canonical
      ? (await canonical.listRuns(workspaceId, actorId)).map(
          projectDurableVideoWorkflow,
        )
      : this.durableStore()!.list(workspaceId, actorId);
  }

  private async findLatestStored(
    workspaceId: string,
    actorId: string,
    workId?: string,
  ) {
    const canonical = this.canonicalStore();
    if (!canonical) {
      return this.durableStore()!.findLatest(workspaceId, actorId, workId);
    }
    const run = await canonical.findLatestRun(workspaceId, actorId, workId);
    return run ? projectDurableVideoWorkflow(run) : undefined;
  }

  private async saveStored(
    workflow: DurableVideoWorkflow,
    options: DurableVideoWorkflowSaveOptions = {},
  ) {
    const canonical = this.canonicalStore();
    return canonical
      ? projectDurableVideoWorkflow(
          await canonical.putRun(liftDurableToCanonical(workflow), options),
        )
      : this.durableStore()!.save(workflow, options);
  }

  private async claimStored(
    id: string,
    workspaceId: string,
    leaseToken: string,
  ): Promise<DurableVideoWorkflow> {
    const canonical = this.canonicalStore();
    return canonical
      ? projectDurableVideoWorkflow(
          await canonical.claimRun(id, workspaceId, leaseToken),
        )
      : this.durableStore()!.claimRun(id, workspaceId, leaseToken);
  }

  private async requestCancelStored(
    id: string,
    workspaceId: string,
    requestedAt: string,
  ): Promise<DurableVideoWorkflow> {
    const canonical = this.canonicalStore();
    return canonical
      ? projectDurableVideoWorkflow(
          await canonical.requestCancel(id, workspaceId, requestedAt),
        )
      : this.durableStore()!.requestCancel(id, workspaceId, requestedAt);
  }

  private async restore(id: string) {
    const workflow = await this.getStored(id);
    if (!workflow) throw new Error(`Unknown durable video workflow ${id}.`);
    const memory = new InMemoryDurableVideoWorkflowStore();
    memory.restore(workflow);
    return {
      workflow,
      runner: new ContentWorkflowRunner(
        this.models,
        this.composer,
        memory,
        this.qualityScorer,
        this.clock,
      ),
    };
  }
}
