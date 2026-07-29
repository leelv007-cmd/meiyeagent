import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import { Pool } from 'pg';

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

    before(async () => {
      await first.migrate();
    });

    after(async () => {
      await firstPool.query(
        'DELETE FROM issue255_live_generation_receipts WHERE run_nonce LIKE $1',
        [`issue-255-pg-${suiteNonce}-%`],
      );
      await Promise.all([firstPool.end(), secondPool.end()]);
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
        runNonce,
        modality: 'copy' as const,
        effectId,
        requestFingerprint,
        adapter: 'direct-copy',
        deploymentId: 'deepseek-v4-pro-direct',
        providerIdempotencyKey: effectId,
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
        runNonce,
        modality: 'copy' as const,
        effectId,
        requestFingerprint: 'c'.repeat(64),
        adapter: 'direct-copy',
        deploymentId: 'deepseek-v4-pro-direct',
        providerIdempotencyKey: effectId,
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
        runNonce,
        modality: 'copy' as const,
        effectId: copyEffectId,
        requestFingerprint: 'f'.repeat(64),
        adapter: 'direct-copy',
        deploymentId: 'deepseek-v4-pro-direct',
        providerIdempotencyKey: copyEffectId,
        recordedMatrixDigest: '1'.repeat(64),
        reservedAmountMicros: 100_000,
        priceRevision: 'direct-copy-price-v1',
        exchangeRevision: 'native-cny-v1',
      };
      await first.claim(copy);
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
        runNonce,
        modality: 'copy',
        effectId,
        requestFingerprint,
        adapter: 'direct-copy',
        deploymentId: 'deepseek-v4-pro-direct',
        providerIdempotencyKey: effectId,
        recordedMatrixDigest: '4'.repeat(64),
        reservedAmountMicros: 100_000,
        priceRevision: 'direct-copy-price-v1',
        exchangeRevision: 'native-cny-v1',
      });
      let providerFetchCount = 0;
      const post = async () => {
        await second.claimGenerationPost({
          runNonce,
          modality: 'copy' as const,
          effectId,
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
  },
);
