import { createHash } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import type { FoundationStore } from '../foundation/ports.js';

const modalities = ['copy', 'image_text', 'video'] as const;
const modalityCapMicros = {
  copy: 100_000,
  image_text: 500_000,
  video: 3_000_000,
} as const;

const claimInputSchema = z
  .object({
    workspaceId: z.string().trim().min(1),
    runNonce: z.string().trim().min(1),
    modality: z.enum(modalities),
    effectId: z.string().regex(/^[a-f0-9]{64}$/u),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    adapter: z.string().trim().min(1),
    deploymentId: z.string().trim().min(1),
    providerIdempotencyKey: z.string().trim().min(1),
    providerJobId: z.string().trim().min(1),
    providerAttemptId: z.string().trim().min(1),
    providerCostEventId: z.string().trim().min(1),
    recordedMatrixDigest: z.string().regex(/^[a-f0-9]{64}$/u),
    reservedAmountMicros: z.number().int().positive(),
    priceRevision: z.string().trim().min(1),
    exchangeRevision: z.string().trim().min(1),
  })
  .strict();

export type Issue255LiveReceiptClaimInput = z.infer<typeof claimInputSchema>;

export interface Issue255LiveReceipt {
  workspaceId: string;
  runNonce: string;
  modality: (typeof modalities)[number];
  effectId: string;
  requestFingerprint: string;
  adapter: string;
  deploymentId: string;
  providerIdempotencyKey: string;
  providerJobId: string;
  providerAttemptId: string;
  providerCostEventId: string;
  recordedMatrixDigest: string;
  reservedAmountMicros: number;
  priceRevision: string;
  exchangeRevision: string;
  status: 'claimed' | 'unknown' | 'completed';
  generationSubmitCount: number;
  providerHttpRequestCount: number;
  actualAmountMicros: number | null;
  terminalLineage: Issue255DurableTerminalLineage | null;
  reconciliationReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export type Issue255LiveReceiptClaim = {
  kind: 'claimed';
  receipt: Issue255LiveReceipt;
};

interface ReceiptRow extends QueryResultRow {
  workspace_id: string;
  run_nonce: string;
  modality: (typeof modalities)[number];
  effect_id: string;
  request_fingerprint: string;
  adapter: string;
  deployment_id: string;
  provider_idempotency_key: string;
  provider_job_id: string;
  provider_attempt_id: string;
  provider_cost_event_id: string;
  recorded_matrix_digest: string;
  reserved_amount_micros: string;
  price_revision: string;
  exchange_revision: string;
  status: 'claimed' | 'unknown' | 'completed';
  generation_submit_count: number;
  provider_http_request_count: number;
  actual_amount_micros: string | null;
  terminal_lineage: unknown;
  reconciliation_reason: string | null;
  created_at: Date;
  updated_at: Date;
}

const durableTerminalLineageSchema = z
  .object({
    workspaceId: z.string().trim().min(1),
    effectId: z.string().regex(/^[a-f0-9]{64}$/u),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    adapter: z.enum(['direct-copy', 'tuzi-image', 'tuzi-video']),
    deploymentId: z.string().trim().min(1),
    providerIdempotencyKey: z.string().trim().min(1),
    attempt: z
      .object({
        id: z.string().trim().min(1),
        jobId: z.string().trim().min(1),
        deploymentId: z.string().trim().min(1),
        providerTaskRef: z.string().trim().min(1),
        acceptance: z.literal('accepted'),
        status: z.literal('completed'),
      })
      .strict(),
    providerCost: z
      .object({
        id: z.string().trim().min(1),
        attemptId: z.string().trim().min(1),
        amountMicros: z.number().int().positive(),
        currency: z.literal('CNY'),
        priceRevision: z.string().trim().min(1),
        exchangeRevision: z.literal('native-cny-v1'),
        stage: z.enum(['observed', 'reconciled']),
        usage: z
          .object({
            inputTokens: z.number().int().nonnegative().optional(),
            outputTokens: z.number().int().nonnegative().optional(),
            mediaUnits: z.number().int().nonnegative().optional(),
          })
          .strict()
          .refine((usage) => Object.keys(usage).length > 0, {
            message: 'Durable ProviderCost lineage requires actual usage.',
          }),
      })
      .strict(),
  })
  .strict();

export type Issue255DurableTerminalLineage = z.infer<
  typeof durableTerminalLineageSchema
>;

type Issue255ProviderLedgerReader = Pick<
  FoundationStore,
  'getGenerationJob' | 'getProviderAttempt' | 'listProviderCosts'
>;

export class PostgresIssue255LiveReceiptRepository {
  constructor(private readonly pool: Pool) {}

