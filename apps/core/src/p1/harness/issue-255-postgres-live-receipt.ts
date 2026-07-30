import { createHash } from 'node:crypto';

import type { Pool, PoolClient, QueryResultRow } from 'pg';
import { z } from 'zod';

import type { FoundationStore } from '../foundation/ports.js';

const modalities = ['copy', 'image_text', 'video'] as const;
const legacyRejectedRunNonce =
  'issue-255-live-anchors-2026-07-30-v1';
const legacyRejectedEffectId =
  'f59700fea85015b990436228219b997beea48d9bbee040c29691f2406a4b3ed3';
const legacyRejectedRequestFingerprint =
  '5a6b64ab43bf5fcc8ac2f2a466d8e04bc86af5f779a17210c6a448c07e6c46ed';
const legacyRejectedWorkspaceId =
  'issue-255-live-fd117da50a1e2d3d15ac5976';
const legacyRejectedEvidenceCommit =
  '695489fe441178431394bb320ad779b28cb9f654';
const legacyImageRunNonce = 'issue-255-live-anchors-2026-07-30-v2';
const coordinatorV3 = {
  runNonce: 'issue-255-live-anchors-2026-07-30-v3',
  workspaceId: 'issue-255-live-0e36ff28fe9e880c0ecaf7b9',
  effectId:
    '9f5146a3fd01dd7c869569359677c74b7ac3700e8ad76e2fea729adf340425a1',
  requestFingerprint:
    '2e188777d687cf14e893a66e8d4f5476ea6858ee024b13ea0d2f27a5d75cf444',
  providerJobId: 'issue-255-job-9f5146a3fd01dd7c869569359677c74b',
  providerAttemptId:
    'issue-255-attempt-9f5146a3fd01dd7c869569359677',
  providerCostEventId:
    'issue-255-cost-9f5146a3fd01dd7c869569359677',
} as const;
const coordinatorV5RunNonce =
  'issue-255-live-anchors-2026-07-30-v5';
const legacyImageEffectId =
  'd2ccabe63b58ece3404bd27a36e8b811c5b6bf19c80e5f57b005bf7f5351f98e';
const legacyImageRequestFingerprint =
  '55a81ab1ca94a0a041de4a273c45adcdab861c690d7a40b3481e03019e9c6c17';
const legacyImageWorkspaceId = 'issue-255-live-1165ded3ff521938de15da91';
const legacyImagePriceRevision =
  'seedream-4-5:channel-tuzi-seedream-4-5-relay:standard:price-v1';
const legacyImageCommentId = 5130611933;
const legacyImageAmountMicros = 50_000;
const modalityCapMicros = {
  copy: 100_000,
  image_text: 500_000,
  video: 1_620_000,
} as const;
// v5 envelope by coordinator 2026-07-31.
const GLOBAL_BILLABLE_AUTHORIZATION_CAP = 6;

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
  providerTaskId: string | null;
  providerAttemptId: string;
  providerCostEventId: string;
  recordedMatrixDigest: string;
  reservedAmountMicros: number;
  priceRevision: string;
  exchangeRevision: string;
  status: 'claimed' | 'unknown' | 'completed' | 'failed_before_billing';
  generationSubmitCount: number;
  providerHttpRequestCount: number;
  actualAmountMicros: number | null;
  failureErrorCode: string | null;
  failureErrorMessage: string | null;
  providerHttpStatus: number | null;
  terminalLineage:
    | Issue255DurableTerminalLineage
    | Issue255PriceCardReconciledImageLineage
    | Issue255PriceCardReconciledVideoLineage
    | Issue255FailedBeforeBillingLineage
    | null;
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
  provider_task_id: string | null;
  provider_attempt_id: string;
  provider_cost_event_id: string;
  recorded_matrix_digest: string;
  reserved_amount_micros: string;
  price_revision: string;
  exchange_revision: string;
  status: 'claimed' | 'unknown' | 'completed' | 'failed_before_billing';
  generation_submit_count: number;
  provider_http_request_count: number;
  actual_amount_micros: string | null;
  failure_error_code: string | null;
  failure_error_message: string | null;
  provider_http_status: number | null;
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
        usageEvidenceKind: z
          .enum(['provider_reported', 'response_derived'])
          .default('provider_reported'),
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

const priceCardReconciledImageLineageSchema = z
  .object({
    workspaceId: z.literal(legacyImageWorkspaceId),
    effectId: z.literal(legacyImageEffectId),
    requestFingerprint: z.literal(legacyImageRequestFingerprint),
    adapter: z.literal('tuzi-image'),
    deploymentId: z.literal('seedream-4-5-tuzi-relay'),
    providerIdempotencyKey: z.literal(legacyImageEffectId),
    attempt: z
      .object({
        id: z.literal(`issue-255-attempt-${legacyImageEffectId.slice(0, 28)}`),
        jobId: z.literal(`issue-255-job-${legacyImageEffectId.slice(0, 32)}`),
        deploymentId: z.literal('seedream-4-5-tuzi-relay'),
        acceptance: z.literal('accepted'),
        status: z.literal('completed'),
        providerTaskRefMissing: z.literal(true),
      })
      .strict(),
    providerCost: z
      .object({
        id: z.literal(`issue-255-cost-${legacyImageEffectId.slice(0, 28)}`),
        attemptId: z.literal(
          `issue-255-attempt-${legacyImageEffectId.slice(0, 28)}`,
        ),
        amountMicros: z.literal(legacyImageAmountMicros),
        currency: z.literal('CNY'),
        priceRevision: z.literal(legacyImagePriceRevision),
        exchangeRevision: z.literal('native-cny-v1'),
        stage: z.literal('reconciled'),
        usageEvidenceKind: z.literal('price_card_reconciled'),
        usage: z.object({ mediaUnits: z.literal(1) }).strict(),
      })
      .strict(),
    reconciliation: z
      .object({
        kind: z.literal('controller_issue_comment'),
        issue: z.literal(255),
        commentId: z.literal(legacyImageCommentId),
        reason: z.literal('accepted_image_task_ref_not_persisted'),
      })
      .strict(),
    observedWallClockMs: z.number().int().positive(),
  })
  .strict();

export type Issue255PriceCardReconciledImageLineage = z.infer<
  typeof priceCardReconciledImageLineageSchema
>;

