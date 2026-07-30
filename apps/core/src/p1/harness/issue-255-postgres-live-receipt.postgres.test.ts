import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, beforeEach, describe, it } from 'node:test';
import { Pool } from 'pg';

import { PostgresFoundationRepository } from '../foundation/postgres-repository.js';
import { reconcileIssue255LiveRun } from './issue-255-live-reconciliation.js';
import { PostgresIssue255LiveReceiptRepository } from './issue-255-postgres-live-receipt.js';

const connectionString = process.env.TEST_DATABASE_URL;

describe(
  'PostgreSQL issue 255 live receipt',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  () => {
    const firstPool = new Pool({ connectionString, max: 2 });
    const secondPool = new Pool({ connectionString, max: 2 });
    const first = new PostgresIssue255LiveReceiptRepository(firstPool);
    const second = new PostgresIssue255LiveReceiptRepository(secondPool);
    const suiteNonce = randomUUID();
    const receiptWorkspaceId =
      `issue-255-receipt-workspace-${suiteNonce}`;
    const providerIdentity = {
      copy: {
        adapter: 'direct-copy',
        deploymentId: 'deepseek-v4-pro-direct',
        priceRevision: 'direct-copy-price-v1',
      },
      video: {
        adapter: 'tuzi-video',
        deploymentId: 'seedance-1-5-pro-tuzi-relay',
        priceRevision: 'video-price-v1',
      },
    } as const;
    const legacyImage = {
      runNonce: 'issue-255-live-anchors-2026-07-30-v2',
      effectId:
        'd2ccabe63b58ece3404bd27a36e8b811c5b6bf19c80e5f57b005bf7f5351f98e',
      requestFingerprint:
        '55a81ab1ca94a0a041de4a273c45adcdab861c690d7a40b3481e03019e9c6c17',
      workspaceId: 'issue-255-live-1165ded3ff521938de15da91',
      adapter: 'tuzi-image',
      deploymentId: 'seedream-4-5-tuzi-relay',
      priceRevision:
        'seedream-4-5:channel-tuzi-seedream-4-5-relay:standard:price-v1',
      recordedMatrixDigest:
        'a3b601d062a543b07c14783eea674bf7a21807f5e20cdb393936b87750f8cf76',
      reservedAmountMicros: 50_000,
    } as const;
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
      recordedMatrixDigest:
        'a3b601d062a543b07c14783eea674bf7a21807f5e20cdb393936b87750f8cf76',
      priceRevision:
        'seedance-1-5-pro:channel-tuzi-seedance-relay:standard:price-v1',
    } as const;
    const insertLegacyReceipt = async (input: {
      runNonce: string;
      modality: keyof typeof providerIdentity;
      generationSubmitCount: 0 | 1;
      reservedAmountMicros: number;
      providerJobId?: string | null;
    }) => {
      const effectId = createHash('sha256')
        .update(`issue255/v1\0${input.runNonce}\0${input.modality}`)
        .digest('hex');
      const identity = providerIdentity[input.modality];
      await firstPool.query(
        `INSERT INTO issue255_live_generation_receipts (
           workspace_id, run_nonce, modality, effect_id, request_fingerprint,
           adapter, deployment_id, provider_idempotency_key, provider_job_id,
           provider_attempt_id, provider_cost_event_id, recorded_matrix_digest,
           reserved_amount_micros, price_revision, exchange_revision, status,
           generation_submit_count
         )
         VALUES (
           $1, $2, $3, $4, $5, $6, $7, $4, $8, $9, $10, $11, $12, $13,
           'native-cny-v1', 'completed', $14
         )`,
        [
          receiptWorkspaceId,
          input.runNonce,
          input.modality,
          effectId,
          createHash('sha256').update(input.runNonce).digest('hex'),
          identity.adapter,
          identity.deploymentId,
          input.providerJobId === undefined
            ? `${effectId}:job`
            : input.providerJobId,
          `${effectId}:attempt`,
          `${effectId}:cost`,
          'a'.repeat(64),
          input.reservedAmountMicros,
          identity.priceRevision,
          input.generationSubmitCount,
        ],
      );
      return effectId;
    };
    const copyClaim = (runNonce: string, reservedAmountMicros = 100_000) => {
      const effectId = createHash('sha256')
        .update(`issue255/v1\0${runNonce}\0copy`)
        .digest('hex');
      return {
        workspaceId: receiptWorkspaceId,
        runNonce,
        modality: 'copy' as const,
        effectId,
        requestFingerprint: createHash('sha256')
          .update(`claim/${runNonce}`)
          .digest('hex'),
        ...providerIdentity.copy,
        providerIdempotencyKey: effectId,
        providerJobId: `${effectId}:job`,
        providerAttemptId: `${effectId}:attempt`,
        providerCostEventId: `${effectId}:cost`,
        recordedMatrixDigest: 'b'.repeat(64),
        reservedAmountMicros,
        exchangeRevision: 'native-cny-v1',
      };
    };
    const failedBeforeBillingCandidate = async (input: {
      acceptance?: 'accepted' | 'pending' | 'rejected_before_accept';
      amountMicros?: number;
      pending?: boolean;
      runNonce?: string;
      requestFingerprint?: string;
      suffix: string;
    }) => {
      const runNonce =
        input.runNonce ??
        `issue-255-pg-${suiteNonce}-failed-before-billing-${input.suffix}`;
      const workspaceId =
        input.runNonce
          ? 'issue-255-live-fd117da50a1e2d3d15ac5976'
          : `issue-255-workspace-${suiteNonce}-failed-before-billing-${input.suffix}`;
      const claim = {
        ...copyClaim(runNonce),
        workspaceId,
        ...(input.requestFingerprint
          ? { requestFingerprint: input.requestFingerprint }
          : {}),
        ...(input.runNonce
          ? {
              providerJobId:
                'issue-255-job-f59700fea85015b990436228219b997b',
              providerAttemptId:
                'issue-255-attempt-f59700fea85015b990436228219b',
              providerCostEventId:
                'issue-255-cost-f59700fea85015b990436228219b',
            }
          : {}),
      };
      await firstPool.query(
        `INSERT INTO workspaces (id, name)
         VALUES ($1, 'Issue 255 failed-before-billing test')`,
        [workspaceId],
      );
      await firstPool.query(
        `INSERT INTO p1_route_snapshots (
           workspace_id, id, catalog_revision, policy_revision, price_revision,
           requested_catalog_model_id, selection_mode, data_class, data_classes,
           fallback_consent, allowed_candidates, created_at
         ) VALUES (
           $1, $2, 'issue-255-live-v1', 'issue-255-no-fallback-v1', $3, $4,
           'fixed', 'public', '["public"]'::jsonb, false, $5::jsonb, now()
         )`,
        [
          workspaceId,
          `${claim.providerJobId}:route`,
          claim.priceRevision,
          claim.deploymentId,
          JSON.stringify([
            {
              deploymentId: claim.deploymentId,
              priceRevision: claim.priceRevision,
            },
          ]),
        ],
      );
      await firstPool.query(
        `INSERT INTO p1_generation_jobs (
           workspace_id, id, operation, route_snapshot_id, usage_reservation_id,
           status, created_by, correlation_id, result, created_at, updated_at
         ) VALUES (
           $1, $2, 'copy', $3, $4, $6, 'issue-255-test', $5,
           $7::jsonb, now(), now()
         )`,
        [
          workspaceId,
          claim.providerJobId,
          `${claim.providerJobId}:route`,
          `${claim.providerJobId}:usage`,
          `${claim.providerJobId}:correlation`,
          input.pending ? 'running' : 'failed',
          input.pending
            ? null
            : JSON.stringify({
                status: 'failed',
                issue255: {
                  workspaceId,
                  effectId: claim.effectId,
                  requestFingerprint: claim.requestFingerprint,
                  adapter: claim.adapter,
                  deploymentId: claim.deploymentId,
                  providerIdempotencyKey: claim.effectId,
                  providerJobId: claim.providerJobId,
                  providerAttemptId: claim.providerAttemptId,
                  providerCostEventId: claim.providerCostEventId,
                },
                failure: {
                  acceptance:
                    input.acceptance ?? 'rejected_before_accept',
                  reason: 'provider_rejected_before_accept',
                  source: 'provider_execution_terminal',
                  provenance: {
                    kind: 'merge_ledger',
                    commitSha:
                      '695489fe441178431394bb320ad779b28cb9f654',
                  },
                },
              }),
        ],
      );
      await firstPool.query(
        `INSERT INTO p1_provider_attempts (
           workspace_id, id, job_id, ordinal, deployment_id, acceptance,
           status, created_at, updated_at
         ) VALUES ($1, $2, $3, 1, $4, $5, $6, now(), now())`,
        [
          workspaceId,
          claim.providerAttemptId,
          claim.providerJobId,
          claim.deploymentId,
          input.pending
            ? 'pending'
            : input.acceptance ?? 'rejected_before_accept',
          input.pending ? 'pending' : 'failed',
        ],
      );
      if (input.amountMicros !== undefined) {
        await firstPool.query(
          `INSERT INTO p1_provider_cost_events (
             workspace_id, id, attempt_id, stage, amount_micros, currency, unit,
             evidence, payer, billing_status, actor_id, correlation_id, created_at
           ) VALUES (
             $1, $2, $3, 'observed', $4, 'CNY', 'issue255_live_sample',
             'issue255_provider_reported_terminal', 'platform', 'known',
             'issue-255-test', $5, now()
           )`,
          [
            workspaceId,
            claim.providerCostEventId,
            claim.providerAttemptId,
            input.amountMicros,
            `${claim.providerJobId}:correlation`,
          ],
        );
      }
      await first.claim(claim);
      await first.claimGenerationPost({
        adapter: 'direct-copy',
        deploymentId: claim.deploymentId,
        runNonce,
        modality: 'copy',
        effectId: claim.effectId,
        providerIdempotencyKey: claim.effectId,
        requestFingerprint: claim.requestFingerprint,
      });
      await first.recordProviderHttpRequest({
        adapter: 'direct-copy',
        deploymentId: claim.deploymentId,
        runNonce,
        modality: 'copy',
        effectId: claim.effectId,
        providerIdempotencyKey: claim.effectId,
        requestFingerprint: claim.requestFingerprint,
      });
      await first.markUnknown({
        runNonce,
        modality: 'copy',
        effectId: claim.effectId,
        requestFingerprint: claim.requestFingerprint,
        reason: 'provider_acceptance_unknown',
      });
      return { claim, runNonce, workspaceId };
    };
    const coordinatorV3Candidate = async (failureErrorMessage: string) => {
      const claim = {
        workspaceId: coordinatorV3.workspaceId,
        runNonce: coordinatorV3.runNonce,
        modality: 'video' as const,
        effectId: coordinatorV3.effectId,
        requestFingerprint: coordinatorV3.requestFingerprint,
        adapter: 'tuzi-video',
        deploymentId: 'seedance-1-5-pro-tuzi-relay',
        providerIdempotencyKey: coordinatorV3.effectId,
        providerJobId: coordinatorV3.providerJobId,
        providerAttemptId: coordinatorV3.providerAttemptId,
        providerCostEventId: coordinatorV3.providerCostEventId,
        recordedMatrixDigest: coordinatorV3.recordedMatrixDigest,
        reservedAmountMicros: 1_620_000,
        priceRevision: coordinatorV3.priceRevision,
        exchangeRevision: 'native-cny-v1',
      } as const;
      await firstPool.query(
        `INSERT INTO workspaces (id, name)
         VALUES ($1, 'Issue 255 coordinator v3 reconciliation test')`,
        [claim.workspaceId],
      );
      await firstPool.query(
        `INSERT INTO p1_route_snapshots (
           workspace_id, id, catalog_revision, policy_revision, price_revision,
           requested_catalog_model_id, selection_mode, data_class, data_classes,
           fallback_consent, allowed_candidates, created_at
         ) VALUES (
           $1, $2, 'issue-255-live-v3', 'issue-255-no-fallback-v1', $3,
           'seedance-1-5-pro', 'fixed', 'public', '["public"]'::jsonb,
           false, $4::jsonb, now()
         )`,
        [
          claim.workspaceId,
          `${claim.providerJobId}:route`,
          claim.priceRevision,
          JSON.stringify([
            {
              deploymentId: claim.deploymentId,
              priceRevision: claim.priceRevision,
            },
          ]),
        ],
      );
      await firstPool.query(
        `INSERT INTO p1_generation_jobs (
           workspace_id, id, operation, route_snapshot_id, usage_reservation_id,
           status, created_by, correlation_id, created_at, updated_at
         ) VALUES (
           $1, $2, 'video', $3, $4, 'running', 'issue-255-test', $5, now(), now()
         )`,
        [
          claim.workspaceId,
          claim.providerJobId,
          `${claim.providerJobId}:route`,
          `${claim.providerJobId}:usage`,
          `${claim.providerJobId}:correlation`,
        ],
      );
      await firstPool.query(
        `INSERT INTO p1_provider_attempts (
           workspace_id, id, job_id, ordinal, deployment_id, acceptance,
           status, created_at, updated_at
         ) VALUES ($1, $2, $3, 1, $4, 'pending', 'pending', now(), now())`,
        [
          claim.workspaceId,
          claim.providerAttemptId,
          claim.providerJobId,
          claim.deploymentId,
        ],
      );
      await first.claim(claim);
      const identity = {
        adapter: claim.adapter,
        deploymentId: claim.deploymentId,
        runNonce: claim.runNonce,
        modality: claim.modality,
        effectId: claim.effectId,
        providerIdempotencyKey: claim.providerIdempotencyKey,
        requestFingerprint: claim.requestFingerprint,
      } as const;
      await first.claimGenerationPost(identity);
      await first.recordProviderHttpRequest(identity);
      await first.recordProviderHttpResponse({ ...identity, httpStatus: 451 });
      await first.recordExecutionFailure({
        runNonce: claim.runNonce,
        modality: claim.modality,
        effectId: claim.effectId,
        requestFingerprint: claim.requestFingerprint,
        errorCode: 'invalid_request',
        errorMessage: failureErrorMessage,
      });
      return claim;
    };
    const legacyImageCandidate = async () => {
      const claim = {
        workspaceId: legacyImage.workspaceId,
        runNonce: legacyImage.runNonce,
        modality: 'image_text' as const,
        effectId: legacyImage.effectId,
        requestFingerprint: legacyImage.requestFingerprint,
        adapter: legacyImage.adapter,
        deploymentId: legacyImage.deploymentId,
        providerIdempotencyKey: legacyImage.effectId,
        providerJobId: `issue-255-job-${legacyImage.effectId.slice(0, 32)}`,
        providerAttemptId: `issue-255-attempt-${legacyImage.effectId.slice(0, 28)}`,
        providerCostEventId: `issue-255-cost-${legacyImage.effectId.slice(0, 28)}`,
        recordedMatrixDigest: legacyImage.recordedMatrixDigest,
        reservedAmountMicros: legacyImage.reservedAmountMicros,
        priceRevision: legacyImage.priceRevision,
        exchangeRevision: 'native-cny-v1',
      };
      await firstPool.query(
        `INSERT INTO workspaces (id, name)
         VALUES ($1, 'Issue 255 legacy image reconciliation test')`,
        [claim.workspaceId],
      );
      await firstPool.query(
        `INSERT INTO p1_route_snapshots (
           workspace_id, id, catalog_revision, policy_revision, price_revision,
           requested_catalog_model_id, selection_mode, data_class, data_classes,
           fallback_consent, allowed_candidates, created_at
         ) VALUES (
           $1, $2, 'issue-255-live-v2', 'issue-255-no-fallback-v1', $3, $4,
           'fixed', 'public', '["public"]'::jsonb, false, $5::jsonb, now()
         )`,
        [
          claim.workspaceId,
          `${claim.providerJobId}:route`,
          claim.priceRevision,
          claim.deploymentId,
          JSON.stringify([
            {
              deploymentId: claim.deploymentId,
              priceRevision: claim.priceRevision,
            },
          ]),
        ],
      );
      await firstPool.query(
        `INSERT INTO p1_generation_jobs (
           workspace_id, id, operation, route_snapshot_id, usage_reservation_id,
           status, created_by, correlation_id, created_at, updated_at
         ) VALUES (
           $1, $2, 'image', $3, $4, 'running', 'issue-255-test', $5, now(), now()
         )`,
        [
          claim.workspaceId,
          claim.providerJobId,
          `${claim.providerJobId}:route`,
          `${claim.providerJobId}:usage`,
          `${claim.providerJobId}:correlation`,
        ],
      );
      await firstPool.query(
        `INSERT INTO p1_provider_attempts (
           workspace_id, id, job_id, ordinal, deployment_id, acceptance,
           status, created_at, updated_at
         ) VALUES ($1, $2, $3, 1, $4, 'pending', 'pending', now(), now())`,
        [
          claim.workspaceId,
          claim.providerAttemptId,
          claim.providerJobId,
          claim.deploymentId,
        ],
      );
      await first.claim(claim);
      await first.claimGenerationPost({
        adapter: claim.adapter,
        deploymentId: claim.deploymentId,
        runNonce: claim.runNonce,
        modality: claim.modality,
        effectId: claim.effectId,
        providerIdempotencyKey: claim.effectId,
        requestFingerprint: claim.requestFingerprint,
      });
      await first.recordProviderHttpRequest({
        adapter: claim.adapter,
        deploymentId: claim.deploymentId,
        runNonce: claim.runNonce,
        modality: claim.modality,
        effectId: claim.effectId,
        providerIdempotencyKey: claim.effectId,
        requestFingerprint: claim.requestFingerprint,
      });
      await first.markUnknown({
        runNonce: claim.runNonce,
        modality: claim.modality,
        effectId: claim.effectId,
        requestFingerprint: claim.requestFingerprint,
        reason: 'provider_acceptance_unknown',
      });
      return claim;
    };

    before(async () => {
      await new PostgresFoundationRepository(firstPool).migrate();
      await first.migrate();
    });

    beforeEach(async () => {
      await firstPool.query(
        `DELETE FROM issue255_live_generation_receipts
          WHERE run_nonce = 'issue-255-live-anchors-2026-07-30-v2'`,
      );
      await firstPool.query(
        `DELETE FROM issue255_live_generation_authorizations
          WHERE run_nonce = 'issue-255-live-anchors-2026-07-30-v2'`,
      );
      await firstPool.query(
        `DELETE FROM workspaces
          WHERE id = 'issue-255-live-1165ded3ff521938de15da91'`,
      );
      await firstPool.query(
        `DELETE FROM issue255_live_generation_receipts
          WHERE run_nonce = 'issue-255-live-anchors-2026-07-30-v1'`,
      );
      await firstPool.query(
        `DELETE FROM issue255_live_generation_authorizations
          WHERE run_nonce = 'issue-255-live-anchors-2026-07-30-v1'`,
      );
      await firstPool.query(
        `DELETE FROM workspaces
          WHERE id = 'issue-255-live-fd117da50a1e2d3d15ac5976'`,
      );
      await firstPool.query(
        `DELETE FROM issue255_live_generation_receipts
          WHERE run_nonce = 'issue-255-live-anchors-2026-07-30-v3'`,
      );
      await firstPool.query(
        `DELETE FROM issue255_live_generation_authorizations
          WHERE run_nonce = 'issue-255-live-anchors-2026-07-30-v3'`,
      );
      await firstPool.query(
        `DELETE FROM workspaces
          WHERE id = 'issue-255-live-0e36ff28fe9e880c0ecaf7b9'`,
      );
      await firstPool.query(
        'DELETE FROM issue255_live_generation_receipts WHERE run_nonce LIKE $1',
        [`issue-255-pg-${suiteNonce}-%`],
      );
      await firstPool.query(
        'DELETE FROM issue255_live_generation_authorizations WHERE run_nonce LIKE $1',
        [`issue-255-pg-${suiteNonce}-%`],
      );
      await firstPool.query(
        'DELETE FROM workspaces WHERE id LIKE $1',
        [`issue-255-workspace-${suiteNonce}%`],
      );
    });

    after(async () => {
      await firstPool.query(
        `DELETE FROM issue255_live_generation_receipts
          WHERE run_nonce = 'issue-255-live-anchors-2026-07-30-v2'`,
      );
      await firstPool.query(
        `DELETE FROM issue255_live_generation_authorizations
          WHERE run_nonce = 'issue-255-live-anchors-2026-07-30-v2'`,
      );
      await firstPool.query(
        `DELETE FROM workspaces
          WHERE id = 'issue-255-live-1165ded3ff521938de15da91'`,
      );
      await firstPool.query(
        `DELETE FROM issue255_live_generation_receipts
          WHERE run_nonce = 'issue-255-live-anchors-2026-07-30-v1'`,
      );
      await firstPool.query(
        `DELETE FROM issue255_live_generation_authorizations
          WHERE run_nonce = 'issue-255-live-anchors-2026-07-30-v1'`,
      );
      await firstPool.query(
        `DELETE FROM workspaces
          WHERE id = 'issue-255-live-fd117da50a1e2d3d15ac5976'`,
      );
      await firstPool.query(
        'DELETE FROM issue255_live_generation_receipts WHERE run_nonce LIKE $1',
        [`issue-255-pg-${suiteNonce}-%`],
      );
      await firstPool.query(
        'DELETE FROM issue255_live_generation_authorizations WHERE run_nonce LIKE $1',
        [`issue-255-pg-${suiteNonce}-%`],
      );
      await firstPool.query(
        'DELETE FROM workspaces WHERE id LIKE $1',
        [`issue-255-workspace-${suiteNonce}%`],
      );
      const residue = await firstPool.query<{ count: number }>(
        `SELECT (
           (SELECT COUNT(*)
              FROM issue255_live_generation_receipts
             WHERE run_nonce LIKE $1) +
           (SELECT COUNT(*)
              FROM issue255_live_generation_authorizations
             WHERE run_nonce LIKE $1) +
           (SELECT COUNT(*)
              FROM workspaces
             WHERE id LIKE $2) +
           (SELECT COUNT(*)
              FROM p1_generation_jobs
             WHERE workspace_id LIKE $2) +
           (SELECT COUNT(*)
              FROM p1_provider_attempts
             WHERE workspace_id LIKE $2) +
           (SELECT COUNT(*)
              FROM p1_provider_cost_events
             WHERE workspace_id LIKE $2)
         )::int AS count`,
        [
          `issue-255-pg-${suiteNonce}-%`,
          `issue-255-workspace-${suiteNonce}%`,
        ],
      );
      assert.equal(residue.rows[0]?.count, 0);
      await Promise.all([firstPool.end(), secondPool.end()]);
    });

    it('migrates frozen workspace and provider lineage columns as non-null unique facts', async () => {
      const columns = await firstPool.query<{
        column_name: string;
        is_nullable: 'NO' | 'YES';
      }>(
        `SELECT column_name, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'issue255_live_generation_receipts'
            AND column_name IN (
              'workspace_id',
              'provider_job_id',
              'provider_attempt_id',
              'provider_cost_event_id',
              'failure_error_code',
              'failure_error_message',
              'provider_http_status'
            )
          ORDER BY column_name`,
      );
      assert.deepEqual(
        columns.rows,
        [
          { column_name: 'failure_error_code', is_nullable: 'YES' },
          { column_name: 'failure_error_message', is_nullable: 'YES' },
          { column_name: 'provider_attempt_id', is_nullable: 'NO' },
          { column_name: 'provider_cost_event_id', is_nullable: 'NO' },
          { column_name: 'provider_http_status', is_nullable: 'YES' },
          { column_name: 'provider_job_id', is_nullable: 'NO' },
          { column_name: 'workspace_id', is_nullable: 'NO' },
        ],
      );

      const indexes = await firstPool.query<{ indexdef: string }>(
        `SELECT indexdef
           FROM pg_indexes
          WHERE schemaname = 'public'
            AND tablename = 'issue255_live_generation_receipts'`,
      );
      for (const column of [
        'provider_job_id',
        'provider_attempt_id',
        'provider_cost_event_id',
      ]) {
        assert.equal(
          indexes.rows.some(
            ({ indexdef }) =>
              indexdef.includes('UNIQUE') &&
              indexdef.includes(`(${column})`),
          ),
          true,
          `${column} must have a receipt-level unique index`,
        );
      }
      const authorizationColumns = await firstPool.query<{
        column_name: string;
        is_nullable: 'NO' | 'YES';
      }>(
        `SELECT column_name, is_nullable
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'issue255_live_generation_authorizations'
            AND column_name IN (
              'effect_id',
              'run_nonce',
              'modality',
              'reserved_amount_micros'
            )
          ORDER BY column_name`,
      );
      assert.deepEqual(
        authorizationColumns.rows,
        [
          { column_name: 'effect_id', is_nullable: 'NO' },
          { column_name: 'modality', is_nullable: 'NO' },
          { column_name: 'reserved_amount_micros', is_nullable: 'NO' },
          { column_name: 'run_nonce', is_nullable: 'NO' },
        ],
      );
    });

    it('backfills three legacy submitted receipts, permits through the sixth, and rejects a seventh claim', async () => {
      const legacyRunPrefix =
        `issue-255-pg-${suiteNonce}-legacy-three`;
      await firstPool.query(
        'DROP TABLE issue255_live_generation_authorizations',
      );
      for (const index of [1, 2, 3]) {
        await insertLegacyReceipt({
          runNonce: `${legacyRunPrefix}-${index}`,
          modality: 'copy',
          generationSubmitCount: 1,
          reservedAmountMicros: 100_000,
        });
      }

      await first.migrate();

      const fourthRunNonce = `${legacyRunPrefix}-4`;
      const fourthClaim = copyClaim(fourthRunNonce);
      await first.claim(fourthClaim);
      await first.claimGenerationPost({
        adapter: fourthClaim.adapter,
        deploymentId: fourthClaim.deploymentId,
        runNonce: fourthClaim.runNonce,
        modality: fourthClaim.modality,
        effectId: fourthClaim.effectId,
        providerIdempotencyKey: fourthClaim.providerIdempotencyKey,
        requestFingerprint: fourthClaim.requestFingerprint,
      });
      const fifthRunNonce = `${legacyRunPrefix}-5`;
      const fifthClaim = copyClaim(fifthRunNonce);
      await first.claim(fifthClaim);
      await first.claimGenerationPost({
        adapter: fifthClaim.adapter,
        deploymentId: fifthClaim.deploymentId,
        runNonce: fifthClaim.runNonce,
        modality: fifthClaim.modality,
        effectId: fifthClaim.effectId,
        providerIdempotencyKey: fifthClaim.providerIdempotencyKey,
        requestFingerprint: fifthClaim.requestFingerprint,
      });
      const sixthRunNonce = `${legacyRunPrefix}-6`;
      const sixthClaim = copyClaim(sixthRunNonce);
      await first.claim(sixthClaim);
      await first.claimGenerationPost({
        adapter: sixthClaim.adapter,
        deploymentId: sixthClaim.deploymentId,
        runNonce: sixthClaim.runNonce,
        modality: sixthClaim.modality,
        effectId: sixthClaim.effectId,
        providerIdempotencyKey: sixthClaim.providerIdempotencyKey,
        requestFingerprint: sixthClaim.requestFingerprint,
      });
      const seventhRunNonce = `${legacyRunPrefix}-7`;
      await assert.rejects(
        first.claim(copyClaim(seventhRunNonce)),
        /exactly six billable generation POSTs/u,
      );
      const history = await firstPool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
           FROM issue255_live_generation_authorizations
          WHERE run_nonce LIKE $1`,
        [`${legacyRunPrefix}-%`],
      );
      assert.equal(history.rows[0]?.count, 6);
    });

    it('hands the durable live owner from v4 to the coordinator v5 retry', async () => {
      const v4RunNonce = 'issue-255-live-anchors-2026-07-30-v4';
      const v5RunNonce = 'issue-255-live-anchors-2026-07-30-v5';
      await firstPool.query(
        `INSERT INTO issue255_live_run_owners (singleton_key, run_nonce)
         VALUES (true, $1)`,
        [v4RunNonce],
      );

      assert.equal(await first.claimOrResumeLiveRunOwner(v5RunNonce), 'fresh');
      assert.equal(await first.claimOrResumeLiveRunOwner(v5RunNonce), 'resumed');
      const owner = await firstPool.query<{ run_nonce: string }>(
        `SELECT run_nonce
           FROM issue255_live_run_owners
          WHERE singleton_key = true`,
      );
      assert.equal(owner.rows[0]?.run_nonce, v5RunNonce);
    });

    it('migrates only submitted legacy receipts idempotently without double-counting budget', async () => {
      const submittedRunNonce =
        `issue-255-pg-${suiteNonce}-legacy-one`;
      const pendingRunNonce =
        `issue-255-pg-${suiteNonce}-legacy-zero`;

      await firstPool.query(
        'DROP TABLE issue255_live_generation_authorizations',
      );
      const submittedEffectId = await insertLegacyReceipt({
        runNonce: submittedRunNonce,
        modality: 'video',
        generationSubmitCount: 1,
        reservedAmountMicros: 3_000_000,
      });
      await insertLegacyReceipt({
        runNonce: pendingRunNonce,
        modality: 'copy',
        generationSubmitCount: 0,
        reservedAmountMicros: 100_000,
      });

      await first.migrate();
      await first.migrate();

      const history = await firstPool.query<{
        effect_id: string;
        run_nonce: string;
        reserved_amount_micros: string;
      }>(
        `SELECT effect_id, run_nonce, reserved_amount_micros
           FROM issue255_live_generation_authorizations
          WHERE run_nonce LIKE $1`,
        [`issue-255-pg-${suiteNonce}-legacy-%`],
      );
      assert.deepEqual(history.rows, [
        {
          effect_id: submittedEffectId,
          run_nonce: submittedRunNonce,
          reserved_amount_micros: '3000000',
        },
      ]);

      const nextEffectId = createHash('sha256')
        .update(`issue255/v1\0${submittedRunNonce}\0copy`)
        .digest('hex');
      assert.equal(
        (await first.claim(copyClaim(submittedRunNonce))).kind,
        'claimed',
      );
      assert.equal(
        (await first.listRun(submittedRunNonce))[1]?.effectId,
        nextEffectId,
      );
    });

    it('fails closed when legacy receipt identity conflicts with authorization history', async () => {
      const runNonce =
        `issue-255-pg-${suiteNonce}-legacy-identity-conflict`;
      await insertLegacyReceipt({
        runNonce,
        modality: 'copy',
        generationSubmitCount: 1,
        reservedAmountMicros: 100_000,
      });
      await first.migrate();
      await firstPool.query(
        `UPDATE issue255_live_generation_receipts
            SET request_fingerprint = $2
          WHERE run_nonce = $1`,
        [runNonce, '4'.repeat(64)],
      );

      await assert.rejects(
        first.migrate(),
        /legacy authorization identity conflict/iu,
      );
    });

    it('fails closed when a submitted legacy receipt lacks required provider lineage', async () => {
      const runNonce =
        `issue-255-pg-${suiteNonce}-legacy-missing-lineage`;
      await firstPool.query(`
        ALTER TABLE issue255_live_generation_receipts
        ALTER COLUMN provider_job_id DROP NOT NULL
      `);
      await insertLegacyReceipt({
        runNonce,
        modality: 'copy',
        generationSubmitCount: 1,
        reservedAmountMicros: 100_000,
        providerJobId: null,
      });

      try {
        await assert.rejects(
          first.migrate(),
          /refuses legacy receipts without frozen lineage/iu,
        );
      } finally {
        await firstPool.query(
          'DELETE FROM issue255_live_generation_receipts WHERE run_nonce = $1',
          [runNonce],
        );
        await first.migrate();
      }
    });

    it('allows only one cross-process claim for the same generation effect', async () => {
      const runNonce = `issue-255-pg-${suiteNonce}-same-effect`;
      const effectId = createHash('sha256')
        .update(`issue255/v1\0${runNonce}\0copy`)
        .digest('hex');
      const requestFingerprint = createHash('sha256')
        .update('issue-255-copy-request-v1')
        .digest('hex');
      const input = {
        workspaceId: receiptWorkspaceId,
        runNonce,
        modality: 'copy' as const,
        effectId,
        requestFingerprint,
        adapter: 'direct-copy',
        deploymentId: 'deepseek-v4-pro-direct',
        providerIdempotencyKey: effectId,
        providerJobId: `${effectId}:job`,
        providerAttemptId: `${effectId}:attempt`,
        providerCostEventId: `${effectId}:cost`,
        recordedMatrixDigest: 'a'.repeat(64),
        reservedAmountMicros: 100_000,
        priceRevision: 'direct-copy-price-v1',
        exchangeRevision: 'native-cny-v1',
      };

      const results = await Promise.allSettled([
        first.claim(input),
        second.claim(input),
      ]);

      assert.equal(
        results.filter(
          (result) =>
            result.status === 'fulfilled' && result.value.kind === 'claimed',
        ).length,
        1,
      );
      assert.equal((await first.listRun(runNonce))[0]?.workspaceId, receiptWorkspaceId);
      assert.equal(
        results.filter(
          (result) =>
            result.status === 'rejected' &&
            /already claimed|reconciliation/u.test(String(result.reason)),
        ).length,
        1,
      );
    });

    it('preserves the winning reservation when different modalities claim concurrently', async () => {
      const runNonce = `issue-255-pg-${suiteNonce}-different-modalities`;
      const requestFingerprint = createHash('sha256')
        .update('issue-255-concurrent-modality-request-v1')
        .digest('hex');
      const claim = (
        modality: 'copy' | 'image_text',
        reservedAmountMicros: number,
      ) => {
        const effectId = createHash('sha256')
          .update(`issue255/v1\0${runNonce}\0${modality}`)
          .digest('hex');
        return {
          workspaceId: receiptWorkspaceId,
          runNonce,
          modality,
          effectId,
          requestFingerprint,
          adapter: modality === 'copy' ? 'direct-copy' : 'tuzi-image',
          deploymentId:
            modality === 'copy'
              ? 'deepseek-v4-pro-direct'
              : 'gpt-image-2-tuzi-relay',
          providerIdempotencyKey: effectId,
          providerJobId: `${effectId}:job`,
          providerAttemptId: `${effectId}:attempt`,
          providerCostEventId: `${effectId}:cost`,
          recordedMatrixDigest: 'b'.repeat(64),
          reservedAmountMicros,
          priceRevision: `${modality}-price-v1`,
          exchangeRevision: 'native-cny-v1',
        };
      };

      const results = await Promise.allSettled([
        first.claim(claim('copy', 100_000)),
        second.claim(claim('image_text', 500_000)),
      ]);
      const receipts = await first.listRun(runNonce);

      assert.equal(
        results.filter((result) => result.status === 'fulfilled').length,
        1,
      );
      assert.equal(receipts.length, 1);
      assert.equal(receipts[0]?.status, 'claimed');
      assert.equal(
        receipts[0]?.reservedAmountMicros,
        receipts[0]?.modality === 'copy' ? 100_000 : 500_000,
      );
    });

    it('rejects a fingerprint conflict for an existing stable effect', async () => {
      const runNonce = `issue-255-pg-${suiteNonce}-fingerprint-conflict`;
      const effectId = createHash('sha256')
        .update(`issue255/v1\0${runNonce}\0copy`)
        .digest('hex');
      const input = {
        workspaceId: receiptWorkspaceId,
        runNonce,
        modality: 'copy' as const,
        effectId,
        requestFingerprint: 'c'.repeat(64),
        adapter: 'direct-copy',
        deploymentId: 'deepseek-v4-pro-direct',
        providerIdempotencyKey: effectId,
        providerJobId: `${effectId}:job`,
        providerAttemptId: `${effectId}:attempt`,
        providerCostEventId: `${effectId}:cost`,
        recordedMatrixDigest: 'd'.repeat(64),
        reservedAmountMicros: 100_000,
        priceRevision: 'direct-copy-price-v1',
        exchangeRevision: 'native-cny-v1',
      };
      await first.claim(input);

      await assert.rejects(
        second.claim({
          ...input,
          requestFingerprint: 'e'.repeat(64),
        }),
        /fingerprint conflict/u,
      );
    });

    it('keeps an unknown reservation and blocks every automatic reclaim in the run', async () => {
      const runNonce = `issue-255-pg-${suiteNonce}-unknown-freeze`;
      const copyEffectId = createHash('sha256')
        .update(`issue255/v1\0${runNonce}\0copy`)
        .digest('hex');
      const copy = {
        workspaceId: receiptWorkspaceId,
        runNonce,
        modality: 'copy' as const,
        effectId: copyEffectId,
        requestFingerprint: 'f'.repeat(64),
        adapter: 'direct-copy',
        deploymentId: 'deepseek-v4-pro-direct',
        providerIdempotencyKey: copyEffectId,
        providerJobId: `${copyEffectId}:job`,
        providerAttemptId: `${copyEffectId}:attempt`,
        providerCostEventId: `${copyEffectId}:cost`,
        recordedMatrixDigest: '1'.repeat(64),
        reservedAmountMicros: 100_000,
        priceRevision: 'direct-copy-price-v1',
        exchangeRevision: 'native-cny-v1',
      };
      await first.claim(copy);
      await assert.rejects(
        first.markUnknown({
          runNonce,
          modality: 'copy',
          effectId: copy.effectId,
          requestFingerprint: copy.requestFingerprint,
          reason: 'provider_acceptance_unknown',
        }),
        /submitted generation/u,
      );
      await first.claimGenerationPost({
        adapter: 'direct-copy',
        deploymentId: copy.deploymentId,
        runNonce,
        modality: 'copy',
        effectId: copy.effectId,
        providerIdempotencyKey: copy.providerIdempotencyKey,
        requestFingerprint: copy.requestFingerprint,
      });
      await first.markUnknown({
        runNonce,
        modality: 'copy',
        effectId: copy.effectId,
        requestFingerprint: copy.requestFingerprint,
        reason: 'provider_acceptance_unknown',
      });

      await assert.rejects(first.claim(copy), /unknown.*reconciliation/u);
      const imageEffectId = createHash('sha256')
        .update(`issue255/v1\0${runNonce}\0image_text`)
        .digest('hex');
      await assert.rejects(
        second.claim({
          ...copy,
          modality: 'image_text',
          effectId: imageEffectId,
          providerIdempotencyKey: imageEffectId,
          providerJobId: `${imageEffectId}:job`,
          providerAttemptId: `${imageEffectId}:attempt`,
          providerCostEventId: `${imageEffectId}:cost`,
          adapter: 'tuzi-image',
          deploymentId: 'gpt-image-2-tuzi-relay',
          requestFingerprint: '2'.repeat(64),
          reservedAmountMicros: 500_000,
          priceRevision: 'tuzi-image-price-v1',
        }),
        /unknown.*reconciliation/u,
      );

      const receipts = await first.listRun(runNonce);
      assert.equal(receipts.length, 1);
      assert.equal(receipts[0]?.status, 'unknown');
      assert.equal(receipts[0]?.reservedAmountMicros, 100_000);
    });

    it('rejects a second generation POST before the provider fetch boundary', async () => {
      const runNonce = `issue-255-pg-${suiteNonce}-post-fence`;
      const effectId = createHash('sha256')
        .update(`issue255/v1\0${runNonce}\0copy`)
        .digest('hex');
      const requestFingerprint = '3'.repeat(64);
      await first.claim({
        workspaceId: receiptWorkspaceId,
        runNonce,
        modality: 'copy',
        effectId,
        requestFingerprint,
        adapter: 'direct-copy',
        deploymentId: 'deepseek-v4-pro-direct',
        providerIdempotencyKey: effectId,
        providerJobId: `${effectId}:job`,
        providerAttemptId: `${effectId}:attempt`,
        providerCostEventId: `${effectId}:cost`,
        recordedMatrixDigest: '4'.repeat(64),
        reservedAmountMicros: 100_000,
        priceRevision: 'direct-copy-price-v1',
        exchangeRevision: 'native-cny-v1',
      });
      let providerFetchCount = 0;
      const post = async () => {
        await second.claimGenerationPost({
          adapter: 'direct-copy',
          deploymentId: 'deepseek-v4-pro-direct',
          runNonce,
          modality: 'copy' as const,
          effectId,
          providerIdempotencyKey: effectId,
          requestFingerprint,
        });
        providerFetchCount += 1;
      };

      await post();
      await assert.rejects(post(), /generation POST.*already fenced/u);
      assert.equal(providerFetchCount, 1);
      assert.equal(
        (await first.listRun(runNonce))[0]?.generationSubmitCount,
        1,
      );
    });

    it('distinguishes pre-network rejection from provider acceptance unknown', async () => {
      const claim = async (
        suffix: string,
        requestFingerprint: string,
      ) => {
        const runNonce =
          `issue-255-pg-${suiteNonce}-failure-${suffix}`;
        const effectId = createHash('sha256')
          .update(`issue255/v1\0${runNonce}\0copy`)
          .digest('hex');
        await first.claim({
          workspaceId: receiptWorkspaceId,
          runNonce,
          modality: 'copy',
          effectId,
          requestFingerprint,
          adapter: 'direct-copy',
          deploymentId: 'deepseek-v4-pro-direct',
          providerIdempotencyKey: effectId,
          providerJobId: `${effectId}:job`,
          providerAttemptId: `${effectId}:attempt`,
          providerCostEventId: `${effectId}:cost`,
          recordedMatrixDigest: '5'.repeat(64),
          reservedAmountMicros: 100_000,
          priceRevision: 'direct-copy-price-v1',
          exchangeRevision: 'native-cny-v1',
        });
        return { effectId, requestFingerprint, runNonce };
      };

      const rejected = await claim('rejected', '5'.repeat(64));
      assert.deepEqual(
        await first.recordExecutionFailure({
          ...rejected,
          modality: 'copy',
          errorCode: 'collector_execution_error',
          errorMessage: 'Provider execution failed before network.',
        }),
        { kind: 'rejected_before_accept' },
      );
      assert.equal((await first.listRun(rejected.runNonce)).length, 0);

      const unknown = await claim('unknown', '6'.repeat(64));
      await first.claimGenerationPost({
        adapter: 'direct-copy',
        deploymentId: 'deepseek-v4-pro-direct',
        ...unknown,
        modality: 'copy',
        providerIdempotencyKey: unknown.effectId,
      });
      const classified = await first.recordExecutionFailure({
        ...unknown,
        modality: 'copy',
        errorCode: 'collector_execution_error',
        errorMessage: 'Provider connection ended without a response.',
      });
      assert.equal(classified.kind, 'provider_acceptance_unknown');
      const [unknownReceipt] = await first.listRun(unknown.runNonce);
      assert.equal(unknownReceipt?.status, 'unknown');
      assert.equal(
        unknownReceipt?.reconciliationReason,
        'provider_acceptance_unknown',
      );

      const providerFailure = await claim('provider', '7'.repeat(64));
      const providerIdentity = {
        adapter: 'direct-copy' as const,
        deploymentId: 'deepseek-v4-pro-direct',
        ...providerFailure,
        modality: 'copy' as const,
        providerIdempotencyKey: providerFailure.effectId,
      };
      await first.claimGenerationPost(providerIdentity);
      await first.recordProviderHttpResponse({
        ...providerIdentity,
        httpStatus: 422,
      });
      const recorded = await first.recordExecutionFailure({
        ...providerFailure,
        modality: 'copy',
        errorCode: 'INVALID SECONDS',
        errorMessage:
          'Rejected request api_key=secret-value Bearer secret-token https://provider.example/private',
      });
      assert.equal(recorded.kind, 'provider_failure_recorded');
      const [failedReceipt] = await first.listRun(providerFailure.runNonce);
      assert.equal(failedReceipt?.status, 'unknown');
      assert.equal(failedReceipt?.providerHttpStatus, 422);
      assert.equal(failedReceipt?.failureErrorCode, 'invalid_seconds');
      assert.equal(
        failedReceipt?.reconciliationReason,
        'provider_failure_recorded',
      );
      assert.equal(failedReceipt?.failureErrorMessage?.includes('secret'), false);
      assert.match(failedReceipt?.failureErrorMessage ?? '', /\[redacted/u);
    });

    it('persists the accepted provider task id without losing the internal job id', async () => {
      const runNonce = `issue-255-pg-${suiteNonce}-provider-task`;
      const claim = copyClaim(runNonce);
      await first.claim(claim);
      await first.claimGenerationPost({
        adapter: 'direct-copy',
        deploymentId: claim.deploymentId,
        runNonce,
        modality: 'copy',
        effectId: claim.effectId,
        providerIdempotencyKey: claim.providerIdempotencyKey,
        requestFingerprint: claim.requestFingerprint,
      });

      await first.bindAcceptedProviderTask({
        runNonce,
        modality: 'copy',
        effectId: claim.effectId,
        requestFingerprint: claim.requestFingerprint,
        providerTaskId: 'cgt-provider-task-255',
      });
      await first.bindAcceptedProviderTask({
        runNonce,
        modality: 'copy',
        effectId: claim.effectId,
        requestFingerprint: claim.requestFingerprint,
        providerTaskId: 'cgt-provider-task-255',
      });

      const [receipt] = await first.listRun(runNonce);
      assert.equal(receipt?.providerJobId, claim.providerJobId);
      assert.equal(receipt?.providerTaskId, 'cgt-provider-task-255');
      await assert.rejects(
        first.bindAcceptedProviderTask({
          runNonce,
          modality: 'copy',
          effectId: claim.effectId,
          requestFingerprint: claim.requestFingerprint,
          providerTaskId: 'cgt-conflicting-task-255',
        }),
        /provider task id.*immutable/u,
      );
    });

    it('persists bounded redacted provider response evidence for polling failures', async () => {
      const runNonce = `issue-255-pg-${suiteNonce}-poll-evidence`;
      const claim = copyClaim(runNonce);
      await first.claim(claim);
      await first.claimGenerationPost({
        adapter: 'direct-copy',
        deploymentId: claim.deploymentId,
        runNonce,
        modality: 'copy',
        effectId: claim.effectId,
        providerIdempotencyKey: claim.providerIdempotencyKey,
        requestFingerprint: claim.requestFingerprint,
      });
      await first.recordExecutionFailure({
        runNonce,
        modality: 'copy',
        effectId: claim.effectId,
        requestFingerprint: claim.requestFingerprint,
        errorCode: 'invalid_response',
        errorMessage:
          'Ark video task polling returned an invalid response. provider_evidence={"id":"cgt-255","status":"mystery","api_key":"[REDACTED]","detail":"' +
          'x'.repeat(4_000) +
          '"}',
      });

      const [receipt] = await first.listRun(runNonce);
      assert.equal(receipt?.failureErrorCode, 'invalid_response');
      assert.match(receipt?.failureErrorMessage ?? '', /"status":"mystery"/u);
      assert.doesNotMatch(receipt?.failureErrorMessage ?? '', /api-key-secret/u);
      assert.ok((receipt?.failureErrorMessage?.length ?? 0) <= 500);
    });

    it('preserves and reclassifies a durably proven rejected-before-accept submission', async () => {
      const foundation = new PostgresFoundationRepository(firstPool);
      const candidate = await failedBeforeBillingCandidate({
        pending: true,
        requestFingerprint:
          '5a6b64ab43bf5fcc8ac2f2a466d8e04bc86af5f779a17210c6a448c07e6c46ed',
        runNonce: 'issue-255-live-anchors-2026-07-30-v1',
        suffix: 'confirmed',
      });

      const [receipt] = await reconcileIssue255LiveRun({
        foundation,
        receipts: first,
        runNonce: candidate.runNonce,
      });

      assert.equal(receipt?.status, 'failed_before_billing');
      assert.equal(receipt?.actualAmountMicros, 0);
      assert.equal(
        receipt?.reconciliationReason,
        'provider_rejected_before_accept',
      );
      assert.deepEqual(receipt?.terminalLineage, {
        workspaceId: candidate.workspaceId,
        effectId: candidate.claim.effectId,
        requestFingerprint: candidate.claim.requestFingerprint,
        adapter: candidate.claim.adapter,
        deploymentId: candidate.claim.deploymentId,
        providerIdempotencyKey: candidate.claim.effectId,
        attempt: {
          id: candidate.claim.providerAttemptId,
          jobId: candidate.claim.providerJobId,
          deploymentId: candidate.claim.deploymentId,
          acceptance: 'rejected_before_accept',
          status: 'failed',
        },
        failure: {
          reason: 'provider_rejected_before_accept',
          source: 'provider_execution_terminal',
          provenance: {
            kind: 'merge_ledger',
            commitSha:
              '695489fe441178431394bb320ad779b28cb9f654',
          },
        },
        providerCost: {
          eventCount: 0,
          amountMicros: 0,
          currency: 'CNY',
        },
      });
      const durable = await firstPool.query<{
        authorizations: number;
        receipts: number;
      }>(
        `SELECT
           (SELECT COUNT(*) FROM issue255_live_generation_authorizations
             WHERE run_nonce = $1)::int AS authorizations,
           (SELECT COUNT(*) FROM issue255_live_generation_receipts
             WHERE run_nonce = $1)::int AS receipts`,
        [candidate.runNonce],
      );
      assert.deepEqual(durable.rows[0], { authorizations: 1, receipts: 1 });
      assert.equal(
        (
          await foundation.getProviderAttempt(
            candidate.workspaceId,
            candidate.claim.providerAttemptId,
          )
        )?.acceptance,
        'rejected_before_accept',
      );
      assert.equal(
        (
          await foundation.getGenerationJob(
            candidate.workspaceId,
            candidate.claim.providerJobId,
          )
        )?.status,
        'failed',
      );
    });

    it('reconciles the frozen v3 duration rejection as failed before billing', async () => {
      const foundation = new PostgresFoundationRepository(firstPool);
      const claim = await coordinatorV3Candidate(
        '{"message":"{\\"error\\":{\\"code\\":\\"InvalidParameter\\",\\"message\\":\\"The parameter `contents[0].***.duration` specified in the request is not valid: the specified duration is not supported for model doubao-seedance-1-5-pro.\\",\\"param\\":\\"contents[0].***.duration\\",\\"type\\":\\"BadRequest\\"}}","data":{"code":400}}',
      );

      const [receipt] = await reconcileIssue255LiveRun({
        foundation,
        receipts: first,
        runNonce: claim.runNonce,
      });

      assert.equal(receipt?.status, 'failed_before_billing');
      assert.equal(receipt?.generationSubmitCount, 1);
      assert.equal(receipt?.providerHttpRequestCount, 1);
      assert.equal(receipt?.providerHttpStatus, 451);
      assert.equal(receipt?.actualAmountMicros, 0);
      const lineage = receipt?.terminalLineage;
      assert.ok(lineage && 'failure' in lineage);
      assert.equal(lineage.providerCost.eventCount, 0);
      assert.deepEqual(lineage.failure.provenance, {
        kind: 'durable_provider_http',
        httpStatus: 451,
        upstreamStatus: 400,
        errorCode: 'invalid_request',
        messageSha256: createHash('sha256')
          .update(receipt.failureErrorMessage!)
          .digest('hex'),
      });
      const attempt = await foundation.getProviderAttempt(
        claim.workspaceId,
        claim.providerAttemptId,
      );
      assert.equal(attempt?.acceptance, 'rejected_before_accept');
      assert.equal(attempt?.status, 'failed');
      assert.equal(
        (await foundation.getGenerationJob(claim.workspaceId, claim.providerJobId))
          ?.status,
        'failed',
      );
      const authorization = await firstPool.query<{ status: string }>(
        `SELECT status
           FROM issue255_live_generation_authorizations
          WHERE effect_id = $1`,
        [claim.effectId],
      );
      assert.equal(authorization.rows[0]?.status, 'failed_before_billing');
    });

    it('refuses v3 reconciliation without the frozen upstream duration rejection', async () => {
      const foundation = new PostgresFoundationRepository(firstPool);
      const claim = await coordinatorV3Candidate(
        '{"message":"upstream temporarily unavailable","data":{"code":400}}',
      );

      await assert.rejects(
        reconcileIssue255LiveRun({
          foundation,
          receipts: first,
          runNonce: claim.runNonce,
        }),
        /trusted duration rejection/u,
      );

      assert.equal((await first.listRun(claim.runNonce))[0]?.status, 'unknown');
      const attempt = await foundation.getProviderAttempt(
        claim.workspaceId,
        claim.providerAttemptId,
      );
      assert.equal(attempt?.acceptance, 'pending');
      assert.equal(attempt?.status, 'pending');
    });

    it('reconciles only the fixed v2 accepted image lineage without inventing a provider task ref', async () => {
      const foundation = new PostgresFoundationRepository(firstPool);
      const claim = await legacyImageCandidate();

      const [receipt] = await reconcileIssue255LiveRun({
        foundation,
        receipts: first,
        runNonce: claim.runNonce,
      });

      assert.equal(receipt?.status, 'completed');
      assert.equal(receipt?.actualAmountMicros, 50_000);
      assert.equal(
        receipt?.reconciliationReason,
        'tuzi_image_price_card_reconciled',
      );
      assert.deepEqual(receipt?.terminalLineage?.attempt, {
        id: claim.providerAttemptId,
        jobId: claim.providerJobId,
        deploymentId: claim.deploymentId,
        acceptance: 'accepted',
        status: 'completed',
        providerTaskRefMissing: true,
      });
      assert.deepEqual(receipt?.terminalLineage?.providerCost, {
        id: claim.providerCostEventId,
        attemptId: claim.providerAttemptId,
        amountMicros: 50_000,
        currency: 'CNY',
        priceRevision: claim.priceRevision,
        exchangeRevision: 'native-cny-v1',
        stage: 'reconciled',
        usageEvidenceKind: 'price_card_reconciled',
        usage: { mediaUnits: 1 },
      });
      assert.ok(
        receipt?.terminalLineage &&
          'reconciliation' in receipt.terminalLineage,
      );
      assert.deepEqual(receipt.terminalLineage.reconciliation, {
        kind: 'controller_issue_comment',
        issue: 255,
        commentId: 5130611933,
        reason: 'accepted_image_task_ref_not_persisted',
      });
      const attempt = await foundation.getProviderAttempt(
        claim.workspaceId,
        claim.providerAttemptId,
      );
      assert.equal(attempt?.acceptance, 'accepted');
      assert.equal(attempt?.status, 'completed');
      assert.equal(attempt?.providerTaskRef, null);
      const costs = await foundation.listProviderCosts(
        claim.workspaceId,
        claim.providerAttemptId,
      );
      assert.deepEqual(
        costs.map((cost) => [cost.stage, cost.amountMicros, cost.currency]),
        [['reconciled', 50_000, 'CNY']],
      );
    });

    it('refuses the fixed v2 image reconciliation when a durable task ref exists', async () => {
      const foundation = new PostgresFoundationRepository(firstPool);
      const claim = await legacyImageCandidate();
      await firstPool.query(
        `UPDATE p1_provider_attempts
            SET provider_task_ref = 'durable-image-task-ref'
          WHERE workspace_id = $1 AND id = $2`,
        [claim.workspaceId, claim.providerAttemptId],
      );

      await assert.rejects(
        reconcileIssue255LiveRun({
          foundation,
          receipts: first,
          runNonce: claim.runNonce,
        }),
        /frozen v2 lineage/u,
      );
      assert.equal((await first.listRun(claim.runNonce))[0]?.status, 'unknown');
    });

    it('refuses failed-before-billing reclassification for billed, accepted, or untrusted terminals', async () => {
      const foundation = new PostgresFoundationRepository(firstPool);
      const billed = await failedBeforeBillingCandidate({
        suffix: 'billed',
        amountMicros: 1,
      });
      await assert.rejects(
        first.confirmFailedBeforeBilling(billed.runNonce, foundation),
        /zero durable provider cost/u,
      );

      const accepted = await failedBeforeBillingCandidate({
        suffix: 'accepted',
        acceptance: 'accepted',
      });
      await assert.rejects(
        first.confirmFailedBeforeBilling(accepted.runNonce, foundation),
        /rejected-before-accept terminal/u,
      );

      const untrusted = await failedBeforeBillingCandidate({
        suffix: 'untrusted',
        acceptance: 'pending',
      });
      await assert.rejects(
        first.confirmFailedBeforeBilling(untrusted.runNonce, foundation),
        /rejected-before-accept terminal/u,
      );

      for (const candidate of [billed, accepted, untrusted]) {
        assert.equal(
          (await first.listRun(candidate.runNonce))[0]?.status,
          'unknown',
        );
      }
      const fourthRunNonce =
        `issue-255-pg-${suiteNonce}-failed-before-billing-fourth`;
      const fourthClaim = copyClaim(fourthRunNonce);
      await first.claim(fourthClaim);
      await first.claimGenerationPost({
        adapter: fourthClaim.adapter,
        deploymentId: fourthClaim.deploymentId,
        runNonce: fourthClaim.runNonce,
        modality: fourthClaim.modality,
        effectId: fourthClaim.effectId,
        providerIdempotencyKey: fourthClaim.providerIdempotencyKey,
        requestFingerprint: fourthClaim.requestFingerprint,
      });
      const fifthRunNonce =
        `issue-255-pg-${suiteNonce}-failed-before-billing-fifth`;
      const fifthClaim = copyClaim(fifthRunNonce);
      await first.claim(fifthClaim);
      await first.claimGenerationPost({
        adapter: fifthClaim.adapter,
        deploymentId: fifthClaim.deploymentId,
        runNonce: fifthClaim.runNonce,
        modality: fifthClaim.modality,
        effectId: fifthClaim.effectId,
        providerIdempotencyKey: fifthClaim.providerIdempotencyKey,
        requestFingerprint: fifthClaim.requestFingerprint,
      });
      const sixthRunNonce =
        `issue-255-pg-${suiteNonce}-failed-before-billing-sixth`;
      const sixthClaim = copyClaim(sixthRunNonce);
      await first.claim(sixthClaim);
      await first.claimGenerationPost({
        adapter: sixthClaim.adapter,
        deploymentId: sixthClaim.deploymentId,
        runNonce: sixthClaim.runNonce,
        modality: sixthClaim.modality,
        effectId: sixthClaim.effectId,
        providerIdempotencyKey: sixthClaim.providerIdempotencyKey,
        requestFingerprint: sixthClaim.requestFingerprint,
      });
      const seventhRunNonce =
        `issue-255-pg-${suiteNonce}-failed-before-billing-seventh`;
      await assert.rejects(
        first.claim(copyClaim(seventhRunNonce)),
        /six billable generation POSTs globally/u,
      );
    });

    it('rejects caller adapter, deployment, and idempotency identity that differs from the receipt', async () => {
      const runNonce = `issue-255-pg-${suiteNonce}-identity-conflict`;
      const effectId = createHash('sha256')
        .update(`issue255/v1\0${runNonce}\0copy`)
        .digest('hex');
      const requestFingerprint = '0'.repeat(64);
      await first.claim({
        workspaceId: receiptWorkspaceId,
        runNonce,
        modality: 'copy',
        effectId,
        requestFingerprint,
        adapter: 'direct-copy',
        deploymentId: 'deepseek-v4-pro-direct',
        providerIdempotencyKey: effectId,
        providerJobId: `${effectId}:job`,
        providerAttemptId: `${effectId}:attempt`,
        providerCostEventId: `${effectId}:cost`,
        recordedMatrixDigest: '4'.repeat(64),
        reservedAmountMicros: 100_000,
        priceRevision: 'direct-copy-price-v1',
        exchangeRevision: 'native-cny-v1',
      });

      for (const conflict of [
        { adapter: 'tuzi-image' as const },
        { deploymentId: 'forged-deployment' },
        { providerIdempotencyKey: 'forged-idempotency-key' },
      ]) {
        await assert.rejects(
          first.claimGenerationPost({
            adapter: 'direct-copy',
            deploymentId: 'deepseek-v4-pro-direct',
            runNonce,
            modality: 'copy',
            effectId,
            providerIdempotencyKey: effectId,
            requestFingerprint,
            ...conflict,
          }),
          /frozen provider identity/u,
        );
      }
      assert.equal(
        (await first.listRun(runNonce))[0]?.generationSubmitCount,
        0,
      );
    });

    it('rejects a seventh billable generation POST globally before provider fetch', async () => {
      for (const index of [1, 2, 3, 4, 5, 6]) {
        const runNonce = `issue-255-pg-${suiteNonce}-global-${index}`;
        const effectId = createHash('sha256')
          .update(`issue255/v1\0${runNonce}\0copy`)
          .digest('hex');
        const requestFingerprint = String(index).repeat(64);
        await first.claim({
          workspaceId: receiptWorkspaceId,
          runNonce,
          modality: 'copy',
          effectId,
          requestFingerprint,
          adapter: 'direct-copy',
          deploymentId: 'deepseek-v4-pro-direct',
          providerIdempotencyKey: effectId,
          providerJobId: `${effectId}:job`,
          providerAttemptId: `${effectId}:attempt`,
          providerCostEventId: `${effectId}:cost`,
          recordedMatrixDigest: '8'.repeat(64),
          reservedAmountMicros: 100_000,
          priceRevision: 'direct-copy-price-v1',
          exchangeRevision: 'native-cny-v1',
        });
        await first.claimGenerationPost({
          adapter: 'direct-copy',
          deploymentId: 'deepseek-v4-pro-direct',
          runNonce,
          modality: 'copy',
          effectId,
          providerIdempotencyKey: effectId,
          requestFingerprint,
        });
      }
      const seventhRunNonce = `issue-255-pg-${suiteNonce}-global-7`;
      const seventhEffectId = createHash('sha256')
        .update(`issue255/v1\0${seventhRunNonce}\0copy`)
        .digest('hex');
      await assert.rejects(
        first.claim({
          workspaceId: receiptWorkspaceId,
          runNonce: seventhRunNonce,
          modality: 'copy',
          adapter: 'direct-copy',
          deploymentId: 'deepseek-v4-pro-direct',
          effectId: seventhEffectId,
          providerIdempotencyKey: seventhEffectId,
          providerJobId: `${seventhEffectId}:job`,
          providerAttemptId: `${seventhEffectId}:attempt`,
          providerCostEventId: `${seventhEffectId}:cost`,
          requestFingerprint: '9'.repeat(64),
          recordedMatrixDigest: '8'.repeat(64),
          reservedAmountMicros: 100_000,
          priceRevision: 'direct-copy-price-v1',
          exchangeRevision: 'native-cny-v1',
        }),
        /exactly six billable generation POSTs/u,
      );
      assert.equal((await first.listRun(seventhRunNonce)).length, 0);
      const history = await firstPool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
           FROM issue255_live_generation_authorizations
          WHERE run_nonce LIKE $1`,
        [`issue-255-pg-${suiteNonce}-global-%`],
      );
      assert.equal(history.rows[0]?.count, 6);
    });

    it('accepts only known integer-micro-CNY terminal cost truth', async () => {
      const runNonce = `issue-255-pg-${suiteNonce}-known-cost`;
      const effectId = createHash('sha256')
        .update(`issue255/v1\0${runNonce}\0copy`)
        .digest('hex');
      const requestFingerprint = 'a'.repeat(64);
      const workspaceId = `issue-255-workspace-${suiteNonce}-known-cost`;
      const deploymentId = 'deepseek-v4-pro-direct';
      const providerJobId = `${effectId}:job`;
      const providerAttemptId = `${effectId}:attempt`;
      const providerCostEventId = `${effectId}:cost`;
      const providerTaskRef = `${effectId}:task`;
      const priceRevision = 'direct-copy-price-v1';
      let billingStatus:
        | 'known'
        | 'externally_billed' = 'externally_billed';
      const providerLedger = {
        async getGenerationJob() {
          return {
            id: providerJobId,
            workspaceId,
            operation: 'copy' as const,
            routeSnapshotId: `${effectId}:route`,
            usageReservationId: `${effectId}:usage`,
            status: 'completed' as const,
            createdBy: 'issue-255',
            correlationId: effectId,
            result: {
              status: 'completed',
              issue255: {
                workspaceId,
                effectId,
                requestFingerprint,
                adapter: 'direct-copy',
                deploymentId,
                providerIdempotencyKey: effectId,
                providerJobId,
                providerAttemptId,
                providerCostEventId,
              },
              attempt: {
                id: providerAttemptId,
                deploymentId,
                providerTaskRef,
              },
              providerCost: {
                id: providerCostEventId,
                status: 'observed',
                amountMicros: 100_000,
                currency: 'CNY',
                usage: { inputTokens: 10, outputTokens: 20 },
              },
              snapshot: {
                priceRevision,
                allowedCandidates: [{ deploymentId, priceRevision }],
              },
            },
            createdAt: '2026-07-29T00:00:00.000Z',
            updatedAt: '2026-07-29T00:00:00.000Z',
          };
        },
        async getProviderAttempt() {
          return {
            id: providerAttemptId,
            workspaceId,
            jobId: providerJobId,
            ordinal: 1,
            deploymentId,
            acceptance: 'accepted' as const,
            providerTaskRef,
            status: 'completed' as const,
            createdAt: '2026-07-29T00:00:00.000Z',
            updatedAt: '2026-07-29T00:00:00.000Z',
          };
        },
        async listProviderCosts() {
          return [
            {
              id: providerCostEventId,
              workspaceId,
              attemptId: providerAttemptId,
              stage: 'observed' as const,
              amountMicros: 100_000,
              currency: 'CNY',
              unit: 'token',
              evidence: 'provider-terminal',
              payer: 'platform' as const,
              billingStatus,
              actorId: 'issue-255',
              correlationId: effectId,
              createdAt: '2026-07-29T00:00:00.000Z',
            },
          ];
        },
      };
      await first.claim({
        workspaceId,
        runNonce,
        modality: 'copy',
        effectId,
        requestFingerprint,
        adapter: 'direct-copy',
        deploymentId,
        providerIdempotencyKey: effectId,
        providerJobId,
        providerAttemptId,
        providerCostEventId,
        recordedMatrixDigest: 'b'.repeat(64),
        reservedAmountMicros: 100_000,
        priceRevision,
        exchangeRevision: 'native-cny-v1',
      });
      await first.claimGenerationPost({
        adapter: 'direct-copy',
        deploymentId,
        runNonce,
        modality: 'copy',
        effectId,
        providerIdempotencyKey: effectId,
        requestFingerprint,
      });
      await first.recordProviderHttpRequest({
        adapter: 'direct-copy',
        deploymentId,
        runNonce,
        modality: 'copy',
        effectId,
        providerIdempotencyKey: effectId,
        requestFingerprint,
      });

      await assert.rejects(
        first.completeFromProviderLedger(
          {
            runNonce,
            modality: 'copy',
            effectId,
            requestFingerprint,
          },
          providerLedger,
        ),
        /ProviderCost event is missing or inconsistent/u,
      );
      billingStatus = 'known';
      assert.equal(
        (
          await first.completeFromProviderLedger(
            {
              runNonce,
              modality: 'copy',
              effectId,
              requestFingerprint,
            },
            providerLedger,
          )
        ).actualAmountMicros,
        100_000,
      );
    });

    it('completes only from the durable ProviderAttempt and ProviderCost lineage', async () => {
      const foundation = new PostgresFoundationRepository(firstPool);
      await foundation.migrate();
      const runNonce = `issue-255-pg-${suiteNonce}-terminal-lineage`;
      const effectId = createHash('sha256')
        .update(`issue255/v1\0${runNonce}\0copy`)
        .digest('hex');
      const requestFingerprint = '5'.repeat(64);
      const workspaceId = `issue-255-workspace-${suiteNonce}`;
      const jobId = `issue-255-job-${suiteNonce}`;
      const attemptId = `issue-255-attempt-${suiteNonce}`;
      const costEventId = `issue-255-cost-${suiteNonce}`;
      const deploymentId = 'deepseek-v4-pro-direct';
      const providerTaskRef = `provider-task-${suiteNonce}`;
      const priceRevision = 'direct-copy-price-v1';
      const now = '2026-07-29T00:00:00.000Z';

      await firstPool.query(
        `INSERT INTO workspaces (id, name)
         VALUES ($1, 'Issue 255 terminal lineage')
         ON CONFLICT (id) DO NOTHING`,
        [workspaceId],
      );
      await firstPool.query(
        `INSERT INTO p1_route_snapshots (
           workspace_id, id, catalog_revision, policy_revision,
           price_revision, requested_catalog_model_id, selection_mode,
           data_class, data_classes, fallback_consent, allowed_candidates,
           created_at
         ) VALUES (
           $1, $2, 'catalog-v1', 'policy-v1', $3, 'deepseek-v4-pro',
           'fixed', 'public', '["public"]'::jsonb, false, $4::jsonb,
           $5::timestamptz
         )`,
        [
          workspaceId,
          `route-${suiteNonce}`,
          priceRevision,
          JSON.stringify([{ deploymentId, priceRevision }]),
          now,
        ],
      );
      await foundation.insertGenerationJob({
        id: jobId,
        workspaceId,
        operation: 'copy',
        routeSnapshotId: `route-${suiteNonce}`,
        usageReservationId: `usage-${suiteNonce}`,
        status: 'completed',
        createdBy: 'issue-255',
        correlationId: `correlation-${suiteNonce}`,
        result: {
          status: 'completed',
          issue255: {
            workspaceId,
            effectId,
            requestFingerprint,
            adapter: 'direct-copy',
            deploymentId,
            providerIdempotencyKey: effectId,
            providerJobId: jobId,
            providerAttemptId: attemptId,
            providerCostEventId: costEventId,
          },
          attempt: {
            id: attemptId,
            deploymentId,
            acceptance: 'accepted',
            providerTaskRef,
            status: 'completed',
          },
          providerCost: {
            id: costEventId,
            status: 'observed',
            amountMicros: 100_000,
            currency: 'CNY',
            usage: { inputTokens: 12, outputTokens: 34 },
          },
          snapshot: {
            priceRevision,
            allowedCandidates: [{ deploymentId, priceRevision }],
          },
        },
        createdAt: now,
        updatedAt: now,
      });
      await foundation.insertProviderAttempt({
        id: attemptId,
        workspaceId,
        jobId,
        ordinal: 1,
        deploymentId,
        acceptance: 'accepted',
        providerTaskRef,
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      });
      await foundation.appendProviderCost({
        id: costEventId,
        workspaceId,
        attemptId,
        stage: 'observed',
        amountMicros: 100_000,
        currency: 'CNY',
        unit: 'token',
        evidence: 'provider-terminal',
        payer: 'platform',
        billingStatus: 'known',
        actorId: 'issue-255',
        correlationId: `correlation-${suiteNonce}`,
        createdAt: now,
      });

      await first.claim({
        workspaceId,
        runNonce,
        modality: 'copy',
        effectId,
        requestFingerprint,
        adapter: 'direct-copy',
        deploymentId,
        providerIdempotencyKey: effectId,
        providerJobId: jobId,
        providerAttemptId: attemptId,
        providerCostEventId: costEventId,
        recordedMatrixDigest: '6'.repeat(64),
        reservedAmountMicros: 100_000,
        priceRevision,
        exchangeRevision: 'native-cny-v1',
      });
      await first.claimGenerationPost({
        adapter: 'direct-copy',
        deploymentId,
        runNonce,
        modality: 'copy',
        effectId,
        providerIdempotencyKey: effectId,
        requestFingerprint,
      });
      await first.recordProviderHttpRequest({
        adapter: 'direct-copy',
        deploymentId,
        runNonce,
        modality: 'copy',
        effectId,
        providerIdempotencyKey: effectId,
        requestFingerprint,
      });

      const completed = await first.completeFromProviderLedger(
        {
          runNonce,
          modality: 'copy',
          effectId,
          requestFingerprint,
        },
        foundation,
      );

      assert.equal(completed.status, 'completed');
      assert.equal(completed.actualAmountMicros, 100_000);
      assert.equal(completed.providerHttpRequestCount, 1);
      assert.ok(
        completed.terminalLineage &&
          'usage' in completed.terminalLineage.providerCost,
      );
      assert.deepEqual(completed.terminalLineage.providerCost.usage, {
        inputTokens: 12,
        outputTokens: 34,
      });

      const reconciliationRunNonce =
        `issue-255-pg-${suiteNonce}-terminal-reconciliation`;
      const reconciliationEffectId = createHash('sha256')
        .update(`issue255/v1\0${reconciliationRunNonce}\0copy`)
        .digest('hex');
      await assert.rejects(
        first.claim({
          workspaceId: `${workspaceId}-forged`,
          runNonce: reconciliationRunNonce,
          modality: 'copy',
          effectId: reconciliationEffectId,
          requestFingerprint,
          adapter: 'direct-copy',
          deploymentId,
          providerIdempotencyKey: reconciliationEffectId,
          providerJobId: jobId,
          providerAttemptId: attemptId,
          providerCostEventId: costEventId,
          recordedMatrixDigest: '7'.repeat(64),
          reservedAmountMicros: 100_000,
          priceRevision,
          exchangeRevision: 'native-cny-v1',
        }),
        /durable provider lineage.*already bound/u,
      );

      const reconciliationJobId = `issue-255-reconcile-job-${suiteNonce}`;
      const reconciliationAttemptId =
        `issue-255-reconcile-attempt-${suiteNonce}`;
      const reconciliationCostEventId =
        `issue-255-reconcile-cost-${suiteNonce}`;
      await foundation.insertGenerationJob({
        id: reconciliationJobId,
        workspaceId,
        operation: 'copy',
        routeSnapshotId: `route-${suiteNonce}`,
        usageReservationId: `reconcile-usage-${suiteNonce}`,
        status: 'completed',
        createdBy: 'issue-255',
        correlationId: `reconcile-correlation-${suiteNonce}`,
        result: {
          status: 'completed',
          issue255: {
            workspaceId,
            effectId: reconciliationEffectId,
            requestFingerprint,
            adapter: 'direct-copy',
            deploymentId,
            providerIdempotencyKey: reconciliationEffectId,
            providerJobId: reconciliationJobId,
            providerAttemptId: reconciliationAttemptId,
            providerCostEventId: reconciliationCostEventId,
          },
          attempt: {
            id: reconciliationAttemptId,
            deploymentId,
            acceptance: 'accepted',
            providerTaskRef: `reconcile-provider-task-${suiteNonce}`,
            status: 'completed',
          },
          providerCost: {
            id: reconciliationCostEventId,
            status: 'observed',
            amountMicros: 100_000,
            currency: 'CNY',
            usage: { inputTokens: 21, outputTokens: 43 },
          },
          snapshot: {
            priceRevision,
            allowedCandidates: [{ deploymentId, priceRevision }],
          },
        },
        createdAt: now,
        updatedAt: now,
      });
      await foundation.insertProviderAttempt({
        id: reconciliationAttemptId,
        workspaceId,
        jobId: reconciliationJobId,
        ordinal: 1,
        deploymentId,
        acceptance: 'accepted',
        providerTaskRef: `reconcile-provider-task-${suiteNonce}`,
        status: 'completed',
        createdAt: now,
        updatedAt: now,
      });
      await foundation.appendProviderCost({
        id: reconciliationCostEventId,
        workspaceId,
        attemptId: reconciliationAttemptId,
        stage: 'observed',
        amountMicros: 100_000,
        currency: 'CNY',
        unit: 'token',
        evidence: 'provider-terminal',
        payer: 'platform',
        billingStatus: 'known',
        actorId: 'issue-255',
        correlationId: `reconcile-correlation-${suiteNonce}`,
        createdAt: now,
      });
      await first.claim({
        workspaceId,
        runNonce: reconciliationRunNonce,
        modality: 'copy',
        effectId: reconciliationEffectId,
        requestFingerprint,
        adapter: 'direct-copy',
        deploymentId,
        providerIdempotencyKey: reconciliationEffectId,
        providerJobId: reconciliationJobId,
        providerAttemptId: reconciliationAttemptId,
        providerCostEventId: reconciliationCostEventId,
        recordedMatrixDigest: '7'.repeat(64),
        reservedAmountMicros: 100_000,
        priceRevision,
        exchangeRevision: 'native-cny-v1',
      });
      await first.claimGenerationPost({
        adapter: 'direct-copy',
        deploymentId,
        runNonce: reconciliationRunNonce,
        modality: 'copy',
        effectId: reconciliationEffectId,
        providerIdempotencyKey: reconciliationEffectId,
        requestFingerprint,
      });
      await first.recordProviderHttpRequest({
        adapter: 'direct-copy',
        deploymentId,
        runNonce: reconciliationRunNonce,
        modality: 'copy',
        effectId: reconciliationEffectId,
        providerIdempotencyKey: reconciliationEffectId,
        requestFingerprint,
      });
      await first.markUnknown({
        runNonce: reconciliationRunNonce,
        modality: 'copy',
        effectId: reconciliationEffectId,
        requestFingerprint,
        reason: 'provider_acceptance_unknown',
      });

      const [reconciled] = await reconcileIssue255LiveRun({
        foundation,
        receipts: first,
        runNonce: reconciliationRunNonce,
      });
      assert.equal(reconciled?.status, 'completed');
      assert.equal(
        reconciled?.reconciliationReason,
        'provider_ledger_reconciled',
      );
    });
  },
);