  async migrate() {
    return this.locked('issue255-live-migration-v1', async (client) => {
      await client.query(`
      CREATE TABLE IF NOT EXISTS issue255_live_generation_receipts (
        workspace_id text NOT NULL,
        run_nonce text NOT NULL,
        modality text NOT NULL
          CHECK (modality IN ('copy', 'image_text', 'video')),
        effect_id text NOT NULL UNIQUE,
        request_fingerprint text NOT NULL,
        adapter text NOT NULL,
        deployment_id text NOT NULL,
        provider_idempotency_key text NOT NULL,
        provider_job_id text NOT NULL,
        provider_attempt_id text NOT NULL,
        provider_cost_event_id text NOT NULL,
        recorded_matrix_digest text NOT NULL,
        reserved_amount_micros bigint NOT NULL
          CHECK (reserved_amount_micros > 0),
        price_revision text NOT NULL,
        exchange_revision text NOT NULL,
        status text NOT NULL
          CHECK (status IN ('claimed', 'unknown', 'completed')),
        generation_submit_count integer NOT NULL DEFAULT 0
          CHECK (generation_submit_count BETWEEN 0 AND 1),
        provider_http_request_count integer NOT NULL DEFAULT 0
          CHECK (provider_http_request_count >= 0),
        actual_amount_micros bigint,
        terminal_lineage jsonb,
        reconciliation_reason text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (run_nonce, modality)
      )
      `);
      await client.query(`
      ALTER TABLE issue255_live_generation_receipts
      ADD COLUMN IF NOT EXISTS reconciliation_reason text
      `);
      await client.query(`
      ALTER TABLE issue255_live_generation_receipts
        ADD COLUMN IF NOT EXISTS workspace_id text,
        ADD COLUMN IF NOT EXISTS provider_job_id text,
        ADD COLUMN IF NOT EXISTS provider_attempt_id text,
        ADD COLUMN IF NOT EXISTS provider_cost_event_id text,
        ADD COLUMN IF NOT EXISTS provider_http_request_count integer NOT NULL DEFAULT 0
      `);
      await client.query(`
      DO $issue255$
      BEGIN
        IF EXISTS (
          SELECT 1
            FROM issue255_live_generation_receipts
           WHERE workspace_id IS NULL
              OR provider_job_id IS NULL
              OR provider_attempt_id IS NULL
              OR provider_cost_event_id IS NULL
        ) THEN
          RAISE EXCEPTION
            'Issue 255 refuses legacy receipts without frozen lineage';
        END IF;
      END
      $issue255$
      `);
      await client.query(`
      ALTER TABLE issue255_live_generation_receipts
        ALTER COLUMN workspace_id SET NOT NULL,
        ALTER COLUMN provider_job_id SET NOT NULL,
        ALTER COLUMN provider_attempt_id SET NOT NULL,
        ALTER COLUMN provider_cost_event_id SET NOT NULL
      `);
      await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        issue255_live_receipt_provider_job_unique
        ON issue255_live_generation_receipts (provider_job_id)
      `);
      await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        issue255_live_receipt_provider_attempt_unique
        ON issue255_live_generation_receipts (provider_attempt_id)
      `);
      await client.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        issue255_live_receipt_provider_cost_unique
        ON issue255_live_generation_receipts (provider_cost_event_id)
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS issue255_live_generation_authorizations (
          effect_id text PRIMARY KEY,
          run_nonce text NOT NULL,
          modality text NOT NULL
            CHECK (modality IN ('copy', 'image_text', 'video')),
          request_fingerprint text NOT NULL,
          workspace_id text NOT NULL,
          adapter text NOT NULL,
          deployment_id text NOT NULL,
          provider_idempotency_key text NOT NULL,
          recorded_matrix_digest text NOT NULL,
          reserved_amount_micros bigint NOT NULL
            CHECK (reserved_amount_micros > 0),
          price_revision text NOT NULL,
          exchange_revision text NOT NULL,
          evidence_sample_digest text,
          evidence_envelope_digest text,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (run_nonce, modality)
        )
      `);
      await client.query(`
        ALTER TABLE issue255_live_generation_authorizations
          ADD COLUMN IF NOT EXISTS evidence_sample_digest text,
          ADD COLUMN IF NOT EXISTS evidence_envelope_digest text
      `);
      await client.query(`
        DO $issue255$
        BEGIN
          IF EXISTS (
            SELECT 1
              FROM issue255_live_generation_receipts receipt
              JOIN issue255_live_generation_authorizations history
                ON history.effect_id = receipt.effect_id
                OR (
                  history.run_nonce = receipt.run_nonce
                  AND history.modality = receipt.modality
                )
             WHERE receipt.generation_submit_count = 1
               AND ROW(
                 history.effect_id,
                 history.run_nonce,
                 history.modality,
                 history.request_fingerprint,
                 history.workspace_id,
                 history.adapter,
                 history.deployment_id,
                 history.provider_idempotency_key,
                 history.recorded_matrix_digest,
                 history.reserved_amount_micros,
                 history.price_revision,
                 history.exchange_revision
               ) IS DISTINCT FROM ROW(
                 receipt.effect_id,
                 receipt.run_nonce,
                 receipt.modality,
                 receipt.request_fingerprint,
                 receipt.workspace_id,
                 receipt.adapter,
                 receipt.deployment_id,
                 receipt.provider_idempotency_key,
                 receipt.recorded_matrix_digest,
                 receipt.reserved_amount_micros,
                 receipt.price_revision,
                 receipt.exchange_revision
               )
          ) THEN
            RAISE EXCEPTION
              'Issue 255 legacy authorization identity conflict';
          END IF;
        END
        $issue255$
      `);
      await client.query(`
        INSERT INTO issue255_live_generation_authorizations (
          effect_id,
          run_nonce,
          modality,
          request_fingerprint,
          workspace_id,
          adapter,
          deployment_id,
          provider_idempotency_key,
          recorded_matrix_digest,
          reserved_amount_micros,
          price_revision,
          exchange_revision,
          created_at
        )
        SELECT
          effect_id,
          run_nonce,
          modality,
          request_fingerprint,
          workspace_id,
          adapter,
          deployment_id,
          provider_idempotency_key,
          recorded_matrix_digest,
          reserved_amount_micros,
          price_revision,
          exchange_revision,
          created_at
        FROM issue255_live_generation_receipts
        WHERE generation_submit_count = 1
        ON CONFLICT DO NOTHING
      `);
    });
  }

  async listRun(runNonce: string) {
    const parsedRunNonce = z.string().trim().min(1).parse(runNonce);
    const result = await this.pool.query<ReceiptRow>(
      `SELECT *
         FROM issue255_live_generation_receipts
        WHERE run_nonce = $1
        ORDER BY created_at, modality`,
      [parsedRunNonce],
    );
    return result.rows.map(receiptFromRow);
  }

  async bindManifestEvidence(input: {
    runNonce: string;
    envelopeDigest: string;
    samples: readonly {
      effectId: string;
      sampleDigest: string;
    }[];
  }) {
    const parsed = z
      .object({
        runNonce: z.string().trim().min(1),
        envelopeDigest: z.string().regex(/^[a-f0-9]{64}$/u),
        samples: z
          .array(
            z
              .object({
                effectId: z.string().regex(/^[a-f0-9]{64}$/u),
                sampleDigest: z.string().regex(/^[a-f0-9]{64}$/u),
              })
              .strict(),
          )
          .length(3)
          .refine(
            (samples) =>
              new Set(samples.map(({ effectId }) => effectId)).size === 3,
            'Issue 255 manifest evidence requires three unique effects.',
          ),
      })
      .strict()
      .parse(input);
    return this.locked(parsed.runNonce, async (client) => {
      const completed = await client.query<{
        effect_id: string;
      }>(
        `SELECT history.effect_id
           FROM issue255_live_generation_authorizations history
           JOIN issue255_live_generation_receipts receipt
             ON receipt.effect_id = history.effect_id
            AND receipt.run_nonce = history.run_nonce
            AND receipt.modality = history.modality
          WHERE history.run_nonce = $1
            AND receipt.status = 'completed'
            AND receipt.generation_submit_count = 1
            AND receipt.terminal_lineage IS NOT NULL
          FOR UPDATE OF history`,
        [parsed.runNonce],
      );
      if (
        completed.rows.length !== 3 ||
        parsed.samples.some(
          (sample) =>
            !completed.rows.some(
              ({ effect_id }) => effect_id === sample.effectId,
            ),
        )
      ) {
        throw new Error(
          'Issue 255 manifest evidence requires three completed durable receipts.',
        );
      }
      for (const sample of parsed.samples) {
        const updated = await client.query(
          `UPDATE issue255_live_generation_authorizations
              SET evidence_sample_digest = $3,
                  evidence_envelope_digest = $4
            WHERE run_nonce = $1
              AND effect_id = $2
              AND (
                evidence_sample_digest IS NULL
                OR evidence_sample_digest = $3
              )
              AND (
                evidence_envelope_digest IS NULL
                OR evidence_envelope_digest = $4
              )
          RETURNING effect_id`,
          [
            parsed.runNonce,
            sample.effectId,
            sample.sampleDigest,
            parsed.envelopeDigest,
          ],
        );
        if (!updated.rows[0]) {
          throw new Error(
            'Issue 255 durable manifest evidence binding is immutable.',
          );
        }
      }
    });
  }

  async markUnknown(input: {
    runNonce: string;
    modality: (typeof modalities)[number];
    effectId: string;
    requestFingerprint: string;
    reason: 'provider_acceptance_unknown';
  }) {
    const parsed = z
      .object({
        runNonce: z.string().trim().min(1),
        modality: z.enum(modalities),
        effectId: z.string().regex(/^[a-f0-9]{64}$/u),
        requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
        reason: z.literal('provider_acceptance_unknown'),
      })
      .strict()
      .parse(input);
    return this.locked(parsed.runNonce, async (client) => {
      const updated = await client.query<ReceiptRow>(
        `UPDATE issue255_live_generation_receipts
            SET status = 'unknown',
                reconciliation_reason = $5,
                updated_at = now()
          WHERE run_nonce = $1
            AND modality = $2
            AND effect_id = $3
            AND request_fingerprint = $4
            AND status = 'claimed'
            AND generation_submit_count = 1
        RETURNING *`,
        [
          parsed.runNonce,
          parsed.modality,
          parsed.effectId,
          parsed.requestFingerprint,
          parsed.reason,
        ],
      );
      const row = updated.rows[0];
      if (!row) {
        throw new Error(
          'Issue 255 claimed receipt with a submitted generation could not be marked unknown.',
        );
      }
      return receiptFromRow(row);
    });
  }

  async recordExecutionFailure(input: {
    runNonce: string;
    modality: (typeof modalities)[number];
    effectId: string;
    requestFingerprint: string;
  }): Promise<
    | { kind: 'rejected_before_accept' }
    | {
        kind: 'provider_acceptance_unknown';
        receipt: Issue255LiveReceipt;
      }
  > {
    const parsed = z
      .object({
        runNonce: z.string().trim().min(1),
        modality: z.enum(modalities),
        effectId: z.string().regex(/^[a-f0-9]{64}$/u),
        requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict()
      .parse(input);
    return this.locked(parsed.runNonce, async (client) => {
      const selected = await client.query<ReceiptRow>(
        `SELECT *
           FROM issue255_live_generation_receipts
          WHERE run_nonce = $1
            AND modality = $2
            AND effect_id = $3
            AND request_fingerprint = $4
            AND status = 'claimed'
          FOR UPDATE`,
        [
          parsed.runNonce,
          parsed.modality,
          parsed.effectId,
          parsed.requestFingerprint,
        ],
      );
      const row = selected.rows[0];
      if (!row) {
        throw new Error(
          'Issue 255 claimed receipt could not classify its execution failure.',
        );
      }
      if (row.generation_submit_count === 0) {
        await client.query(
          `DELETE FROM issue255_live_generation_receipts
            WHERE run_nonce = $1
              AND modality = $2
              AND effect_id = $3
              AND request_fingerprint = $4
              AND status = 'claimed'
              AND generation_submit_count = 0`,
          [
            parsed.runNonce,
            parsed.modality,
            parsed.effectId,
            parsed.requestFingerprint,
          ],
        );
        return { kind: 'rejected_before_accept' };
      }
      const updated = await client.query<ReceiptRow>(
        `UPDATE issue255_live_generation_receipts
            SET status = 'unknown',
                reconciliation_reason = 'provider_acceptance_unknown',
                updated_at = now()
          WHERE run_nonce = $1
            AND modality = $2
            AND effect_id = $3
            AND request_fingerprint = $4
            AND status = 'claimed'
            AND generation_submit_count = 1
        RETURNING *`,
        [
          parsed.runNonce,
          parsed.modality,
          parsed.effectId,
          parsed.requestFingerprint,
        ],
      );
      const unknown = updated.rows[0];
      if (!unknown) {
        throw new Error(
          'Issue 255 submitted receipt could not be frozen for reconciliation.',
        );
      }
      return {
        kind: 'provider_acceptance_unknown',
        receipt: receiptFromRow(unknown),
      };
    });
  }

  async claimGenerationPost(input: {
    adapter: 'direct-copy' | 'tuzi-image' | 'tuzi-video';
    deploymentId: string;
    runNonce: string;
    modality: (typeof modalities)[number];
    effectId: string;
    providerIdempotencyKey: string;
    requestFingerprint: string;
  }) {
    const parsed = z
      .object({
        adapter: z.enum(['direct-copy', 'tuzi-image', 'tuzi-video']),
        deploymentId: z.string().trim().min(1),
        runNonce: z.string().trim().min(1),
        modality: z.enum(modalities),
        effectId: z.string().regex(/^[a-f0-9]{64}$/u),
        providerIdempotencyKey: z.string().trim().min(1),
        requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict()
      .parse(input);
    return this.locked(parsed.runNonce, async (client) => {
      const submissionCounts = await client.query<{
        global_count: string;
        run_count: string;
      }>(
        `SELECT
           COUNT(*)::bigint AS global_count,
           COUNT(*) FILTER (WHERE run_nonce = $1)::bigint AS run_count
         FROM issue255_live_generation_authorizations`,
        [parsed.runNonce],
      );
      if (
        Number(submissionCounts.rows[0]?.global_count ?? 0) >= 3 ||
        Number(submissionCounts.rows[0]?.run_count ?? 0) >= 3
      ) {
        throw new Error(
          'Issue 255 permits exactly three billable generation POSTs globally.',
        );
      }
      const updated = await client.query<ReceiptRow>(
        `UPDATE issue255_live_generation_receipts
            SET generation_submit_count = 1,
                updated_at = now()
          WHERE run_nonce = $1
            AND modality = $2
            AND effect_id = $3
            AND request_fingerprint = $4
            AND adapter = $5
            AND deployment_id = $6
            AND provider_idempotency_key = $7
            AND status = 'claimed'
            AND generation_submit_count = 0
        RETURNING *`,
        [
          parsed.runNonce,
          parsed.modality,
          parsed.effectId,
          parsed.requestFingerprint,
          parsed.adapter,
          parsed.deploymentId,
          parsed.providerIdempotencyKey,
        ],
      );
      const row = updated.rows[0];
      if (!row) {
        throw new Error(
          'Issue 255 generation POST is already fenced, differs from the frozen provider identity, or requires reconciliation.',
        );
      }
      const authorization = await client.query(
        `INSERT INTO issue255_live_generation_authorizations (
           effect_id,
           run_nonce,
           modality,
           request_fingerprint,
           workspace_id,
           adapter,
           deployment_id,
           provider_idempotency_key,
           recorded_matrix_digest,
           reserved_amount_micros,
           price_revision,
           exchange_revision
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12
         )
         ON CONFLICT DO NOTHING
         RETURNING effect_id`,
        [
          row.effect_id,
          row.run_nonce,
          row.modality,
          row.request_fingerprint,
          row.workspace_id,
          row.adapter,
          row.deployment_id,
          row.provider_idempotency_key,
          row.recorded_matrix_digest,
          row.reserved_amount_micros,
          row.price_revision,
          row.exchange_revision,
        ],
      );
      if (!authorization.rows[0]) {
        throw new Error(
          'Issue 255 generation authorization already exists and cannot be replayed.',
        );
      }
      return receiptFromRow(row);
    });
  }

  async recordProviderHttpRequest(input: {
    adapter: 'direct-copy' | 'tuzi-image' | 'tuzi-video';
    deploymentId: string;
    runNonce: string;
    modality: (typeof modalities)[number];
    effectId: string;
    providerIdempotencyKey: string;
    requestFingerprint: string;
  }) {
    const parsed = z
      .object({
        adapter: z.enum(['direct-copy', 'tuzi-image', 'tuzi-video']),
        deploymentId: z.string().trim().min(1),
        runNonce: z.string().trim().min(1),
        modality: z.enum(modalities),
        effectId: z.string().regex(/^[a-f0-9]{64}$/u),
        providerIdempotencyKey: z.string().trim().min(1),
        requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict()
      .parse(input);
    return this.locked(parsed.runNonce, async (client) => {
      const updated = await client.query<ReceiptRow>(
        `UPDATE issue255_live_generation_receipts
            SET provider_http_request_count = provider_http_request_count + 1,
                updated_at = now()
          WHERE run_nonce = $1
            AND modality = $2
            AND effect_id = $3
            AND request_fingerprint = $4
            AND adapter = $5
            AND deployment_id = $6
            AND provider_idempotency_key = $7
            AND status = 'claimed'
            AND generation_submit_count = 1
        RETURNING *`,
        [
          parsed.runNonce,
          parsed.modality,
          parsed.effectId,
          parsed.requestFingerprint,
          parsed.adapter,
          parsed.deploymentId,
          parsed.providerIdempotencyKey,
        ],
      );
      const row = updated.rows[0];
      if (!row) {
        throw new Error(
          'Issue 255 provider HTTP request is outside its claimed generation effect.',
        );
      }
      return receiptFromRow(row);
    });
  }

  async completeFromProviderLedger(
    input: {
      runNonce: string;
      modality: (typeof modalities)[number];
      effectId: string;
      requestFingerprint: string;
    },
    providerLedger: Issue255ProviderLedgerReader,
  ) {
    return this.completeOrReconcile(input, providerLedger, false);
  }

  async reconcileFromProviderLedger(
    input: {
      runNonce: string;
      modality: (typeof modalities)[number];
      effectId: string;
      requestFingerprint: string;
    },
    providerLedger: Issue255ProviderLedgerReader,
  ) {
    return this.completeOrReconcile(input, providerLedger, true);
  }

  async claim(input: Issue255LiveReceiptClaimInput): Promise<Issue255LiveReceiptClaim> {
    const claim = claimInputSchema.parse(input);
    assertStableEffectIdentity(claim);
    if (claim.providerIdempotencyKey !== claim.effectId) {
      throw new Error(
        'Issue 255 provider idempotency key must equal the stable effect id.',
      );
    }
    if (claim.reservedAmountMicros > modalityCapMicros[claim.modality]) {
      throw new Error(
        `Issue 255 ${claim.modality} reservation exceeds its approved cap.`,
      );
    }

    return this.locked(claim.runNonce, async (client) => {
      const existing = await client.query<ReceiptRow>(
        `SELECT *
           FROM issue255_live_generation_receipts
          WHERE run_nonce = $1 AND modality = $2`,
        [claim.runNonce, claim.modality],
      );
      const existingReceipt = existing.rows[0];
      if (existingReceipt) {
        if (
          existingReceipt.request_fingerprint !== claim.requestFingerprint
        ) {
          throw new Error(
            'Issue 255 stable effect has a request fingerprint conflict.',
          );
        }
        throw new Error(
          `Issue 255 generation effect is already ${existingReceipt.status} and requires reconciliation.`,
        );
      }

      const active = await client.query<Pick<ReceiptRow, 'status'>>(
        `SELECT status
           FROM issue255_live_generation_receipts
          WHERE run_nonce = $1
            AND status IN ('claimed', 'unknown')
          LIMIT 1`,
        [claim.runNonce],
      );
      if (active.rows[0]) {
        throw new Error(
          'Issue 255 live run is already claimed or unknown and requires reconciliation.',
        );
      }

      await this.assertBudget(client, claim);
      const inserted = await client.query<ReceiptRow>(
        `INSERT INTO issue255_live_generation_receipts (
           workspace_id,
           run_nonce,
           modality,
           effect_id,
           request_fingerprint,
           adapter,
           deployment_id,
           provider_idempotency_key,
           provider_job_id,
           provider_attempt_id,
           provider_cost_event_id,
           recorded_matrix_digest,
           reserved_amount_micros,
           price_revision,
           exchange_revision,
           status
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
           'claimed'
         )
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
          claim.workspaceId,
          claim.runNonce,
          claim.modality,
          claim.effectId,
          claim.requestFingerprint,
          claim.adapter,
          claim.deploymentId,
          claim.providerIdempotencyKey,
          claim.providerJobId,
          claim.providerAttemptId,
          claim.providerCostEventId,
          claim.recordedMatrixDigest,
          claim.reservedAmountMicros,
          claim.priceRevision,
          claim.exchangeRevision,
        ],
      );
      const row = inserted.rows[0];
      if (!row) {
        throw new Error(
          'Issue 255 generation effect or durable provider lineage is already bound to another receipt and requires reconciliation.',
        );
      }
      return { kind: 'claimed', receipt: receiptFromRow(row) };
    });
  }

  private async completeOrReconcile(
    input: {
      runNonce: string;
      modality: (typeof modalities)[number];
      effectId: string;
      requestFingerprint: string;
    },
    providerLedger: Issue255ProviderLedgerReader,
    requireUnknown: boolean,
  ) {
    const parsed = z
      .object({
        runNonce: z.string().trim().min(1),
        modality: z.enum(modalities),
        effectId: z.string().regex(/^[a-f0-9]{64}$/u),
        requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict()
      .parse(input);
    return this.locked(parsed.runNonce, async (client) => {
      const selected = await client.query<ReceiptRow>(
        `SELECT *
           FROM issue255_live_generation_receipts
          WHERE run_nonce = $1
            AND modality = $2
            AND effect_id = $3
            AND request_fingerprint = $4
          FOR UPDATE`,
        [
          parsed.runNonce,
          parsed.modality,
          parsed.effectId,
          parsed.requestFingerprint,
        ],
      );
      const row = selected.rows[0];
      if (!row) {
        throw new Error('Issue 255 live receipt was not found.');
      }
      if (row.status === 'completed') return receiptFromRow(row);
      if (requireUnknown && row.status !== 'unknown') {
        throw new Error(
          'Issue 255 reconciliation requires an unknown receipt.',
        );
      }
      if (
        row.generation_submit_count !== 1 ||
        row.provider_http_request_count < 1
      ) {
        throw new Error(
          'Issue 255 terminal completion requires fenced generation and provider HTTP evidence.',
        );
      }
      const terminal = await readDurableTerminalLineage(
        row,
        providerLedger,
      );
      if (
        terminal.providerCost.amountMicros >
        Number(row.reserved_amount_micros)
      ) {
        throw new Error(
          'Issue 255 durable ProviderCost exceeds the reserved amount.',
        );
      }
      const completed = await client.query<ReceiptRow>(
        `UPDATE issue255_live_generation_receipts
            SET status = 'completed',
                actual_amount_micros = $5,
                terminal_lineage = $6::jsonb,
                reconciliation_reason = $7,
                updated_at = now()
          WHERE run_nonce = $1
            AND modality = $2
            AND effect_id = $3
            AND request_fingerprint = $4
            AND status IN ('claimed', 'unknown')
        RETURNING *`,
        [
          parsed.runNonce,
          parsed.modality,
          parsed.effectId,
          parsed.requestFingerprint,
          terminal.providerCost.amountMicros,
          JSON.stringify(terminal),
          row.status === 'unknown' ? 'provider_ledger_reconciled' : null,
        ],
      );
      const completedRow = completed.rows[0];
      if (!completedRow) {
        throw new Error(
          'Issue 255 live receipt completion lost its reconciliation claim.',
        );
      }
      return receiptFromRow(completedRow);
    });
  }

  private async assertBudget(
    client: PoolClient,
    input: Issue255LiveReceiptClaimInput,
  ) {
    const authorizationCount = await client.query<{ count: string }>(
      `SELECT COUNT(*)::bigint AS count
         FROM issue255_live_generation_authorizations`,
    );
    if (Number(authorizationCount.rows[0]?.count ?? 0) >= 3) {
      throw new Error(
        'Issue 255 permits exactly three billable generation POSTs globally.',
      );
    }
    const runBudget = await client.query<{ amount_micros: string }>(
      `SELECT (
         COALESCE((
           SELECT SUM(reserved_amount_micros)
             FROM issue255_live_generation_authorizations
            WHERE run_nonce = $1
         ), 0) +
         COALESCE((
           SELECT SUM(receipt.reserved_amount_micros)
             FROM issue255_live_generation_receipts receipt
            WHERE receipt.run_nonce = $1
              AND NOT EXISTS (
                SELECT 1
                  FROM issue255_live_generation_authorizations history
                 WHERE history.effect_id = receipt.effect_id
              )
         ), 0)
       )::bigint AS amount_micros`,
      [input.runNonce],
    );
    const globalBudget = await client.query<{ amount_micros: string }>(
      `SELECT (
         COALESCE((
           SELECT SUM(reserved_amount_micros)
             FROM issue255_live_generation_authorizations
         ), 0) +
         COALESCE((
           SELECT SUM(receipt.reserved_amount_micros)
             FROM issue255_live_generation_receipts receipt
            WHERE NOT EXISTS (
              SELECT 1
                FROM issue255_live_generation_authorizations history
               WHERE history.effect_id = receipt.effect_id
            )
         ), 0)
       )::bigint AS amount_micros`,
    );
    const nextRunAmount =
      Number(runBudget.rows[0]?.amount_micros ?? 0) +
      input.reservedAmountMicros;
    const nextGlobalAmount =
      Number(globalBudget.rows[0]?.amount_micros ?? 0) +
      input.reservedAmountMicros;
    if (nextRunAmount > 3_600_000 || nextGlobalAmount > 5_000_000) {
      throw new Error(
        'Issue 255 live reservation exceeds the approved run or global cost cap.',
      );
    }
  }

  private async locked<Result>(
    runNonce: string,
    operation: (client: PoolClient) => Promise<Result>,
  ) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        ['issue255-live-global-v1'],
      );
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtext($1))',
        [createHash('sha256').update(runNonce).digest('hex')],
      );
      const result = await operation(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

async function readDurableTerminalLineage(
  receipt: ReceiptRow,
  providerLedger: Issue255ProviderLedgerReader,
): Promise<Issue255DurableTerminalLineage> {
  if (
    !receipt.provider_job_id ||
    !receipt.provider_attempt_id ||
    !receipt.provider_cost_event_id
  ) {
    throw new Error(
      'Issue 255 receipt has no frozen provider lineage identifiers.',
    );
  }
  const [attempt, job, costs] = await Promise.all([
    providerLedger.getProviderAttempt(
      receipt.workspace_id,
      receipt.provider_attempt_id,
    ),
    providerLedger.getGenerationJob(
      receipt.workspace_id,
      receipt.provider_job_id,
    ),
    providerLedger.listProviderCosts(
      receipt.workspace_id,
      receipt.provider_attempt_id,
    ),
  ]);
  if (
    !attempt ||
    attempt.jobId !== receipt.provider_job_id ||
    attempt.deploymentId !== receipt.deployment_id ||
    attempt.acceptance !== 'accepted' ||
    attempt.status !== 'completed' ||
    !attempt.providerTaskRef
  ) {
    throw new Error(
      'Issue 255 durable ProviderAttempt is not an accepted terminal.',
    );
  }
  if (!job || job.status !== 'completed' || !job.result) {
    throw new Error(
      'Issue 255 durable generation job has no completed result.',
    );
  }
  const result = z
    .object({
      status: z.literal('completed'),
      issue255: z
        .object({
          workspaceId: z.string().trim().min(1),
          effectId: z.string().regex(/^[a-f0-9]{64}$/u),
          requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
          adapter: z.enum(['direct-copy', 'tuzi-image', 'tuzi-video']),
          deploymentId: z.string().trim().min(1),
          providerIdempotencyKey: z.string().trim().min(1),
          providerJobId: z.string().trim().min(1),
          providerAttemptId: z.string().trim().min(1),
          providerCostEventId: z.string().trim().min(1),
        })
        .strict(),
      attempt: z
        .object({
          id: z.string().trim().min(1),
          deploymentId: z.string().trim().min(1),
          providerTaskRef: z.string().trim().min(1),
        })
        .passthrough(),
      providerCost: z
        .object({
          id: z.string().trim().min(1),
          status: z.literal('observed'),
          amountMicros: z.number().int().positive(),
          currency: z.literal('CNY'),
          usage: z
            .object({
              inputTokens: z.number().int().nonnegative().optional(),
              outputTokens: z.number().int().nonnegative().optional(),
              mediaUnits: z.number().int().nonnegative().optional(),
            })
            .strict()
            .refine((usage) => Object.keys(usage).length > 0),
        })
        .strict(),
      snapshot: z
        .object({
          priceRevision: z.string().trim().min(1).optional(),
          allowedCandidates: z
            .array(
              z
                .object({
                  deploymentId: z.string().trim().min(1),
                  priceRevision: z.string().trim().min(1),
                })
                .passthrough(),
            )
            .optional(),
        })
        .passthrough(),
    })
    .passthrough()
    .parse(job.result);
  if (
    result.issue255.workspaceId !== receipt.workspace_id ||
    result.issue255.effectId !== receipt.effect_id ||
    result.issue255.requestFingerprint !== receipt.request_fingerprint ||
    result.issue255.adapter !== receipt.adapter ||
    result.issue255.deploymentId !== receipt.deployment_id ||
    result.issue255.providerIdempotencyKey !==
      receipt.provider_idempotency_key ||
    result.issue255.providerJobId !== receipt.provider_job_id ||
    result.issue255.providerAttemptId !== receipt.provider_attempt_id ||
    result.issue255.providerCostEventId !== receipt.provider_cost_event_id ||
    result.attempt.id !== attempt.id ||
    result.attempt.deploymentId !== attempt.deploymentId ||
    result.attempt.providerTaskRef !== attempt.providerTaskRef ||
    result.providerCost.id !== receipt.provider_cost_event_id
  ) {
    throw new Error(
      'Issue 255 durable result does not bind the frozen provider lineage.',
    );
  }
  const cost = costs.find(
    (candidate) =>
      candidate.id === receipt.provider_cost_event_id &&
      (candidate.stage === 'observed' ||
        candidate.stage === 'reconciled'),
  );
  const actualAmountMicros = result.providerCost.amountMicros;
  if (
    !cost ||
    cost.attemptId !== attempt.id ||
    cost.currency !== 'CNY' ||
    cost.amountMicros !== actualAmountMicros ||
    cost.billingStatus !== 'known'
  ) {
    throw new Error(
      'Issue 255 durable ProviderCost event is missing or inconsistent.',
    );
  }
  const priceRevision =
    result.snapshot.allowedCandidates?.find(
      (candidate) => candidate.deploymentId === attempt.deploymentId,
    )?.priceRevision ?? result.snapshot.priceRevision;
  if (
    priceRevision !== receipt.price_revision ||
    receipt.exchange_revision !== 'native-cny-v1'
  ) {
    throw new Error(
      'Issue 255 durable ProviderCost revision does not match the frozen quote.',
    );
  }
  return durableTerminalLineageSchema.parse({
    workspaceId: receipt.workspace_id,
    effectId: receipt.effect_id,
    requestFingerprint: receipt.request_fingerprint,
    adapter: receipt.adapter,
    deploymentId: receipt.deployment_id,
    providerIdempotencyKey: receipt.provider_idempotency_key,
    attempt: {
      id: attempt.id,
      jobId: attempt.jobId,
      deploymentId: attempt.deploymentId,
      providerTaskRef: attempt.providerTaskRef,
      acceptance: attempt.acceptance,
      status: attempt.status,
    },
    providerCost: {
      id: cost.id,
      attemptId: cost.attemptId,
      amountMicros: actualAmountMicros,
      currency: cost.currency,
      priceRevision,
      exchangeRevision: receipt.exchange_revision,
      stage: cost.stage,
      usage: result.providerCost.usage,
    },
  });
}

function assertStableEffectIdentity(input: Issue255LiveReceiptClaimInput) {
  const expected = createHash('sha256')
    .update(`issue255/v1\0${input.runNonce}\0${input.modality}`)
    .digest('hex');
  if (input.effectId !== expected) {
    throw new Error(
      'Issue 255 effect id does not match its stable run and modality identity.',
    );
  }
}

function receiptFromRow(row: ReceiptRow): Issue255LiveReceipt {
  return {
    workspaceId: row.workspace_id,
    runNonce: row.run_nonce,
    modality: row.modality,
    effectId: row.effect_id,
    requestFingerprint: row.request_fingerprint,
    adapter: row.adapter,
    deploymentId: row.deployment_id,
    providerIdempotencyKey: row.provider_idempotency_key,
    providerJobId: row.provider_job_id,
    providerAttemptId: row.provider_attempt_id,
    providerCostEventId: row.provider_cost_event_id,
    recordedMatrixDigest: row.recorded_matrix_digest,
    reservedAmountMicros: Number(row.reserved_amount_micros),
    priceRevision: row.price_revision,
    exchangeRevision: row.exchange_revision,
    status: row.status,
    generationSubmitCount: row.generation_submit_count,
    providerHttpRequestCount: row.provider_http_request_count,
    actualAmountMicros:
      row.actual_amount_micros === null
        ? null
        : Number(row.actual_amount_micros),
    terminalLineage:
      row.terminal_lineage === null
        ? null
        : durableTerminalLineageSchema.parse(row.terminal_lineage),
    reconciliationReason: row.reconciliation_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}
