import assert from 'node:assert/strict';
import test from 'node:test';

import { recordedRequest } from '../model-supply/adapters.js';
import {
  createIssue255DirectCopyPort,
  createIssue255TuziMediaPort,
} from './issue-255-provider-attempt-fence.js';

class ReceiptFence {
  generationSubmitCount = 0;
  providerHttpRequestCount = 0;

  async claimGenerationPost() {
    if (this.generationSubmitCount !== 0) {
      throw new Error('generation POST already fenced');
    }
    this.generationSubmitCount += 1;
  }

  async recordProviderHttpRequest() {
    this.providerHttpRequestCount += 1;
  }
}

const identity = {
  runNonce: 'issue-255-adapter-fence',
  effectId: 'a'.repeat(64),
  requestFingerprint: 'b'.repeat(64),
} as const;

test('issue 255 direct copy adapter crosses the durable generation fence before its only provider POST', async () => {
  const receipts = new ReceiptFence();
  let providerCalls = 0;
  const port = createIssue255DirectCopyPort({
    identity: { ...identity, modality: 'copy' },
    options: {
      apiKey: 'test-key',
      baseUrl: 'https://copy.example.test/v1',
      catalogModelId: 'deepseek-v4-pro',
      currency: 'CNY',
      fetch: async () => {
        providerCalls += 1;
        return Response.json({
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
                      title: '门店护理',
                      body: '基于门店事实的护理介绍。',
                      conversionHook: '私信预约',
                    },
                  ],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 12, completion_tokens: 18 },
        });
      },
      inputCostPerMillion: 1,
      model: 'deepseek-v4-pro',
      outputCostPerMillion: 2,
    },
    receipts,
  });
  const request = recordedRequest('deepseek-v4-pro', 'copy.generate');

  assert.equal((await port.execute(request)).kind, 'completed');
  assert.equal(receipts.generationSubmitCount, 1);
  assert.equal(receipts.providerHttpRequestCount, 1);
  assert.equal(providerCalls, 1);

  assert.equal((await port.execute(request)).kind, 'failure');
  assert.equal(providerCalls, 1);
});

test('issue 255 Tuzi image adapter crosses the generation fence at the rewritten submit endpoint', async () => {
  const receipts = new ReceiptFence();
  let providerCalls = 0;
  const port = createIssue255TuziMediaPort({
    identity: { ...identity, modality: 'image_text' },
    options: tuziOptions(async (input) => {
      providerCalls += 1;
      assert.equal(
        String(input),
        'https://api.tu-zi.example/v1/images/generations',
      );
      return Response.json({
        created: 1_786_400_000,
        data: [{ url: 'https://media.example.test/generated.png' }],
        usage: { generated_images: 1 },
      });
    }),
    receipts,
  });
  const request = {
    ...recordedRequest('gpt-image-2', 'image.generate', {
      height: 2048,
      width: 2048,
    }),
    effectIdempotencyKey: identity.effectId,
  };

  assert.equal((await port.submit(request)).acceptance, 'accepted');
  assert.equal(receipts.generationSubmitCount, 1);
  assert.equal(receipts.providerHttpRequestCount, 1);
  assert.equal(providerCalls, 1);

  await port.submit(request);
  assert.equal(providerCalls, 1);
});

test('issue 255 Tuzi video adapter counts poll HTTP separately without claiming a second generation', async () => {
  const receipts = new ReceiptFence();
  let providerCalls = 0;
  const port = createIssue255TuziMediaPort({
    identity: { ...identity, modality: 'video' },
    options: tuziOptions(async (input) => {
      providerCalls += 1;
      const target = String(input);
      if (target.endsWith('/videos/issue-255-video-task')) {
        return Response.json({
          id: 'issue-255-video-task',
          object: 'video',
          progress: 100,
          status: 'completed',
        });
      }
      assert.equal(target, 'https://api.tu-zi.example/v1/videos');
      return Response.json({
        id: 'issue-255-video-task',
        object: 'video',
        status: 'queued',
      });
    }),
    receipts,
  });
  const request = {
    ...recordedRequest('seedance-1-5-pro', 'video.generate', {
      durationSeconds: 1,
    }),
    effectIdempotencyKey: identity.effectId,
  };
  const submitted = await port.submit(request);
  assert.equal(submitted.acceptance, 'accepted');
  assert.ok(submitted.taskRef);
  await port.poll({ ...request, taskRef: submitted.taskRef! });

  assert.equal(receipts.generationSubmitCount, 1);
  assert.equal(receipts.providerHttpRequestCount, 2);
  assert.equal(providerCalls, 2);
});

function tuziOptions(fetch: typeof globalThis.fetch) {
  return {
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
    fetch,
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
}
