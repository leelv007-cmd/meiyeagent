import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

import { Pool } from 'pg';

import { PostgresFoundationRepository } from '../foundation/postgres-repository.js';
import {
  collectIssue255LiveAnchors,
  issue255DirectCopyExecutor,
  issue255TuziExecutor,
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

    try {
      await foundation.migrate();
      await receipts.migrate();
      const recordedSamples = await runIssue255RecordedCalibration();
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
            modality: 'image_text',
            options: tuziOptions,
            priceRevision: 'tuzi-image-price-v1',
            receipts,
          }),
          issue255TuziExecutor({
            configurationRevision: 'tuzi-video-config-v1',
            credentialRevision: 'tuzi-credential-v1',
            deploymentId: 'seedance-1-5-pro-tuzi-relay',
            modality: 'video',
            options: tuziOptions,
            priceRevision: 'tuzi-video-price-v1',
            receipts,
            wait: async () => {},
          }),
        ],
        foundation,
        manifestPath,
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

      const residue = await pool.query<{ count: number }>(
        `SELECT (
           (SELECT COUNT(*)
              FROM issue255_live_generation_receipts
             WHERE run_nonce = $1) +
           (SELECT COUNT(*) FROM workspaces WHERE id = $2) +
           (SELECT COUNT(*)
              FROM p1_generation_jobs
             WHERE workspace_id = $2) +
           (SELECT COUNT(*)
              FROM p1_provider_attempts
             WHERE workspace_id = $2) +
           (SELECT COUNT(*)
              FROM p1_provider_cost_events
             WHERE workspace_id = $2)
         )::int AS count`,
        [runNonce, workspaceId],
      );
      assert.equal(residue.rows[0]?.count, 0);
    } finally {
      await pool.query(
        'DELETE FROM issue255_live_generation_receipts WHERE run_nonce = $1',
        [runNonce],
      );
      await pool.query('DELETE FROM workspaces WHERE id = $1', [
        workspaceId,
      ]);
      await pool.end();
      await rm(directory, { force: true, recursive: true });
    }
  },
);

function hash(input: string) {
  return createHash('sha256').update(input).digest('hex');
}
