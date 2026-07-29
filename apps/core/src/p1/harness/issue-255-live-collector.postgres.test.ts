import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresFoundationRepository } from '../foundation/postgres-repository.js';
import {
  collectIssue255LiveAnchors,
  issue255DirectCopyExecutor,
  issue255TuziExecutor,
  recoverIssue255LiveManifest,
  type Issue255LiveExecutor,
} from './issue-255-live-collector.js';
import { PostgresIssue255LiveReceiptRepository } from './issue-255-postgres-live-receipt.js';
import { runIssue255RecordedCalibration } from './issue-255-recorded-calibration.js';

const connectionString = process.env.TEST_DATABASE_URL;

test(
  'issue 255 production collector consumes the fixed direct and Tuzi adapters and cleans durable residue',
  { skip: connectionString ? false : 'TEST_DATABASE_URL is not configured' },
  async () => {
    const pool = new Pool({ connectionString, max: 4 });
    const foundation = new PostgresFoundationRepository(pool);
    const receipts = new PostgresIssue255LiveReceiptRepository(pool);
    const directory = await mkdtemp(
      join(tmpdir(), 'issue-255-live-collector-'),
    );
    const manifestPath = join(directory, 'manifest.json');
    const runNonce = `issue-255-collector-${randomUUID()}`;
    const workspaceId =
      `issue-255-live-${hash(runNonce).slice(0, 24)}`;
    const rerunNonce = `${runNonce}-rerun`;
    const rerunWorkspaceId =
      `issue-255-live-${hash(rerunNonce).slice(0, 24)}`;

    try {
      await foundation.migrate();
      await receipts.migrate();
      const recordedSamples = await runIssue255RecordedCalibration();
      let blockedExecutorCalls = 0;
      const blockedExecutors = collisionGuardExecutors(() => {
        blockedExecutorCalls += 1;
      });
      const staleManifestPath = join(directory, 'stale.json');
      await writeFile(`${staleManifestPath}.pending`, 'stale');
      await assert.rejects(
        collectIssue255LiveAnchors({
          database: pool,
          executors: blockedExecutors,
          foundation,
          manifestPath: staleManifestPath,
          providerCapMicros: 5_000_000,
          recordedSamples,
          receipts,
          runNonce: `${runNonce}-stale`,
        }),
        /pending manifest already exists/u,
      );
      const collisionManifestPath = join(directory, 'collision.json');
      await writeFile(collisionManifestPath, 'existing');
      await assert.rejects(
        collectIssue255LiveAnchors({
          database: pool,
          executors: blockedExecutors,
          foundation,
          manifestPath: collisionManifestPath,
          providerCapMicros: 5_000_000,
          recordedSamples,
          receipts,
          runNonce: `${runNonce}-collision`,
        }),
        /final manifest already exists/u,
      );
      assert.equal(await readFile(collisionManifestPath, 'utf8'), 'existing');
      assert.equal(blockedExecutorCalls, 0);
      await assert.rejects(
        collectIssue255LiveAnchors({
          database: pool,
          executors: blockedExecutors,
          foundation,
          manifestPath: join(directory, 'provider-cap.json'),
          providerCapMicros: 100_000,
          recordedSamples,
          receipts,
          runNonce: `${runNonce}-provider-cap`,
        }),
        /effective provider cap/u,
      );
      assert.equal(blockedExecutorCalls, 0);

      const partialRunNonce = `${runNonce}-partial-history`;
      const partialEffectId = hash(
        `issue255/v1\0${partialRunNonce}\0copy`,
      );
      const partialFingerprint = '9'.repeat(64);
      await receipts.claim({
        workspaceId:
          `issue-255-live-${hash(partialRunNonce).slice(0, 24)}`,
        runNonce: partialRunNonce,
        modality: 'copy',
        effectId: partialEffectId,
        requestFingerprint: partialFingerprint,
        adapter: 'direct-copy',
        deploymentId: 'deepseek-v4-pro-direct',
        providerIdempotencyKey: partialEffectId,
        providerJobId: `${partialEffectId}:job`,
        providerAttemptId: `${partialEffectId}:attempt`,
        providerCostEventId: `${partialEffectId}:cost`,
        recordedMatrixDigest: '8'.repeat(64),
        reservedAmountMicros: 100_000,
        priceRevision: 'partial-price-v1',
        exchangeRevision: 'native-cny-v1',
      });
      await receipts.claimGenerationPost({
        adapter: 'direct-copy',
        deploymentId: 'deepseek-v4-pro-direct',
        runNonce: partialRunNonce,
        modality: 'copy',
        effectId: partialEffectId,
        providerIdempotencyKey: partialEffectId,
        requestFingerprint: partialFingerprint,
      });
      await assert.rejects(
        collectIssue255LiveAnchors({
          database: pool,
          executors: blockedExecutors,
          foundation,
          manifestPath: join(directory, 'partial-history.json'),
          providerCapMicros: 5_000_000,
          recordedSamples,
          receipts,
          runNonce: `${runNonce}-after-partial`,
        }),
        /empty authorization history/u,
      );
      assert.equal(blockedExecutorCalls, 0);
      await pool.query(
        'DELETE FROM issue255_live_generation_receipts WHERE run_nonce = $1',
        [partialRunNonce],
      );
      await pool.query(
        'DELETE FROM issue255_live_generation_authorizations WHERE run_nonce = $1',
        [partialRunNonce],
      );

      const rejectedRunNonce = `${runNonce}-pre-network`;
      const rejectedWorkspaceId =
        `issue-255-live-${hash(rejectedRunNonce).slice(0, 24)}`;
      await assert.rejects(
        collectIssue255LiveAnchors({
          database: pool,
          executors: blockedExecutors,
          foundation,
          manifestPath: join(directory, 'pre-network.json'),
          providerCapMicros: 5_000_000,
          recordedSamples,
          receipts,
          runNonce: rejectedRunNonce,
        }),
        /pre-network guard/u,
      );
      assert.equal(blockedExecutorCalls, 1);
      const rejectedResidue = await pool.query<{ count: number }>(
        `SELECT (
           (SELECT COUNT(*)
              FROM issue255_live_generation_receipts
             WHERE run_nonce = $1) +
           (SELECT COUNT(*)
              FROM issue255_live_generation_authorizations
             WHERE run_nonce = $1) +
           (SELECT COUNT(*) FROM workspaces WHERE id = $2)
         )::int AS count`,
        [rejectedRunNonce, rejectedWorkspaceId],
      );
      assert.equal(rejectedResidue.rows[0]?.count, 0);
      blockedExecutorCalls = 0;

      const tuziOptions = {
        apiKey: 'test-key',
        assetFetch: {
          async get(target: string) {
            return {
              bytes: Uint8Array.from([1, 2, 3]),
              finalUrl: target,
              mimeType: 'application/octet-stream',
            };
          },
        },
        baseUrl: 'https://api.tu-zi.example/v1',
        credentialVersion: 'issue-255-test-key-v1',
        endpointRevision: 'tuzi-media-v1',
        fetch: async (input: string | URL | Request) => {
          const target = String(input);
          if (target.endsWith('/images/generations')) {
            return Response.json({
              created: 1_786_400_000,
              data: [
                { url: 'https://media.example.test/generated.png' },
              ],
              usage: { generated_images: 1 },
            });
          }
          if (target.endsWith('/videos')) {
            return Response.json({
              id: 'issue-255-video-task',
              object: 'video',
              status: 'queued',
            });
          }
          if (target.endsWith('/videos/issue-255-video-task')) {
            return Response.json({
              id: 'issue-255-video-task',
              object: 'video',
              progress: 100,
              status: 'completed',
              usage: { completion_tokens: 1_000_000 },
            });
          }
          throw new Error('Unexpected issue 255 Tuzi test request.');
        },
        image: {
          catalogModelId: 'gpt-image-2' as const,
          costPerImage: 0.5,
          model: 'gpt-image-2',
        },
        sourceUrlTtlSeconds: 3_600,
        video: {
          catalogModelId: 'seedance-1-5-pro' as const,
          costPerMillionTokens: 3,
          estimatedTokensPerSecond: 1_000_000,
          model: 'seedance-1-5-pro',
        },
      };
      const manifest = await collectIssue255LiveAnchors({
        database: pool,
        executors: [
          issue255DirectCopyExecutor({
            configurationRevision: 'direct-config-v1',
            credentialRevision: 'direct-credential-v1',
            deploymentId: 'deepseek-v4-pro-direct',
            frozenPrices: {
              inputCostPerMillionCny: '1',
              outputCostPerMillionCny: '2',
            },
            options: {
              apiKey: 'test-key',
              baseUrl: 'https://copy.example.test/v1',
              catalogModelId: 'deepseek-v4-pro',
              currency: 'CNY',
              fetch: async () =>
                Response.json({
                  object: 'chat.completion',
                  id: 'issue-255-copy-task',
                  created: 1_786_400_000,
                  model: 'deepseek-v4-pro',
                  choices: [
                    {
                      index: 0,
                      message: {
                        role: 'assistant',
                        content: JSON.stringify({
                          candidates: [
                            {
                              title: '护理记录一',
                              body: '春日护理到店前先沟通肤质与时间。',
                              conversionHook: '私信预约',
                            },
                            {
                              title: '护理记录二',
                              body: '夏日护理会先确认门店事实与个人偏好。',
                              conversionHook: '到店沟通',
                            },
                            {
                              title: '护理记录三',
                              body: '秋日护理只描述可核对的服务信息。',
                              conversionHook: '收藏了解',
                            },
                          ],
                        }),
                      },
                      finish_reason: 'stop',
                    },
                  ],
                  usage: {
                    prompt_tokens: 12,
                    completion_tokens: 18,
                  },
                }),
              inputCostPerMillion: 1,
              maxOutputTokens: 384_000,
              model: 'deepseek-v4-pro',
              outputCostPerMillion: 2,
            },
            priceRevision: 'direct-price-v1',
            receipts,
          }),
          issue255TuziExecutor({
            configurationRevision: 'tuzi-image-config-v1',
            credentialRevision: 'tuzi-credential-v1',
            deploymentId: 'gpt-image-2-tuzi-relay',
            frozenPriceCny: '0.5',
            modality: 'image_text',
            options: tuziOptions,
            priceRevision: 'tuzi-image-price-v1',
            receipts,
          }),
          issue255TuziExecutor({
            configurationRevision: 'tuzi-video-config-v1',
            credentialRevision: 'tuzi-credential-v1',
            deploymentId: 'seedance-1-5-pro-tuzi-relay',
            frozenPriceCny: '3',
            modality: 'video',
            options: tuziOptions,
            priceRevision: 'tuzi-video-price-v1',
            receipts,
            wait: async () => {},
          }),
        ],
        foundation,
        manifestPath,
        providerCapMicros: 5_000_000,
        recordedSamples,
        receipts,
        runNonce,
      });

      assert.deepEqual(
        manifest.samples.map((sample) => sample.modality),
        ['copy', 'image_text', 'video'],
      );
      assert.deepEqual(
        manifest.samples.map((sample) => sample.generationSubmitCount),
        [1, 1, 1],
      );
      assert.equal(
        manifest.samples.every(
          (sample) => sample.providerHttpRequestCount > 0,
        ),
        true,
      );
      assert.equal(
        JSON.parse(await readFile(manifestPath, 'utf8')).cleanup
          .databaseResidueCount,
        0,
      );
      const durableHistory = await pool.query<{ count: number }>(
        `SELECT COUNT(*)::int AS count
           FROM issue255_live_generation_authorizations
          WHERE run_nonce = $1`,
        [runNonce],
      );
      assert.equal(durableHistory.rows[0]?.count, 3);
      const tamperedPath = join(directory, 'tampered.json');
      const tamperedManifest = JSON.parse(
        await readFile(manifestPath, 'utf8'),
      );
      tamperedManifest.samples[0].providerTaskRefHash = 'f'.repeat(64);
      await writeFile(
        `${tamperedPath}.pending`,
        `${JSON.stringify(tamperedManifest, null, 2)}\n`,
      );
      await assert.rejects(
        recoverIssue255LiveManifest({
          database: pool,
          manifestPath: tamperedPath,
        }),
        /differs from durable terminal evidence truth/u,
      );
      const tamperedEnvelopePath = join(
        directory,
        'tampered-envelope.json',
      );
      const tamperedEnvelope = JSON.parse(
        await readFile(manifestPath, 'utf8'),
      );
      tamperedEnvelope.totalActualAmountMicros += 1;
      await writeFile(
        `${tamperedEnvelopePath}.pending`,
        `${JSON.stringify(tamperedEnvelope, null, 2)}\n`,
      );
      await assert.rejects(
        recoverIssue255LiveManifest({
          database: pool,
          manifestPath: tamperedEnvelopePath,
        }),
        /differs from durable terminal evidence truth/u,
      );
      const crossRunPath = join(directory, 'cross-run.json');
      await writeFile(
        `${crossRunPath}.pending`,
        await readFile(manifestPath, 'utf8'),
      );
      const crossRunEffectId = manifest.samples[0]!.effectId;
      await pool.query(
        `UPDATE issue255_live_generation_authorizations
            SET run_nonce = $2
          WHERE effect_id = $1`,
        [crossRunEffectId, `${runNonce}-forged`],
      );
      try {
        await assert.rejects(
          recoverIssue255LiveManifest({
            database: pool,
            manifestPath: crossRunPath,
          }),
          /across runs/u,
        );
      } finally {
        await pool.query(
          `UPDATE issue255_live_generation_authorizations
              SET run_nonce = $2
            WHERE effect_id = $1`,
          [crossRunEffectId, runNonce],
        );
      }
      const recoveryPath = join(directory, 'recovered.json');
      await rename(manifestPath, `${recoveryPath}.pending`);
      const recovered = await recoverIssue255LiveManifest({
        database: pool,
        manifestPath: recoveryPath,
      });
      assert.equal(recovered.samples.length, 3);
      assert.equal(
        JSON.parse(await readFile(recoveryPath, 'utf8')).samples.length,
        3,
      );

      await assert.rejects(
        collectIssue255LiveAnchors({
          database: pool,
          executors: blockedExecutors,
          foundation,
          manifestPath: join(directory, 'rerun.json'),
          providerCapMicros: 5_000_000,
          recordedSamples,
          receipts,
          runNonce: rerunNonce,
        }),
        /empty authorization history/u,
      );
      assert.equal(blockedExecutorCalls, 0);

      const residue = await pool.query<{ count: number }>(
        `SELECT (
           (SELECT COUNT(*)
              FROM issue255_live_generation_receipts
             WHERE run_nonce IN ($1, $2)) +
           (SELECT COUNT(*) FROM workspaces WHERE id IN ($3, $4)) +
           (SELECT COUNT(*)
              FROM p1_generation_jobs
             WHERE workspace_id IN ($3, $4)) +
           (SELECT COUNT(*)
              FROM p1_provider_attempts
             WHERE workspace_id IN ($3, $4)) +
           (SELECT COUNT(*)
              FROM p1_provider_cost_events
             WHERE workspace_id IN ($3, $4))
         )::int AS count`,
        [runNonce, rerunNonce, workspaceId, rerunWorkspaceId],
      );
      assert.equal(residue.rows[0]?.count, 0);
    } finally {
      await pool.query(
        'DELETE FROM issue255_live_generation_receipts WHERE run_nonce LIKE $1',
        [`${runNonce}%`],
      );
      await pool.query(
        'DELETE FROM issue255_live_generation_authorizations WHERE run_nonce LIKE $1',
        [`${runNonce}%`],
      );
      await pool.query('DELETE FROM workspaces WHERE id IN ($1, $2, $3)', [
        workspaceId,
        rerunWorkspaceId,
        `issue-255-live-${hash(`${runNonce}-pre-network`).slice(0, 24)}`,
      ]);
      await pool.end();
      await rm(directory, { force: true, recursive: true });
    }
  },
);

