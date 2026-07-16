import { randomUUID } from 'node:crypto';
import type { Pool, PoolClient } from 'pg';
import { P1DomainError } from '../foundation/domain.js';
import type { CatalogRevision, PreferenceView } from './catalog.js';
import {
  ContentWorkflowRunner,
  InMemoryDurableVideoWorkflowStore,
  RecordedHumanCalibratedVideoQualityScorer,
  VideoWorkflowCancellationError,
  VideoWorkflowConcurrencyError,
  assertVideoWorkflowMutationAllowed,
  assertVideoWorkflowRunnable,
  normalizeStoredVideoWorkflow,
  runDurableVideoWorkflow,
  type CreateVideoWorkflowInput,
  type DurableVideoWorkflow,
  type DurableVideoWorkflowSaveOptions,
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
  PersistedCanvasGenerationQuote,
} from './foundation-module.js';

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
    await this.pool.query(
      `INSERT INTO model_generation_jobs (workspace_id, job_id, status, result)
       VALUES ($1, $2, $3, $4::jsonb)
       ON CONFLICT (workspace_id, job_id)
       DO UPDATE SET status = EXCLUDED.status, result = EXCLUDED.result`,
      [workspaceId, result.jobId, result.status, JSON.stringify(result)]
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
      await client.query(
        `INSERT INTO model_generation_jobs (workspace_id, job_id, status, result)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (workspace_id, job_id) DO NOTHING`,
        [workspaceId, queued.jobId, queued.status, JSON.stringify(queued)],
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
      const completed = await client.query<{ workspace_id: string }>(
        `UPDATE model_canvas_text_generation_outbox
            SET status = 'completed', claim_token = NULL,
                lease_expires_at = NULL
          WHERE outbox_id = $1 AND status = 'claimed' AND claim_token = $2
        RETURNING workspace_id`,
        [input.id, input.claimToken],
      );
      const workspaceId = completed.rows[0]?.workspace_id;
      if (!workspaceId) {
        await client.query('ROLLBACK');
        return false;
      }
      await client.query(
        `INSERT INTO model_generation_jobs (workspace_id, job_id, status, result)
         VALUES ($1, $2, $3, $4::jsonb)
         ON CONFLICT (workspace_id, job_id)
         DO UPDATE SET status = EXCLUDED.status, result = EXCLUDED.result`,
        [workspaceId, input.result.jobId, input.result.status, JSON.stringify(input.result)],
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
    const result = await this.pool.query<{ result: ModelSupplyResult }>(
      `SELECT result FROM model_generation_jobs
        WHERE workspace_id = $1 AND job_id = $2`,
      [workspaceId, jobId]
    );
    return result.rows[0]?.result ?? null;
  }

  async listJobs(workspaceId: string) {
    const result = await this.pool.query<{ result: ModelSupplyResult }>(
      `SELECT result FROM model_generation_jobs
        WHERE workspace_id = $1 ORDER BY created_at DESC, job_id DESC`,
      [workspaceId]
    );
    return result.rows.map((row) => row.result);
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

interface DurableVideoWorkflowRow {
  workflow: DurableVideoWorkflow;
  revision: string | number;
  run_lease_token: string | null;
}

export class PostgresDurableVideoWorkflowStore implements AsyncDurableVideoWorkflowStore {
  constructor(
    private readonly pool: Pool,
    private readonly workspaceId: string
  ) {}

  async get(id: string) {
    const result = await this.pool.query<DurableVideoWorkflowRow>(
      `SELECT workflow, revision, run_lease_token FROM model_video_workflows
        WHERE workspace_id = $1 AND workflow_id = $2`,
      [this.workspaceId, id]
    );
    return result.rows[0] ? workflowFromRow(result.rows[0]) : undefined;
  }

  async list(workspaceId: string, actorId: string) {
    if (workspaceId !== this.workspaceId) {
      throw new Error('Video workflow workspace does not match its durable store.');
    }
    const result = await this.pool.query<DurableVideoWorkflowRow>(
      `SELECT workflow, revision, run_lease_token FROM model_video_workflows
        WHERE workspace_id = $1 AND workflow->>'actorId' = $2
        ORDER BY workflow->>'updatedAt' DESC, workflow_id DESC`,
      [workspaceId, actorId],
    );
    return result.rows.map(workflowFromRow);
  }

  async findLatest(workspaceId: string, actorId: string, workId?: string) {
    if (workspaceId !== this.workspaceId) {
      throw new Error('Video workflow workspace does not match its durable store.');
    }
    const result = await this.pool.query<DurableVideoWorkflowRow>(
      `SELECT workflow, revision, run_lease_token FROM model_video_workflows
        WHERE workspace_id = $1 AND workflow->>'actorId' = $2
          AND ($3::text IS NULL OR workflow->>'workId' = $3)
        ORDER BY
          CASE
            WHEN $3::text IS NOT NULL
              AND workflow->>'storyboardVersion' ~ '^[1-9][0-9]*$'
              THEN (workflow->>'storyboardVersion')::integer
            ELSE 0
          END DESC,
          CASE WHEN workflow->>'status' IN ('completed', 'cancelled', 'failed')
            THEN 1 ELSE 0 END ASC,
          CASE
            WHEN $3::text IS NULL
              AND workflow->>'storyboardVersion' ~ '^[1-9][0-9]*$'
              THEN (workflow->>'storyboardVersion')::integer
            ELSE 0
          END DESC,
          workflow->>'updatedAt' DESC,
          workflow_id DESC
        LIMIT 1`,
      [workspaceId, actorId, workId ?? null],
    );
    return result.rows[0] ? workflowFromRow(result.rows[0]) : undefined;
  }

  async save(
    workflow: DurableVideoWorkflow,
    options: DurableVideoWorkflowSaveOptions = {},
  ) {
    if (workflow.workspaceId !== this.workspaceId) {
      throw new Error('Video workflow workspace does not match its durable store.');
    }
    const candidate = normalizeStoredVideoWorkflow(workflow);
    return this.withWorkflowLock(candidate.id, async (client, row) => {
      if (!row) {
        if ((options.expectedRevision ?? candidate.revision) !== 0) {
          throw new VideoWorkflowConcurrencyError(
            'Video workflow creation used a stale revision.',
          );
        }
        await client.query(
          `INSERT INTO model_video_workflows
             (workspace_id, workflow_id, workflow, revision, run_lease_token, updated_at)
           VALUES ($1, $2, $3::jsonb, 0, NULL, now())`,
          [this.workspaceId, candidate.id, JSON.stringify(candidate)],
        );
        return structuredClone(candidate);
      }
      const current = workflowFromRow(row);
      const expectedRevision = options.expectedRevision ?? candidate.revision;
      assertVideoWorkflowMutationAllowed(
        current,
        candidate,
        expectedRevision,
        row.run_lease_token ?? undefined,
        options,
      );
      if (JSON.stringify(current) === JSON.stringify(candidate)) {
        return current;
      }
      const saved = {
        ...structuredClone(candidate),
        revision: current.revision + 1,
      };
      const releaseRunLease =
        saved.status === 'completed' ||
        saved.status === 'cancelled' ||
        saved.status === 'failed' ||
        saved.status === 'awaiting_quality_review';
      const updated = await client.query<DurableVideoWorkflowRow>(
        `UPDATE model_video_workflows
            SET workflow = $3::jsonb,
                revision = $4,
                run_lease_token = CASE WHEN $5 THEN NULL ELSE run_lease_token END,
                updated_at = now()
          WHERE workspace_id = $1 AND workflow_id = $2
            AND revision = $6
            AND ($7::text IS NULL OR run_lease_token = $7)
          RETURNING workflow, revision, run_lease_token`,
        [
          this.workspaceId,
          saved.id,
          JSON.stringify(saved),
          saved.revision,
          releaseRunLease,
          expectedRevision,
          options.runLeaseToken ?? null,
        ],
      );
      if (!updated.rows[0]) {
        throw new VideoWorkflowConcurrencyError(
          'Video workflow result belongs to a stale run lease.',
        );
      }
      return workflowFromRow(updated.rows[0]);
    });
  }

  async claimRun(id: string, workspaceId: string, leaseToken: string) {
    this.assertWorkspace(workspaceId);
    return this.withWorkflowLock(id, async (client, row) => {
      if (!row) throw new Error(`Unknown durable video workflow ${id}.`);
      const current = workflowFromRow(row);
      if (
        current.status === 'cancel_requested' ||
        current.status === 'cancelled'
      ) {
        throw new VideoWorkflowCancellationError(
          'Video workflow cancellation was requested.',
        );
      }
      if (current.status === 'completed' || current.status === 'failed') {
        return current;
      }
      if (!current.confirmed) {
        throw new Error(
          'Storyboard must be confirmed before clip attempts are created.',
        );
      }
      const claimed = {
        ...structuredClone(current),
        status: 'running' as const,
        revision: current.revision + 1,
      };
      const updated = await client.query<DurableVideoWorkflowRow>(
        `UPDATE model_video_workflows
            SET workflow = $3::jsonb, revision = $4,
                run_lease_token = $5, updated_at = now()
          WHERE workspace_id = $1 AND workflow_id = $2 AND revision = $6
          RETURNING workflow, revision, run_lease_token`,
        [
          this.workspaceId,
          id,
          JSON.stringify(claimed),
          claimed.revision,
          leaseToken,
          current.revision,
        ],
      );
      if (!updated.rows[0]) {
        throw new VideoWorkflowConcurrencyError(
          'Video workflow run claim is stale.',
        );
      }
      return workflowFromRow(updated.rows[0]);
    });
  }

  async requestCancel(id: string, workspaceId: string, requestedAt: string) {
    this.assertWorkspace(workspaceId);
    return this.withWorkflowLock(id, async (client, row) => {
      if (!row) throw new Error(`Unknown durable video workflow ${id}.`);
      const current = workflowFromRow(row);
      if (current.status === 'completed' || current.status === 'failed') {
        throw new Error('A terminal video workflow cannot be cancelled.');
      }
      if (
        current.status === 'cancel_requested' ||
        current.status === 'cancelled'
      ) {
        return current;
      }
      const requested: DurableVideoWorkflow = {
        ...structuredClone(current),
        status: 'cancel_requested',
        cancelRequestedAt: requestedAt,
        revision: current.revision + 1,
        updatedAt: requestedAt,
      };
      const updated = await client.query<DurableVideoWorkflowRow>(
        `UPDATE model_video_workflows
            SET workflow = $3::jsonb, revision = $4,
                run_lease_token = NULL, updated_at = now()
          WHERE workspace_id = $1 AND workflow_id = $2 AND revision = $5
          RETURNING workflow, revision, run_lease_token`,
        [
          this.workspaceId,
          id,
          JSON.stringify(requested),
          requested.revision,
          current.revision,
        ],
      );
      if (!updated.rows[0]) {
        throw new VideoWorkflowConcurrencyError(
          'Video workflow cancellation used a stale revision.',
        );
      }
      return workflowFromRow(updated.rows[0]);
    });
  }

  async assertRunnable(
    id: string,
    workspaceId: string,
    revision: number,
    leaseToken: string,
  ) {
    this.assertWorkspace(workspaceId);
    const result = await this.pool.query<DurableVideoWorkflowRow>(
      `SELECT workflow, revision, run_lease_token
         FROM model_video_workflows
        WHERE workspace_id = $1 AND workflow_id = $2`,
      [this.workspaceId, id],
    );
    if (!result.rows[0]) throw new Error(`Unknown durable video workflow ${id}.`);
    assertVideoWorkflowRunnable(
      workflowFromRow(result.rows[0]),
      revision,
      result.rows[0].run_lease_token ?? undefined,
      leaseToken,
    );
  }

  private assertWorkspace(workspaceId: string) {
    if (workspaceId !== this.workspaceId) {
      throw new Error('Video workflow workspace does not match its durable store.');
    }
  }

  private async withWorkflowLock<T>(
    id: string,
    action: (
      client: PoolClient,
      row: DurableVideoWorkflowRow | undefined,
    ) => Promise<T>,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const result = await client.query<DurableVideoWorkflowRow>(
        `SELECT workflow, revision, run_lease_token
           FROM model_video_workflows
          WHERE workspace_id = $1 AND workflow_id = $2
          FOR UPDATE`,
        [this.workspaceId, id],
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

function workflowFromRow(row: DurableVideoWorkflowRow) {
  return normalizeStoredVideoWorkflow({
    ...row.workflow,
    revision: Number(row.revision),
  });
}

/** Async wrapper that persists every runner checkpoint and restores after restart. */
export class PersistentContentWorkflowRunner {
  constructor(
    private readonly models: ModelSupplyApplicationService,
    private readonly composer: VideoCompositionPort,
    private readonly workflows: AsyncDurableVideoWorkflowStore,
    private readonly qualityScorer: VideoQualityScoringPort = new RecordedHumanCalibratedVideoQualityScorer(),
    private readonly clock: () => number = () => Date.now(),
  ) {}

  async createVideoWorkflow(input: CreateVideoWorkflowInput) {
    if (input.workflowId) {
      const existing = await this.workflows.get(input.workflowId);
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
      const source = await this.workflows.get(input.derivedFromWorkflowId);
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
    return this.workflows.save(workflow);
  }

  async getVideoWorkflow(id: string, workspaceId?: string) {
    const workflow = await this.workflows.get(id);
    if (!workflow) throw new Error(`Unknown durable video workflow ${id}.`);
    if (workspaceId && workflow.workspaceId !== workspaceId) {
      throw new Error('Video workflow belongs to another workspace.');
    }
    return structuredClone(workflow);
  }

  listVideoWorkflows(workspaceId: string, actorId: string) {
    return this.workflows.list(workspaceId, actorId);
  }

  async findLatestVideoWorkflow(
    workspaceId: string,
    actorId: string,
    workId?: string,
  ) {
    return this.workflows.findLatest(workspaceId, actorId, workId);
  }

  async confirmVideoWorkflow(id: string, workspaceId?: string) {
    const { runner, workflow: current } = await this.restore(id);
    const workflow = runner.confirmVideoWorkflow(id, workspaceId);
    return this.workflows.save(workflow, {
      expectedRevision: current.revision,
    });
  }

  async selectVideoCandidate(input: SelectVideoCandidateInput) {
    const { runner, workflow: current } = await this.restore(input.workflowId);
    const workflow = runner.selectVideoCandidate(input);
    return this.workflows.save(workflow, {
      expectedRevision: current.revision,
    });
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
    const workflow = await this.workflows.claimRun(
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
        this.workflows.save(checkpoint, { runLeaseToken: leaseToken }),
    });
  }

  async requestVideoWorkflowCancel(id: string, workspaceId?: string) {
    const current = await this.getVideoWorkflow(id, workspaceId);
    return this.workflows.requestCancel(
      id,
      current.workspaceId,
      new Date(this.clock()).toISOString(),
    );
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
    return this.workflows.save(workflow, {
      completeCancellation: true,
      expectedRevision: requested.revision,
    });
  }

  private async restore(id: string) {
    const workflow = await this.workflows.get(id);
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