const priceCardReconciledVideoLineageSchema = z
  .object({
    workspaceId: z.string().trim().min(1),
    effectId: z.string().regex(/^[a-f0-9]{64}$/u),
    requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
    adapter: z.literal('tuzi-video'),
    deploymentId: z.literal('seedance-1-5-pro-tuzi-relay'),
    providerIdempotencyKey: z.string().trim().min(1),
    providerTaskIdHash: z.string().regex(/^[a-f0-9]{64}$/u),
    attempt: z
      .object({
        id: z.string().trim().min(1),
        jobId: z.string().trim().min(1),
        deploymentId: z.literal('seedance-1-5-pro-tuzi-relay'),
        providerTaskRef: z.string().trim().min(1),
        acceptance: z.literal('accepted'),
        status: z.literal('completed'),
      })
      .strict(),
    providerCost: z
      .object({
        id: z.string().trim().min(1),
        attemptId: z.string().trim().min(1),
        amountMicros: z.literal(1_620_000),
        currency: z.literal('CNY'),
        priceRevision: z.string().trim().min(1),
        exchangeRevision: z.literal('native-cny-v1'),
        stage: z.literal('reconciled'),
        usageEvidenceKind: z.literal('price_card_reconciled'),
        usage: z.object({ mediaUnits: z.literal(1) }).strict(),
      })
      .strict(),
    recovery: z
      .object({
        reason: z.literal('relay_completed_without_per_task_usage'),
        providerStatusSequence: z.tuple([
          z.literal('unknown'),
          z.literal('completed'),
        ]),
        normalizedStatusSequence: z.tuple([
          z.literal('queued'),
          z.literal('completed'),
        ]),
        providerCreatedAtEpochSeconds: z.number().int().nonnegative(),
        providerSignedUrlTimestamp: z.string().regex(/^\d{8}T\d{6}Z$/u),
        wallClockUpperBoundMs: z.number().int().positive(),
        contentType: z.literal('video/mp4'),
        contentByteCount: z.number().int().positive(),
        contentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict(),
  })
  .strict();

export type Issue255PriceCardReconciledVideoLineage = z.infer<
  typeof priceCardReconciledVideoLineageSchema
>;

const failedBeforeBillingProvenanceSchema = z.union([
  z
    .object({
      kind: z.literal('merge_ledger'),
      commitSha: z.literal(legacyRejectedEvidenceCommit),
    })
    .strict(),
  z
    .object({
      kind: z.literal('durable_provider_http'),
      httpStatus: z.literal(451),
      upstreamStatus: z.literal(400),
      errorCode: z.literal('invalid_request'),
      messageSha256: z.string().regex(/^[a-f0-9]{64}$/u),
    })
    .strict(),
]);

const failedBeforeBillingLineageSchema = z
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
        acceptance: z.literal('rejected_before_accept'),
        status: z.literal('failed'),
      })
      .strict(),
    failure: z
      .object({
        reason: z.literal('provider_rejected_before_accept'),
        source: z.literal('provider_execution_terminal'),
        provenance: failedBeforeBillingProvenanceSchema,
      })
      .strict(),
    providerCost: z
      .object({
        eventCount: z.number().int().nonnegative(),
        amountMicros: z.literal(0),
        currency: z.literal('CNY'),
      })
      .strict(),
  })
  .strict();

