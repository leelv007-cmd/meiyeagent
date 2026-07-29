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
    effectId: z.string().regex(/^[a-f0-9]{64}$/u),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
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
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS issue255_live_generation_receipts (
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
    await this.pool.query(`
      ALTER TABLE issue255_live_generation_receipts
      ADD COLUMN IF NOT EXISTS reconciliation_reason text
    `);
    await this.pool.query(`
      ALTER TABLE issue255_live_generation_receipts
        ADD COLUMN IF NOT EXISTS provider_job_id text,
        ADD COLUMN IF NOT EXISTS provider_attempt_id text,
        ADD COLUMN IF NOT EXISTS provider_cost_event_id text,
        ADD COLUMN IF NOT EXISTS provider_http_request_count integer NOT NULL DEFAULT 0
    `);
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
          'Issue 255 claimed receipt could not be marked unknown.',
        );
      }
      return receiptFromRow(row);
    });
  }

  async claimGenerationPost(input: {
    runNonce: string;
    modality: (typeof modalities)[number];
    effectId: string;
    requestFingerprint: string;
  }) {
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
      const submissionCounts = await client.query<{
        global_count: string;
        run_count: string;
      }>(
        `SELECT
           COUNT(*) FILTER (
             WHERE generation_submit_count = 1
           )::bigint AS global_count,
           COUNT(*) FILTER (
             WHERE run_nonce = $1 AND generation_submit_count = 1
           )::bigint AS run_count
         FROM issue255_live_generation_receipts`,
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
            AND status = 'claimed'
            AND generation_submit_count = 0
        RETURNING *`,
        [
          parsed.runNonce,
          parsed.modality,
          parsed.effectId,
          parsed.requestFingerprint,
        ],
      );
      const row = updated.rows[0];
      if (!row) {
        throw new Error(
          'Issue 255 generation POST is already fenced or the receipt requires reconciliation.',
        );
      }
      return receiptFromRow(row);
    });
  }

  async recordProviderHttpRequest(input: {
    runNonce: string;
    modality: (typeof modalities)[number];
    effectId: string;
    requestFingerprint: string;
  }) {
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
      const updated = await client.query<ReceiptRow>(
        `UPDATE issue255_live_generation_receipts
            SET provider_http_request_count = provider_http_request_count + 1,
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
      workspaceId: string;
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
      workspaceId: string;
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
           $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14,
           'claimed'
         )
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [
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
          'Issue 255 generation effect conflicts with an existing receipt and requires reconciliation.',
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
      workspaceId: string;
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
        workspaceId: z.string().trim().min(1),
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
        parsed.workspaceId,
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
    const [runBudget, globalBudget] = await Promise.all([
      client.query<{ amount_micros: string }>(
        `SELECT COALESCE(SUM(
           CASE
             WHEN status = 'completed'
               THEN COALESCE(actual_amount_micros, reserved_amount_micros)
             ELSE reserved_amount_micros
           END
         ), 0)::bigint AS amount_micros
           FROM issue255_live_generation_receipts
          WHERE run_nonce = $1`,
        [input.runNonce],
      ),
      client.query<{ amount_micros: string }>(
        `SELECT COALESCE(SUM(
           CASE
             WHEN status = 'completed'
               THEN COALESCE(actual_amount_micros, reserved_amount_micros)
             ELSE reserved_amount_micros
           END
         ), 0)::bigint AS amount_micros
           FROM issue255_live_generation_receipts`,
      ),
    ]);
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
  workspaceId: string,
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
      workspaceId,
      receipt.provider_attempt_id,
    ),
    providerLedger.getGenerationJob(workspaceId, receipt.provider_job_id),
    providerLedger.listProviderCosts(
      workspaceId,
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
          amount: z.number().finite().positive(),
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
  const actualAmountMicros = Math.round(
    result.providerCost.amount * 1_000_000,
  );
  if (
    !cost ||
    cost.attemptId !== attempt.id ||
    cost.currency !== 'CNY' ||
    cost.amountMicros !== actualAmountMicros ||
    cost.billingStatus === 'unknown'
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
    effectId: receipt.effect_id,
    requestFingerprint: receipt.request_fingerprint,
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
