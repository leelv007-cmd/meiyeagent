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

    before(async () => {
      await first.migrate();
    });

    beforeEach(async () => {
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
              'provider_cost_event_id'
            )
          ORDER BY column_name`,
      );
      assert.deepEqual(
        columns.rows,
        [
          { column_name: 'provider_attempt_id', is_nullable: 'NO' },
          { column_name: 'provider_cost_event_id', is_nullable: 'NO' },
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

    it('backfills three legacy submitted receipts before rejecting a fourth claim', async () => {
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
      await assert.rejects(
        first.claim(copyClaim(fourthRunNonce)),
        /exactly three billable generation POSTs/u,
      );
      const history = await firstPool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
           FROM issue255_live_generation_authorizations
          WHERE run_nonce LIKE $1`,
        [`${legacyRunPrefix}-%`],
      );
      assert.equal(history.rows[0]?.count, 3);
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
      });
      assert.equal(classified.kind, 'provider_acceptance_unknown');
      assert.equal((await first.listRun(unknown.runNonce))[0]?.status, 'unknown');
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

    it('rejects a fourth billable generation POST globally before provider fetch', async () => {
      for (const index of [1, 2, 3]) {
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
      const fourthRunNonce = `issue-255-pg-${suiteNonce}-global-4`;
      const fourthEffectId = createHash('sha256')
        .update(`issue255/v1\0${fourthRunNonce}\0copy`)
        .digest('hex');
      await assert.rejects(
        first.claim({
          workspaceId: receiptWorkspaceId,
          runNonce: fourthRunNonce,
          modality: 'copy',
          adapter: 'direct-copy',
          deploymentId: 'deepseek-v4-pro-direct',
          effectId: fourthEffectId,
          providerIdempotencyKey: fourthEffectId,
          providerJobId: `${fourthEffectId}:job`,
          providerAttemptId: `${fourthEffectId}:attempt`,
          providerCostEventId: `${fourthEffectId}:cost`,
          requestFingerprint: '9'.repeat(64),
          recordedMatrixDigest: '8'.repeat(64),
          reservedAmountMicros: 100_000,
          priceRevision: 'direct-copy-price-v1',
          exchangeRevision: 'native-cny-v1',
        }),
        /exactly three billable generation POSTs/u,
      );
      assert.equal((await first.listRun(fourthRunNonce)).length, 0);
      const history = await firstPool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
           FROM issue255_live_generation_authorizations
          WHERE run_nonce LIKE $1`,
        [`issue-255-pg-${suiteNonce}-global-%`],
      );
      assert.equal(history.rows[0]?.count, 3);
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
      assert.deepEqual(completed.terminalLineage?.providerCost.usage, {
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