export type Issue255FailedBeforeBillingLineage = z.infer<
  typeof failedBeforeBillingLineageSchema
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
        provider_task_id text,
        provider_attempt_id text NOT NULL,
        provider_cost_event_id text NOT NULL,
        recorded_matrix_digest text NOT NULL,
        reserved_amount_micros bigint NOT NULL
          CHECK (reserved_amount_micros > 0),
        price_revision text NOT NULL,
        exchange_revision text NOT NULL,
        status text NOT NULL
          CHECK (status IN ('claimed', 'unknown', 'completed', 'failed_before_billing')),
        generation_submit_count integer NOT NULL DEFAULT 0
          CHECK (generation_submit_count BETWEEN 0 AND 1),
        provider_http_request_count integer NOT NULL DEFAULT 0
          CHECK (provider_http_request_count >= 0),
        actual_amount_micros bigint,
        failure_error_code text,
        failure_error_message text,
        provider_http_status integer
          CHECK (provider_http_status BETWEEN 100 AND 599),
        terminal_lineage jsonb,
        reconciliation_reason text,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (run_nonce, modality)
      )
      `);
      await client.query(`
      ALTER TABLE issue255_live_generation_receipts
        ADD COLUMN IF NOT EXISTS reconciliation_reason text,
        ADD COLUMN IF NOT EXISTS failure_error_code text,
        ADD COLUMN IF NOT EXISTS failure_error_message text,
        ADD COLUMN IF NOT EXISTS provider_http_status integer
      `);
      await client.query(`
      ALTER TABLE issue255_live_generation_receipts
        DROP CONSTRAINT IF EXISTS issue255_live_generation_receipts_provider_http_status_check,
        ADD CONSTRAINT issue255_live_generation_receipts_provider_http_status_check
          CHECK (provider_http_status BETWEEN 100 AND 599)
      `);
      await client.query(`
      ALTER TABLE issue255_live_generation_receipts
        DROP CONSTRAINT IF EXISTS issue255_live_generation_receipts_status_check,
        ADD CONSTRAINT issue255_live_generation_receipts_status_check
          CHECK (status IN ('claimed', 'unknown', 'completed', 'failed_before_billing'))
      `);
      await client.query(`
      ALTER TABLE issue255_live_generation_receipts
        ADD COLUMN IF NOT EXISTS workspace_id text,
        ADD COLUMN IF NOT EXISTS provider_job_id text,
        ADD COLUMN IF NOT EXISTS provider_task_id text,
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
          status text NOT NULL DEFAULT 'billable'
            CHECK (status IN ('billable', 'failed_before_billing')),
          disposition_reason text,
          terminal_lineage jsonb,
          evidence_sample_digest text,
          evidence_envelope_digest text,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (run_nonce, modality)
        )
      `);
      await client.query(`
        ALTER TABLE issue255_live_generation_authorizations
          ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'billable',
          ADD COLUMN IF NOT EXISTS disposition_reason text,
          ADD COLUMN IF NOT EXISTS terminal_lineage jsonb,
          ADD COLUMN IF NOT EXISTS evidence_sample_digest text,
          ADD COLUMN IF NOT EXISTS evidence_envelope_digest text
      `);
      await client.query(`
        ALTER TABLE issue255_live_generation_authorizations
          DROP CONSTRAINT IF EXISTS issue255_live_generation_authorizations_status_check,
          ADD CONSTRAINT issue255_live_generation_authorizations_status_check
            CHECK (status IN ('billable', 'failed_before_billing')),
          DROP CONSTRAINT IF EXISTS issue255_live_generation_authorizations_disposition_check,
          ADD CONSTRAINT issue255_live_generation_authorizations_disposition_check
            CHECK (
              (status = 'billable' AND disposition_reason IS NULL AND terminal_lineage IS NULL)
              OR
              (status = 'failed_before_billing'
                AND disposition_reason = 'provider_rejected_before_accept'
                AND terminal_lineage IS NOT NULL)
            )
      `);
      await client.query(`
        CREATE TABLE IF NOT EXISTS issue255_live_run_owners (
          singleton_key boolean PRIMARY KEY DEFAULT true
            CHECK (singleton_key),
          run_nonce text NOT NULL UNIQUE,
          created_at timestamptz NOT NULL DEFAULT now()
        )
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

  async claimFreshLiveRunOwner(runNonce: string) {
    const parsedRunNonce = z.string().trim().min(1).parse(runNonce);
    return this.locked(
      'issue255-live-run-owner-v1',
      async (client) => {
        const result = await client.query<{
          active_receipt_count: string;
          billable_count: string;
        }>(
          `SELECT
             (SELECT COUNT(*)
                FROM issue255_live_generation_authorizations
               WHERE status <> 'failed_before_billing')::bigint AS billable_count,
             (SELECT COUNT(*)
                FROM issue255_live_generation_receipts
               WHERE status <> 'failed_before_billing')::bigint AS active_receipt_count`,
        );
        if (
          Number(result.rows[0]?.billable_count ?? 0) !== 0 ||
          Number(result.rows[0]?.active_receipt_count ?? 0) !== 0
        ) {
          throw new Error(
            'Issue 255 live collector requires no unresolved billable history before starting.',
          );
        }
        const owner = await client.query(
          `INSERT INTO issue255_live_run_owners (
             singleton_key,
             run_nonce
           )
           VALUES (true, $1)
           ON CONFLICT (singleton_key) DO UPDATE
             SET run_nonce = EXCLUDED.run_nonce,
                 created_at = now()
           RETURNING run_nonce`,
          [parsedRunNonce],
        );
        if (!owner.rows[0]) {
          throw new Error(
            'Issue 255 live run owner is already durably claimed.',
          );
        }
      },
    );
  }

  async claimOrResumeLiveRunOwner(runNonce: string) {
    const parsedRunNonce = z.string().trim().min(1).parse(runNonce);
    return this.locked(
      'issue255-live-run-owner-v1',
      async (client): Promise<'fresh' | 'resumed'> => {
        const isCoordinatorV5Retry = parsedRunNonce === coordinatorV5RunNonce;
        const existingOwner = await client.query<{ run_nonce: string }>(
          `SELECT run_nonce
             FROM issue255_live_run_owners
            WHERE singleton_key = true
            FOR UPDATE`,
        );
        if (existingOwner.rows[0]) {
          if (existingOwner.rows[0].run_nonce !== parsedRunNonce) {
            if (!isCoordinatorV5Retry) {
              throw new Error('Issue 255 live run owner is already durably claimed.');
            }
            await client.query(
              `UPDATE issue255_live_run_owners
                  SET run_nonce = $1,
                      created_at = now()
                WHERE singleton_key = true`,
              [parsedRunNonce],
            );
            return 'fresh';
          }
          if (isCoordinatorV5Retry) return 'resumed';
          const foreignHistory = await client.query<{ count: string }>(
            `SELECT (
               (SELECT COUNT(*)
                  FROM issue255_live_generation_authorizations
                 WHERE run_nonce <> $1
                   AND status <> 'failed_before_billing') +
               (SELECT COUNT(*)
                  FROM issue255_live_generation_receipts
                 WHERE run_nonce <> $1
                   AND status <> 'failed_before_billing')
             )::bigint AS count`,
            [parsedRunNonce],
          );
          if (Number(foreignHistory.rows[0]?.count ?? 0) !== 0) {
            throw new Error(
              'Issue 255 live collector cannot resume beside other billable history.',
            );
          }
          return 'resumed';
        }
        const result = await client.query<{
          active_receipt_count: string;
          billable_count: string;
        }>(
          `SELECT
             (SELECT COUNT(*)
                FROM issue255_live_generation_authorizations
               WHERE status <> 'failed_before_billing')::bigint AS billable_count,
             (SELECT COUNT(*)
                FROM issue255_live_generation_receipts
               WHERE status <> 'failed_before_billing')::bigint AS active_receipt_count`,
        );
        if (
          !isCoordinatorV5Retry &&
          (Number(result.rows[0]?.billable_count ?? 0) !== 0 ||
            Number(result.rows[0]?.active_receipt_count ?? 0) !== 0)
        ) {
          throw new Error(
            'Issue 255 live collector requires no unresolved billable history before starting.',
          );
        }
        const owner = await client.query<{ run_nonce: string }>(
          `INSERT INTO issue255_live_run_owners (
             singleton_key,
             run_nonce
           ) VALUES (true, $1)
           ON CONFLICT (singleton_key) DO NOTHING
           RETURNING run_nonce`,
          [parsedRunNonce],
        );
        if (!owner.rows[0]) {
          throw new Error('Issue 255 live run owner is already durably claimed.');
        }
        return 'fresh';
      },
    );
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
          .min(1)
          .max(3)
          .refine(
            (samples) =>
              new Set(samples.map(({ effectId }) => effectId)).size ===
              samples.length,
            'Issue 255 manifest evidence requires unique effects.',
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
        completed.rows.length !== parsed.samples.length ||
        parsed.samples.some(
          (sample) =>
            !completed.rows.some(
              ({ effect_id }) => effect_id === sample.effectId,
            ),
        )
      ) {
        throw new Error(
          'Issue 255 manifest evidence requires every completed durable receipt.',
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
                failure_error_code = 'provider_acceptance_unknown',
                failure_error_message =
                  'Provider acceptance remains unknown.',
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
    errorCode: string;
    errorMessage: string;
  }): Promise<
    | { kind: 'rejected_before_accept' }
    | {
        kind: 'provider_acceptance_unknown' | 'provider_failure_recorded';
        receipt: Issue255LiveReceipt;
      }
  > {
    const parsed = z
      .object({
        runNonce: z.string().trim().min(1),
        modality: z.enum(modalities),
        effectId: z.string().regex(/^[a-f0-9]{64}$/u),
        requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
        errorCode: z.string().trim().min(1),
        errorMessage: z.string().trim().min(1),
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
      const errorCode = sanitizeFailureCode(parsed.errorCode);
      const errorMessage = sanitizeFailureMessage(parsed.errorMessage);
      const failureKind =
        row.provider_http_status !== null ||
        errorCode !== 'collector_execution_error'
          ? 'provider_failure_recorded'
          : 'provider_acceptance_unknown';
      const updated = await client.query<ReceiptRow>(
        `UPDATE issue255_live_generation_receipts
            SET status = 'unknown',
                reconciliation_reason = $5,
                failure_error_code = $6,
                failure_error_message = $7,
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
          failureKind,
          errorCode,
          errorMessage,
        ],
      );
      const unknown = updated.rows[0];
      if (!unknown) {
        throw new Error(
          'Issue 255 submitted receipt could not be frozen for reconciliation.',
        );
      }
      return {
        kind: failureKind,
        receipt: receiptFromRow(unknown),
      };
    });
  }

  async bindAcceptedProviderTask(input: {
    runNonce: string;
    modality: (typeof modalities)[number];
    effectId: string;
    requestFingerprint: string;
    providerTaskId: string;
  }) {
    const parsed = z
      .object({
        runNonce: z.string().trim().min(1),
        modality: z.enum(modalities),
        effectId: z.string().regex(/^[a-f0-9]{64}$/u),
        requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
        providerTaskId: z
          .string()
          .trim()
          .min(1)
          .max(512)
          .regex(/^[^\u0000-\u001f\u007f]+$/u),
      })
      .strict()
      .parse(input);
    return this.locked(parsed.runNonce, async (client) => {
      const updated = await client.query<ReceiptRow>(
        `UPDATE issue255_live_generation_receipts
            SET provider_task_id = $5,
                updated_at = now()
          WHERE run_nonce = $1
            AND modality = $2
            AND effect_id = $3
            AND request_fingerprint = $4
            AND status = 'claimed'
            AND generation_submit_count = 1
            AND (provider_task_id IS NULL OR provider_task_id = $5)
        RETURNING *`,
        [
          parsed.runNonce,
          parsed.modality,
          parsed.effectId,
          parsed.requestFingerprint,
          parsed.providerTaskId,
        ],
      );
      const row = updated.rows[0];
      if (!row) {
        throw new Error(
          'Issue 255 accepted provider task id is immutable or its submitted receipt is unavailable.',
        );
      }
      return receiptFromRow(row);
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
           COUNT(*) FILTER (WHERE status <> 'failed_before_billing')::bigint
             AS global_count,
           COUNT(*) FILTER (
             WHERE run_nonce = $1 AND status <> 'failed_before_billing'
           )::bigint AS run_count
         FROM issue255_live_generation_authorizations`,
        [parsed.runNonce],
      );
      if (
        Number(submissionCounts.rows[0]?.global_count ?? 0) >=
        GLOBAL_BILLABLE_AUTHORIZATION_CAP
      ) {
        throw new Error(
          'Issue 255 permits exactly six billable generation POSTs globally.',
        );
      }
      if (Number(submissionCounts.rows[0]?.run_count ?? 0) >= 3) {
        throw new Error(
          'Issue 255 permits exactly three billable generation POSTs per run.',
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
            AND status IN ('claimed', 'unknown')
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

  async recordProviderHttpResponse(input: {
    adapter: 'direct-copy' | 'tuzi-image' | 'tuzi-video';
    deploymentId: string;
    runNonce: string;
    modality: (typeof modalities)[number];
    effectId: string;
    providerIdempotencyKey: string;
    requestFingerprint: string;
    httpStatus: number;
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
        httpStatus: z.number().int().min(100).max(599),
      })
      .strict()
      .parse(input);
    return this.locked(parsed.runNonce, async (client) => {
      const updated = await client.query<ReceiptRow>(
        `UPDATE issue255_live_generation_receipts
            SET provider_http_status = $8,
                updated_at = now()
          WHERE run_nonce = $1
            AND modality = $2
            AND effect_id = $3
            AND request_fingerprint = $4
            AND adapter = $5
            AND deployment_id = $6
            AND provider_idempotency_key = $7
            AND status IN ('claimed', 'unknown')
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
          parsed.httpStatus,
        ],
      );
      const row = updated.rows[0];
      if (!row) {
        throw new Error(
          'Issue 255 provider HTTP response is outside its claimed generation effect.',
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

  async migrateLegacyRejectedBeforeBillingV1() {
    return this.locked(legacyRejectedRunNonce, async (client) => {
      const selected = await client.query<ReceiptRow>(
        `SELECT *
           FROM issue255_live_generation_receipts
          WHERE run_nonce = $1
            AND modality = 'copy'
            AND effect_id = $2
            AND request_fingerprint = $3
            AND workspace_id = $4
            AND adapter = 'direct-copy'
            AND deployment_id = 'deepseek-v4-pro-direct'
            AND provider_idempotency_key = $2
            AND provider_job_id = $5
            AND provider_attempt_id = $6
            AND provider_cost_event_id = $7
            AND status = 'unknown'
            AND generation_submit_count = 1
            AND provider_http_request_count = 1
          FOR UPDATE`,
        [
          legacyRejectedRunNonce,
          legacyRejectedEffectId,
          legacyRejectedRequestFingerprint,
          legacyRejectedWorkspaceId,
          `issue-255-job-${legacyRejectedEffectId.slice(0, 32)}`,
          `issue-255-attempt-${legacyRejectedEffectId.slice(0, 28)}`,
          `issue-255-cost-${legacyRejectedEffectId.slice(0, 28)}`,
        ],
      );
      const receipt = selected.rows[0];
      if (!receipt) {
        throw new Error(
          'Issue 255 legacy rejection migration does not match the frozen v1 lineage.',
        );
      }
      const costs = await client.query<{ count: string }>(
        `SELECT COUNT(*)::bigint AS count
           FROM p1_provider_cost_events
          WHERE workspace_id = $1
            AND attempt_id = $2`,
        [receipt.workspace_id, receipt.provider_attempt_id],
      );
      if (Number(costs.rows[0]?.count ?? 0) !== 0) {
        throw new Error(
          'Issue 255 legacy rejection migration requires zero durable provider cost.',
        );
      }
      const attempt = await client.query<{
        id: string;
      }>(
        `UPDATE p1_provider_attempts
            SET acceptance = 'rejected_before_accept',
                status = 'failed',
                updated_at = now()
          WHERE workspace_id = $1
            AND id = $2
            AND job_id = $3
            AND deployment_id = $4
            AND acceptance = 'pending'
            AND status = 'pending'
        RETURNING id`,
        [
          receipt.workspace_id,
          receipt.provider_attempt_id,
          receipt.provider_job_id,
          receipt.deployment_id,
        ],
      );
      const result = {
        status: 'failed',
        issue255: {
          workspaceId: receipt.workspace_id,
          effectId: receipt.effect_id,
          requestFingerprint: receipt.request_fingerprint,
          adapter: receipt.adapter,
          deploymentId: receipt.deployment_id,
          providerIdempotencyKey: receipt.provider_idempotency_key,
          providerJobId: receipt.provider_job_id,
          providerAttemptId: receipt.provider_attempt_id,
          providerCostEventId: receipt.provider_cost_event_id,
        },
        failure: {
          acceptance: 'rejected_before_accept',
          reason: 'provider_rejected_before_accept',
          source: 'provider_execution_terminal',
          provenance: {
            kind: 'merge_ledger',
            commitSha: legacyRejectedEvidenceCommit,
          },
        },
      } as const;
      const job = await client.query<{ id: string }>(
        `UPDATE p1_generation_jobs
            SET status = 'failed',
                result = $3::jsonb,
                updated_at = now()
          WHERE workspace_id = $1
            AND id = $2
            AND status = 'running'
            AND result IS NULL
        RETURNING id`,
        [
          receipt.workspace_id,
          receipt.provider_job_id,
          JSON.stringify(result),
        ],
      );
      if (!attempt.rows[0] || !job.rows[0]) {
        throw new Error(
          'Issue 255 legacy rejection migration requires the untouched pending v1 provider lineage.',
        );
      }
      return result;
    });
  }

  async reconcileLegacyAcceptedImageWithoutTaskRefV2() {
    return this.locked(legacyImageRunNonce, async (client) => {
      const selected = await client.query<ReceiptRow>(
        `SELECT *
           FROM issue255_live_generation_receipts
          WHERE run_nonce = $1
            AND modality = 'image_text'
            AND effect_id = $2
            AND request_fingerprint = $3
            AND workspace_id = $4
            AND adapter = 'tuzi-image'
            AND deployment_id = 'seedream-4-5-tuzi-relay'
            AND provider_idempotency_key = $2
            AND provider_job_id = $5
            AND provider_attempt_id = $6
            AND provider_cost_event_id = $7
            AND recorded_matrix_digest = $8
            AND reserved_amount_micros = $9
            AND price_revision = $10
            AND exchange_revision = 'native-cny-v1'
            AND status = 'unknown'
            AND generation_submit_count = 1
            AND provider_http_request_count = 1
            AND actual_amount_micros IS NULL
            AND terminal_lineage IS NULL
            AND reconciliation_reason = 'provider_acceptance_unknown'
          FOR UPDATE`,
        [
          legacyImageRunNonce,
          legacyImageEffectId,
          legacyImageRequestFingerprint,
          legacyImageWorkspaceId,
          `issue-255-job-${legacyImageEffectId.slice(0, 32)}`,
          `issue-255-attempt-${legacyImageEffectId.slice(0, 28)}`,
          `issue-255-cost-${legacyImageEffectId.slice(0, 28)}`,
          'a3b601d062a543b07c14783eea674bf7a21807f5e20cdb393936b87750f8cf76',
          legacyImageAmountMicros,
          legacyImagePriceRevision,
        ],
      );
      const receipt = selected.rows[0];
      if (!receipt) {
        throw new Error(
          'Issue 255 legacy image reconciliation does not match the frozen v2 lineage.',
        );
      }
      const costs = await client.query<{ count: string }>(
        `SELECT COUNT(*)::bigint AS count
           FROM p1_provider_cost_events
          WHERE workspace_id = $1
            AND attempt_id = $2`,
        [receipt.workspace_id, receipt.provider_attempt_id],
      );
      if (Number(costs.rows[0]?.count ?? 0) !== 0) {
        throw new Error(
          'Issue 255 legacy image reconciliation requires no durable provider cost.',
        );
      }
      const attempt = await client.query<{ id: string }>(
        `UPDATE p1_provider_attempts
            SET acceptance = 'accepted',
                status = 'completed',
                updated_at = now()
          WHERE workspace_id = $1
            AND id = $2
            AND job_id = $3
            AND deployment_id = $4
            AND acceptance = 'pending'
            AND status = 'pending'
            AND provider_task_ref IS NULL
        RETURNING id`,
        [
          receipt.workspace_id,
          receipt.provider_attempt_id,
          receipt.provider_job_id,
          receipt.deployment_id,
        ],
      );
      if (!attempt.rows[0]) {
        throw new Error(
          'Issue 255 legacy image reconciliation does not match the frozen v2 lineage.',
        );
      }
      const observedWallClockMs = Math.max(
        1,
        Math.ceil(receipt.updated_at.getTime() - receipt.created_at.getTime()),
      );
      const terminal = priceCardReconciledImageLineageSchema.parse({
        workspaceId: receipt.workspace_id,
        effectId: receipt.effect_id,
        requestFingerprint: receipt.request_fingerprint,
        adapter: receipt.adapter,
        deploymentId: receipt.deployment_id,
        providerIdempotencyKey: receipt.provider_idempotency_key,
        attempt: {
          id: receipt.provider_attempt_id,
          jobId: receipt.provider_job_id,
          deploymentId: receipt.deployment_id,
          acceptance: 'accepted',
          status: 'completed',
          providerTaskRefMissing: true,
        },
        providerCost: {
          id: receipt.provider_cost_event_id,
          attemptId: receipt.provider_attempt_id,
          amountMicros: legacyImageAmountMicros,
          currency: 'CNY',
          priceRevision: receipt.price_revision,
          exchangeRevision: receipt.exchange_revision,
          stage: 'reconciled',
          usageEvidenceKind: 'price_card_reconciled',
          usage: { mediaUnits: 1 },
        },
        reconciliation: {
          kind: 'controller_issue_comment',
          issue: 255,
          commentId: legacyImageCommentId,
          reason: 'accepted_image_task_ref_not_persisted',
        },
        observedWallClockMs,
      });
      const result = {
        status: 'completed',
        issue255: {
          workspaceId: receipt.workspace_id,
          effectId: receipt.effect_id,
          requestFingerprint: receipt.request_fingerprint,
          adapter: receipt.adapter,
          deploymentId: receipt.deployment_id,
          providerIdempotencyKey: receipt.provider_idempotency_key,
          providerJobId: receipt.provider_job_id,
          providerAttemptId: receipt.provider_attempt_id,
          providerCostEventId: receipt.provider_cost_event_id,
        },
        attempt: terminal.attempt,
        providerCost: {
          id: receipt.provider_cost_event_id,
          status: 'reconciled',
          amountMicros: legacyImageAmountMicros,
          currency: 'CNY',
          usageEvidenceKind: 'price_card_reconciled',
          usage: { mediaUnits: 1 },
        },
        reconciliation: terminal.reconciliation,
        snapshot: {
          priceRevision: receipt.price_revision,
          allowedCandidates: [
            {
              deploymentId: receipt.deployment_id,
              priceRevision: receipt.price_revision,
            },
          ],
        },
      };
      const job = await client.query<{ id: string }>(
        `UPDATE p1_generation_jobs
            SET status = 'completed',
                result = $3::jsonb,
                updated_at = now()
          WHERE workspace_id = $1
            AND id = $2
            AND status = 'running'
            AND result IS NULL
        RETURNING id`,
        [receipt.workspace_id, receipt.provider_job_id, JSON.stringify(result)],
      );
      const cost = await client.query<{ id: string }>(
        `INSERT INTO p1_provider_cost_events (
           workspace_id, id, attempt_id, stage, amount_micros, currency, unit,
           evidence, payer, billing_status, actor_id, correlation_id, created_at
         ) VALUES (
           $1, $2, $3, 'reconciled', $4, 'CNY', 'issue255_live_sample',
           'issue255_tuzi_image_price_card_reconciliation', 'platform', 'known',
           'issue-255-live-reconciliation', $5, now()
         )
         RETURNING id`,
        [
          receipt.workspace_id,
          receipt.provider_cost_event_id,
          receipt.provider_attempt_id,
          legacyImageAmountMicros,
          `${receipt.provider_job_id}:correlation`,
        ],
      );
      const updated = await client.query<ReceiptRow>(
        `UPDATE issue255_live_generation_receipts
            SET status = 'completed',
                actual_amount_micros = $4,
                terminal_lineage = $5::jsonb,
                reconciliation_reason = 'tuzi_image_price_card_reconciled',
                updated_at = now()
          WHERE run_nonce = $1
            AND modality = 'image_text'
            AND effect_id = $2
            AND request_fingerprint = $3
            AND status = 'unknown'
            AND actual_amount_micros IS NULL
            AND terminal_lineage IS NULL
        RETURNING *`,
        [
          legacyImageRunNonce,
          legacyImageEffectId,
          legacyImageRequestFingerprint,
          legacyImageAmountMicros,
          JSON.stringify(terminal),
        ],
      );
      const completed = updated.rows[0];
      if (!job.rows[0] || !cost.rows[0] || !completed) {
        throw new Error(
          'Issue 255 legacy image reconciliation lost its frozen durable lineage.',
        );
      }
      return receiptFromRow(completed);
    });
  }

  async reconcileCoordinatorVideoV5FromPriceCard(input: {
    runNonce: string;
    effectId: string;
    requestFingerprint: string;
    providerTaskId: string;
    providerTaskRef: string;
    providerStatusSequence: ['unknown', 'completed'];
    normalizedStatusSequence: ['queued', 'completed'];
    providerCreatedAtEpochSeconds: number;
    providerSignedUrlTimestamp: string;
    wallClockUpperBoundMs: number;
    contentType: 'video/mp4';
    contentByteCount: number;
    contentSha256: string;
  }) {
    const parsed = z
      .object({
        runNonce: z.literal(coordinatorV5RunNonce),
        effectId: z.string().regex(/^[a-f0-9]{64}$/u),
        requestFingerprint: z.string().regex(/^[a-f0-9]{64}$/u),
        providerTaskId: z.string().trim().min(1).max(256),
        providerTaskRef: z.string().trim().min(1),
        providerStatusSequence: z.tuple([
          z.literal('unknown'),
          z.literal('completed'),
        ]),
        normalizedStatusSequence: z.tuple([
          z.literal('queued'),
          z.literal('completed'),
        ]),
        providerCreatedAtEpochSeconds: z.number().int().nonnegative(),
        providerSignedUrlTimestamp: z.string().regex(/^\d{8}T\d{6}Z$/u),
        wallClockUpperBoundMs: z.number().int().positive(),
        contentType: z.literal('video/mp4'),
        contentByteCount: z.number().int().positive(),
        contentSha256: z.string().regex(/^[a-f0-9]{64}$/u),
      })
      .strict()
      .parse(input);
    return this.locked(parsed.runNonce, async (client) => {
      const selected = await client.query<ReceiptRow>(
        `SELECT *
           FROM issue255_live_generation_receipts
          WHERE run_nonce = $1
            AND modality = 'video'
            AND effect_id = $2
            AND request_fingerprint = $3
            AND adapter = 'tuzi-video'
            AND deployment_id = 'seedance-1-5-pro-tuzi-relay'
            AND provider_idempotency_key = $2
            AND provider_task_id = $4
            AND reserved_amount_micros = 1620000
            AND exchange_revision = 'native-cny-v1'
            AND status = 'unknown'
            AND generation_submit_count = 1
            AND provider_http_request_count >= 2
            AND actual_amount_micros IS NULL
            AND terminal_lineage IS NULL
            AND reconciliation_reason = 'provider_failure_recorded'
          FOR UPDATE`,
        [
          parsed.runNonce,
          parsed.effectId,
          parsed.requestFingerprint,
          parsed.providerTaskId,
        ],
      );
      const receipt = selected.rows[0];
      if (!receipt) {
        throw new Error(
          'Issue 255 v5 recovery does not match its frozen durable receipt.',
        );
      }
      const costs = await client.query<{ count: string }>(
        `SELECT COUNT(*)::bigint AS count
           FROM p1_provider_cost_events
          WHERE workspace_id = $1
            AND attempt_id = $2`,
        [receipt.workspace_id, receipt.provider_attempt_id],
      );
      if (Number(costs.rows[0]?.count ?? 0) !== 0) {
        throw new Error(
          'Issue 255 v5 price-card recovery requires zero prior ProviderCost events.',
        );
      }
      const terminal = priceCardReconciledVideoLineageSchema.parse({
        workspaceId: receipt.workspace_id,
        effectId: receipt.effect_id,
        requestFingerprint: receipt.request_fingerprint,
        adapter: receipt.adapter,
        deploymentId: receipt.deployment_id,
        providerIdempotencyKey: receipt.provider_idempotency_key,
        providerTaskIdHash: createHash('sha256')
          .update(parsed.providerTaskId)
          .digest('hex'),
        attempt: {
          id: receipt.provider_attempt_id,
          jobId: receipt.provider_job_id,
          deploymentId: receipt.deployment_id,
          providerTaskRef: parsed.providerTaskRef,
          acceptance: 'accepted',
          status: 'completed',
        },
        providerCost: {
          id: receipt.provider_cost_event_id,
          attemptId: receipt.provider_attempt_id,
          amountMicros: 1_620_000,
          currency: 'CNY',
          priceRevision: receipt.price_revision,
          exchangeRevision: receipt.exchange_revision,
          stage: 'reconciled',
          usageEvidenceKind: 'price_card_reconciled',
          usage: { mediaUnits: 1 },
        },
        recovery: {
          reason: 'relay_completed_without_per_task_usage',
          providerStatusSequence: parsed.providerStatusSequence,
          normalizedStatusSequence: parsed.normalizedStatusSequence,
          providerCreatedAtEpochSeconds: parsed.providerCreatedAtEpochSeconds,
          providerSignedUrlTimestamp: parsed.providerSignedUrlTimestamp,
          wallClockUpperBoundMs: parsed.wallClockUpperBoundMs,
          contentType: parsed.contentType,
          contentByteCount: parsed.contentByteCount,
          contentSha256: parsed.contentSha256,
        },
      });
      const result = {
        status: 'completed',
        issue255: {
          workspaceId: receipt.workspace_id,
          effectId: receipt.effect_id,
          requestFingerprint: receipt.request_fingerprint,
          adapter: receipt.adapter,
          deploymentId: receipt.deployment_id,
          providerIdempotencyKey: receipt.provider_idempotency_key,
          providerJobId: receipt.provider_job_id,
          providerAttemptId: receipt.provider_attempt_id,
          providerCostEventId: receipt.provider_cost_event_id,
        },
        attempt: terminal.attempt,
        providerCost: {
          id: receipt.provider_cost_event_id,
          status: 'reconciled',
          amountMicros: 1_620_000,
          currency: 'CNY',
          usageEvidenceKind: 'price_card_reconciled',
          usage: { mediaUnits: 1 },
        },
        reconciliation: terminal.recovery,
        snapshot: {
          priceRevision: receipt.price_revision,
          allowedCandidates: [
            {
              deploymentId: receipt.deployment_id,
              priceRevision: receipt.price_revision,
            },
          ],
        },
      };
      const attempt = await client.query<{ id: string }>(
        `UPDATE p1_provider_attempts
            SET acceptance = 'accepted',
                status = 'completed',
                provider_task_ref = $5,
                updated_at = now()
          WHERE workspace_id = $1
            AND id = $2
            AND job_id = $3
            AND deployment_id = $4
            AND acceptance = 'pending'
            AND status = 'pending'
            AND provider_task_ref IS NULL
        RETURNING id`,
        [
          receipt.workspace_id,
          receipt.provider_attempt_id,
          receipt.provider_job_id,
          receipt.deployment_id,
          parsed.providerTaskRef,
        ],
      );
      const job = await client.query<{ id: string }>(
        `UPDATE p1_generation_jobs
            SET status = 'completed',
                result = $3::jsonb,
                updated_at = now()
          WHERE workspace_id = $1
            AND id = $2
            AND status = 'running'
            AND result IS NULL
        RETURNING id`,
        [receipt.workspace_id, receipt.provider_job_id, JSON.stringify(result)],
      );
      const cost = await client.query<{ id: string }>(
        `INSERT INTO p1_provider_cost_events (
           workspace_id, id, attempt_id, stage, amount_micros, currency, unit,
           evidence, payer, billing_status, actor_id, correlation_id, created_at
         ) VALUES (
           $1, $2, $3, 'reconciled', 1620000, 'CNY', 'issue255_live_sample',
           'issue255_tuzi_video_price_card_reconciliation', 'platform', 'known',
           'issue-255-live-reconciliation', $4, now()
         )
         RETURNING id`,
        [
          receipt.workspace_id,
          receipt.provider_cost_event_id,
          receipt.provider_attempt_id,
          `${receipt.provider_job_id}:correlation`,
        ],
      );
      const updated = await client.query<ReceiptRow>(
        `UPDATE issue255_live_generation_receipts
            SET status = 'completed',
                actual_amount_micros = 1620000,
                terminal_lineage = $4::jsonb,
                reconciliation_reason = 'tuzi_video_price_card_reconciled',
                updated_at = now()
          WHERE run_nonce = $1
            AND effect_id = $2
            AND request_fingerprint = $3
            AND status = 'unknown'
            AND actual_amount_micros IS NULL
            AND terminal_lineage IS NULL
        RETURNING *`,
        [
          parsed.runNonce,
          parsed.effectId,
          parsed.requestFingerprint,
          JSON.stringify(terminal),
        ],
      );
      if (!attempt.rows[0] || !job.rows[0] || !cost.rows[0] || !updated.rows[0]) {
        throw new Error(
          'Issue 255 v5 recovery lost its frozen durable lineage.',
        );
      }
      return receiptFromRow(updated.rows[0]);
    });
  }

  async prepareCoordinatorVideoV3FailedBeforeBilling() {
    return this.locked(coordinatorV3.runNonce, async (client) => {
      const selected = await client.query<ReceiptRow>(
        `SELECT *
           FROM issue255_live_generation_receipts
          WHERE run_nonce = $1
            AND modality = 'video'
            AND workspace_id = $2
            AND effect_id = $3
            AND request_fingerprint = $4
            AND adapter = 'tuzi-video'
            AND deployment_id = 'seedance-1-5-pro-tuzi-relay'
            AND provider_idempotency_key = $3
            AND provider_job_id = $5
            AND provider_attempt_id = $6
            AND provider_cost_event_id = $7
            AND status = 'unknown'
            AND generation_submit_count = 1
            AND provider_http_request_count = 1
            AND provider_http_status = 451
            AND failure_error_code = 'invalid_request'
            AND reconciliation_reason = 'provider_failure_recorded'
          FOR UPDATE`,
        [
          coordinatorV3.runNonce,
          coordinatorV3.workspaceId,
          coordinatorV3.effectId,
          coordinatorV3.requestFingerprint,
          coordinatorV3.providerJobId,
          coordinatorV3.providerAttemptId,
          coordinatorV3.providerCostEventId,
        ],
      );
      const receipt = selected.rows[0];
      if (!receipt) {
        throw new Error(
          'Issue 255 v3 reconciliation does not match its frozen durable receipt.',
        );
      }
      const failureMessage = receipt.failure_error_message ?? '';
      if (
        !failureMessage.includes('InvalidParameter') ||
        !failureMessage.includes('specified duration is not supported') ||
        !failureMessage.includes('doubao-seedance-1-5-pro') ||
        !failureMessage.includes('"code":400')
      ) {
        throw new Error(
          'Issue 255 v3 reconciliation requires the trusted duration rejection.',
        );
      }
      const costs = await client.query<{ count: string }>(
        `SELECT COUNT(*)::bigint AS count
           FROM p1_provider_cost_events
          WHERE workspace_id = $1
            AND attempt_id = $2`,
        [receipt.workspace_id, receipt.provider_attempt_id],
      );
      if (Number(costs.rows[0]?.count ?? 0) !== 0) {
        throw new Error(
          'Issue 255 v3 reconciliation requires zero durable ProviderCost events.',
        );
      }
      const result = {
        status: 'failed',
        issue255: {
          workspaceId: receipt.workspace_id,
          effectId: receipt.effect_id,
          requestFingerprint: receipt.request_fingerprint,
          adapter: receipt.adapter,
          deploymentId: receipt.deployment_id,
          providerIdempotencyKey: receipt.provider_idempotency_key,
          providerJobId: receipt.provider_job_id,
          providerAttemptId: receipt.provider_attempt_id,
          providerCostEventId: receipt.provider_cost_event_id,
        },
        failure: {
          acceptance: 'rejected_before_accept',
          reason: 'provider_rejected_before_accept',
          source: 'provider_execution_terminal',
          provenance: {
            kind: 'durable_provider_http',
            httpStatus: 451,
            upstreamStatus: 400,
            errorCode: 'invalid_request',
            messageSha256: createHash('sha256')
              .update(failureMessage)
              .digest('hex'),
          },
        },
      } as const;
      const attempt = await client.query<{ id: string }>(
        `UPDATE p1_provider_attempts
            SET acceptance = 'rejected_before_accept',
                status = 'failed',
                updated_at = now()
          WHERE workspace_id = $1
            AND id = $2
            AND job_id = $3
            AND deployment_id = $4
            AND acceptance = 'pending'
            AND status = 'pending'
            AND provider_task_ref IS NULL
        RETURNING id`,
        [
          receipt.workspace_id,
          receipt.provider_attempt_id,
          receipt.provider_job_id,
          receipt.deployment_id,
        ],
      );
      const job = await client.query<{ id: string }>(
        `UPDATE p1_generation_jobs
            SET status = 'failed',
                result = $3::jsonb,
                updated_at = now()
          WHERE workspace_id = $1
            AND id = $2
            AND status = 'running'
            AND result IS NULL
        RETURNING id`,
        [
          receipt.workspace_id,
          receipt.provider_job_id,
          JSON.stringify(result),
        ],
      );
      if (!attempt.rows[0] || !job.rows[0]) {
        throw new Error(
          'Issue 255 v3 reconciliation requires its untouched pending provider lineage.',
        );
      }
      return result;
    });
  }

  async confirmFailedBeforeBilling(
    runNonce: string,
    providerLedger: Issue255ProviderLedgerReader,
  ) {
    const parsedRunNonce = z.string().trim().min(1).parse(runNonce);
    const receipts = (await this.listRun(parsedRunNonce)).filter(
      ({ status }) => status === 'unknown',
    );
    if (receipts.length === 0) {
      throw new Error(
        'Issue 255 failed-before-billing reconciliation requires an unknown receipt.',
      );
    }
    const confirmed = [];
    for (const receipt of receipts) {
      confirmed.push(
        await this.locked(parsedRunNonce, async (client) => {
          const selected = await client.query<ReceiptRow>(
            `SELECT *
               FROM issue255_live_generation_receipts
              WHERE run_nonce = $1
                AND modality = $2
                AND effect_id = $3
                AND request_fingerprint = $4
                AND status = 'unknown'
              FOR UPDATE`,
            [
              parsedRunNonce,
              receipt.modality,
              receipt.effectId,
              receipt.requestFingerprint,
            ],
          );
          const row = selected.rows[0];
          if (!row || row.generation_submit_count !== 1) {
            throw new Error(
              'Issue 255 failed-before-billing requires exactly one durable generation POST.',
            );
          }
          const terminal = await readFailedBeforeBillingLineage(
            row,
            providerLedger,
          );
          const serialized = JSON.stringify(terminal);
          const updatedReceipt = await client.query<ReceiptRow>(
            `UPDATE issue255_live_generation_receipts
                SET status = 'failed_before_billing',
                    actual_amount_micros = 0,
                    terminal_lineage = $5::jsonb,
                    reconciliation_reason = 'provider_rejected_before_accept',
                    updated_at = now()
              WHERE run_nonce = $1
                AND modality = $2
                AND effect_id = $3
                AND request_fingerprint = $4
                AND status = 'unknown'
                AND generation_submit_count = 1
            RETURNING *`,
            [
              parsedRunNonce,
              receipt.modality,
              receipt.effectId,
              receipt.requestFingerprint,
              serialized,
            ],
          );
          const updatedAuthorization = await client.query(
            `UPDATE issue255_live_generation_authorizations
                SET status = 'failed_before_billing',
                    disposition_reason = 'provider_rejected_before_accept',
                    terminal_lineage = $2::jsonb
              WHERE effect_id = $1
                AND status = 'billable'
            RETURNING effect_id`,
            [receipt.effectId, serialized],
          );
          const rowAfter = updatedReceipt.rows[0];
          if (!rowAfter || !updatedAuthorization.rows[0]) {
            throw new Error(
              'Issue 255 failed-before-billing disposition lost its append-only authorization.',
            );
          }
          return receiptFromRow(rowAfter);
        }),
      );
    }
    return confirmed;
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
         FROM issue255_live_generation_authorizations
        WHERE status <> 'failed_before_billing'`,
    );
    if (
      Number(authorizationCount.rows[0]?.count ?? 0) >=
      GLOBAL_BILLABLE_AUTHORIZATION_CAP
    ) {
      throw new Error(
        'Issue 255 permits exactly six billable generation POSTs globally.',
      );
    }
    const runBudget = await client.query<{ amount_micros: string }>(
      `SELECT (
         COALESCE((
           SELECT SUM(reserved_amount_micros)
             FROM issue255_live_generation_authorizations
            WHERE run_nonce = $1
              AND status <> 'failed_before_billing'
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
            WHERE status <> 'failed_before_billing'
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
          usageEvidenceKind: z
            .enum(['provider_reported', 'response_derived'])
            .default('provider_reported'),
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
        usageEvidenceKind: result.providerCost.usageEvidenceKind,
        usage: result.providerCost.usage,
    },
  });
}

async function readFailedBeforeBillingLineage(
  receipt: ReceiptRow,
  providerLedger: Issue255ProviderLedgerReader,
): Promise<Issue255FailedBeforeBillingLineage> {
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
    attempt.acceptance !== 'rejected_before_accept' ||
    attempt.status !== 'failed'
  ) {
    throw new Error(
      'Issue 255 failed-before-billing requires a durable rejected-before-accept terminal.',
    );
  }
  if (costs.some(({ amountMicros }) => amountMicros !== 0)) {
    throw new Error(
      'Issue 255 failed-before-billing requires zero durable provider cost.',
    );
  }
  const result = z
    .object({
      status: z.literal('failed'),
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
      failure: z
        .object({
          acceptance: z.literal('rejected_before_accept'),
          reason: z.literal('provider_rejected_before_accept'),
          source: z.literal('provider_execution_terminal'),
          provenance: failedBeforeBillingProvenanceSchema,
        })
        .strict(),
    })
    .strict()
    .parse(job?.result);
  if (
    !job ||
    job.status !== 'failed' ||
    result.issue255.workspaceId !== receipt.workspace_id ||
    result.issue255.effectId !== receipt.effect_id ||
    result.issue255.requestFingerprint !== receipt.request_fingerprint ||
    result.issue255.adapter !== receipt.adapter ||
    result.issue255.deploymentId !== receipt.deployment_id ||
    result.issue255.providerIdempotencyKey !==
      receipt.provider_idempotency_key ||
    result.issue255.providerJobId !== receipt.provider_job_id ||
    result.issue255.providerAttemptId !== receipt.provider_attempt_id ||
    result.issue255.providerCostEventId !== receipt.provider_cost_event_id
  ) {
    throw new Error(
      'Issue 255 rejected-before-accept terminal does not bind the frozen receipt lineage.',
    );
  }
  return failedBeforeBillingLineageSchema.parse({
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
      acceptance: attempt.acceptance,
      status: attempt.status,
    },
    failure: {
      reason: result.failure.reason,
      source: result.failure.source,
      provenance: result.failure.provenance,
    },
    providerCost: {
      eventCount: costs.length,
      amountMicros: 0,
      currency: 'CNY',
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
    providerTaskId: row.provider_task_id,
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
    failureErrorCode: row.failure_error_code,
    failureErrorMessage: row.failure_error_message,
    providerHttpStatus: row.provider_http_status,
    terminalLineage:
      row.terminal_lineage === null
        ? null
        : row.status === 'failed_before_billing'
          ? failedBeforeBillingLineageSchema.parse(row.terminal_lineage)
          : row.reconciliation_reason ===
              'tuzi_image_price_card_reconciled'
            ? priceCardReconciledImageLineageSchema.parse(
                row.terminal_lineage,
              )
            : row.reconciliation_reason ===
                'tuzi_video_price_card_reconciled'
              ? priceCardReconciledVideoLineageSchema.parse(
                  row.terminal_lineage,
                )
            : durableTerminalLineageSchema.parse(row.terminal_lineage),
    reconciliationReason: row.reconciliation_reason,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
  };
}

function sanitizeFailureCode(value: string) {
  if (
    /\b(api[_-]?key|authorization|bearer|credential|password|token)\b/iu.test(
      value,
    ) ||
    /^[a-z0-9+/=-]{24,}$/iu.test(value.trim())
  ) {
    return 'provider_error';
  }
  const sanitized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_.:-]+/gu, '_')
    .slice(0, 96);
  return sanitized || 'provider_error';
}

function sanitizeFailureMessage(value: string) {
  const sanitized = value
    .replace(
      /\b(payload|response|body)\s*[:=]\s*[\[{].*$/giu,
      '$1=[redacted-payload]',
    )
    .replace(/postgres(?:ql)?:\/\/\S+/giu, '[redacted-database-url]')
    .replace(/https?:\/\/\S+/giu, '[redacted-url]')
    .replace(/\bbearer\s+\S+/giu, 'Bearer [redacted]')
    .replace(
      /\b(api[_-]?key|authorization|credential|password|token)\s*[:=]\s*\S+/giu,
      '$1=[redacted]',
    )
    .replace(/\b[a-z0-9+/_=-]{24,}\b/giu, '[redacted-token]')
    .replace(/[\u0000-\u001f\u007f]+/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, 500);
  return sanitized || 'Provider execution failed.';
}
