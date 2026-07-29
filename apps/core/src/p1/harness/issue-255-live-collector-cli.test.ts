import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertIssue255LiveCollectorLaunch,
  runIssue255LiveManifestRecoveryCli,
  runIssue255LiveReconciliationCli,
} from './issue-255-live-collector-cli.js';
import {
  assertIssue255SanitizedManifest,
  issue255DirectCopyExecutor,
  issue255TuziExecutor,
} from './issue-255-live-collector.js';

test('issue 255 live collector CLI stays fail-closed without explicit live GO', () => {
  assert.throws(
    () => assertIssue255LiveCollectorLaunch({}),
    /remains disabled/u,
  );
  assert.throws(
    () =>
      assertIssue255LiveCollectorLaunch({
        RUN_LIVE_ISSUE_255: '0',
        MODEL_EXECUTION_MODE: 'direct',
        MODEL_MEDIA_EXECUTION_MODE: 'tuzi',
        PROVIDER_LIVE_COST_CAP_CNY: '5',
      }),
    /remains disabled/u,
  );
  assert.throws(
    () =>
      assertIssue255LiveCollectorLaunch({
        RUN_LIVE_ISSUE_255: '1',
        RUN_LIVE_TUZI_CANCELLATION_TEST: '1',
        MODEL_EXECUTION_MODE: 'direct',
        MODEL_MEDIA_EXECUTION_MODE: 'tuzi',
        PROVIDER_LIVE_COST_CAP_CNY: '5',
      }),
    /cancellation.*mutually exclusive/u,
  );
  assert.deepEqual(
    assertIssue255LiveCollectorLaunch({
      RUN_LIVE_ISSUE_255: '1',
      MODEL_EXECUTION_MODE: 'direct',
      MODEL_MEDIA_EXECUTION_MODE: 'tuzi',
      PROVIDER_LIVE_COST_CAP_CNY: '0.1',
    }),
    { providerCapMicros: 100_000 },
  );
});

test('issue 255 recovery CLIs require explicit non-live recovery authorization', async () => {
  await assert.rejects(
    runIssue255LiveReconciliationCli({
      argv: ['run-nonce'],
      env: {},
    }),
    /recovery authorization/u,
  );
  await assert.rejects(
    runIssue255LiveManifestRecoveryCli({
      argv: ['manifest.json'],
      env: {},
    }),
    /recovery authorization/u,
  );
});

test('issue 255 collector derives integer micros upward from frozen price and provider usage', async () => {
  const executor = issue255DirectCopyExecutor({
    configurationRevision: 'direct-config-v1',
    credentialRevision: 'direct-credential-v1',
    deploymentId: 'deepseek-v4-pro-direct',
    frozenPrices: {
      inputCostPerMillionCny: '0.0000001',
      outputCostPerMillionCny: '0.0000001',
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
                      title: '一',
                      body: '春日护理只描述可核对事实。',
                      conversionHook: '预约',
                    },
                    {
                      title: '二',
                      body: '夏日护理先沟通个人偏好。',
                      conversionHook: '咨询',
                    },
                    {
                      title: '三',
                      body: '秋日护理不添加效果承诺。',
                      conversionHook: '收藏',
                    },
                  ],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 1, completion_tokens: 1 },
        }),
      inputCostPerMillion: 1,
      maxOutputTokens: 1,
      model: 'deepseek-v4-pro',
      outputCostPerMillion: 1,
    },
    priceRevision: 'direct-price-v1',
    receipts: {
      async claimGenerationPost() {},
      async recordProviderHttpRequest() {},
    },
  });
  assert.equal(executor.quoteAmountMicros, 1);

  assert.equal(
    (
      await executor.execute({
        effectId: 'a'.repeat(64),
        requestFingerprint: 'b'.repeat(64),
        runNonce: 'issue-255-integer-cost',
      })
    ).amountMicros,
    1,
  );
});

test('issue 255 live quotes reject zero prices before provider network', () => {
  let networkCalls = 0;
  assert.throws(
    () =>
      issue255TuziExecutor({
        configurationRevision: 'tuzi-config-v1',
        credentialRevision: 'tuzi-credential-v1',
        deploymentId: 'gpt-image-2-tuzi-relay',
        frozenPriceCny: '0',
        modality: 'image_text',
        options: {
          apiKey: 'test-key',
          baseUrl: 'https://api.tu-zi.example/v1',
          credentialVersion: 'issue-255-test-key-v1',
          endpointRevision: 'tuzi-media-v1',
          fetch: async () => {
            networkCalls += 1;
            throw new Error('Network must remain unreachable.');
          },
          image: {
            catalogModelId: 'gpt-image-2',
            costPerImage: 0,
            model: 'gpt-image-2',
          },
          sourceUrlTtlSeconds: 3_600,
          video: {
            catalogModelId: 'seedance-1-5-pro',
            costPerMillionTokens: 3,
            estimatedTokensPerSecond: 1_000_000,
            model: 'seedance-1-5-pro',
          },
        },
        priceRevision: 'tuzi-price-v1',
        receipts: {
          async claimGenerationPost() {},
          async recordProviderHttpRequest() {},
        },
      }),
    /positive frozen price/u,
  );
  assert.equal(networkCalls, 0);
});

test('issue 255 manifest scan allows the authorization envelope but rejects secret-bearing values', () => {
  assert.doesNotThrow(() =>
    assertIssue255SanitizedManifest(
      JSON.stringify({
        authorization: {
          currency: 'CNY',
          generationSubmitCap: 3,
        },
      }),
    ),
  );
  for (const unsafe of [
    { artifactRef: 'https://provider.example/private-output' },
    { note: 'Bearer token-like-value' },
    { apiKey: 'secret-value' },
  ]) {
    assert.throws(
      () => assertIssue255SanitizedManifest(JSON.stringify(unsafe)),
      /secret scan failed/u,
    );
  }
});