function hash(input: string) {
  return createHash('sha256').update(input).digest('hex');
}

function collisionGuardExecutors(
  onExecute: () => void,
): readonly Issue255LiveExecutor[] {
  return [
    {
      adapter: 'direct-copy',
      catalogModelId: 'deepseek-v4-pro',
      configurationRevision: 'collision-copy-config-v1',
      credentialRevision: 'collision-credential-v1',
      deploymentId: 'deepseek-v4-pro-direct',
      modality: 'copy',
      priceRevision: 'collision-copy-price-v1',
      promptHash: '1'.repeat(64),
      quoteAmountMicros: 100_000,
      quoteBasis: { maxInputTokens: 1, maxOutputTokens: 1 },
      async execute() {
        onExecute();
        throw new Error('Provider execution crossed a pre-network guard.');
      },
    },
    {
      adapter: 'tuzi-image',
      catalogModelId: 'gpt-image-2',
      configurationRevision: 'collision-image-config-v1',
      credentialRevision: 'collision-credential-v1',
      deploymentId: 'gpt-image-2-tuzi-relay',
      modality: 'image_text',
      priceRevision: 'collision-image-price-v1',
      promptHash: '2'.repeat(64),
      quoteAmountMicros: 500_000,
      quoteBasis: { outputCount: 1 },
      async execute() {
        onExecute();
        throw new Error('Provider execution crossed a pre-network guard.');
      },
    },
    {
      adapter: 'tuzi-video',
      catalogModelId: 'seedance-1-5-pro',
      configurationRevision: 'collision-video-config-v1',
      credentialRevision: 'collision-credential-v1',
      deploymentId: 'seedance-1-5-pro-tuzi-relay',
      modality: 'video',
      priceRevision: 'collision-video-price-v1',
      promptHash: '3'.repeat(64),
      quoteAmountMicros: 3_000_000,
      quoteBasis: {
        durationSeconds: 1,
        estimatedTokensPerSecond: 1_000_000,
      },
      async execute() {
        onExecute();
        throw new Error('Provider execution crossed a pre-network guard.');
      },
    },
  ];
}
