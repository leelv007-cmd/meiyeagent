import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertIssue255SanitizedManifest,
  issue255DirectCopyExecutor,
  issue255TuziExecutor,
} from './issue-255-live-collector.js';
import {
  assertIssue255LiveCollectorLaunch,
  assertIssue255LiveModesMutuallyExclusive,
  preflightIssue255LiveRuntime,
  resolveIssue255LiveEnvelope,
  runIssue255LiveManifestRecoveryCli,
  runIssue255LiveReconciliationCli,
} from './issue-255-live-collector-cli.js';
import { reconcileIssue255LiveRun } from './issue-255-live-reconciliation.js';

const issue255LiveRuntimeEnv = (
  overrides: NodeJS.ProcessEnv = {},
): NodeJS.ProcessEnv => ({
  MODEL_EXECUTION_MODE: 'direct',
  MODEL_MEDIA_EXECUTION_MODE: 'tuzi',
  DEEPSEEK_API_KEY: 'test-deepseek-key',
  MODEL_DIRECT_CATALOG_MODEL_ID: 'deepseek-v4-pro',
  MODEL_DIRECT_CREDENTIAL_VERSION: 'deepseek-key-v1',
  MODEL_DIRECT_ENDPOINT_REVISION: 'deepseek-endpoint-v1',
  MODEL_DIRECT_INPUT_COST_PER_MILLION: '3.2',
  MODEL_DIRECT_OUTPUT_COST_PER_MILLION: '6.3',
  TUZI_MEDIA_API_KEY: 'test-tuzi-key',
  TUZI_MEDIA_BASE_URL: 'https://api.tu-zi.example/v1',
  TUZI_MEDIA_CREDENTIAL_VERSION: 'tuzi-key-v1',
  TUZI_MEDIA_ENDPOINT_REVISION: 'tuzi-endpoint-v1',
  TUZI_MEDIA_SOURCE_URL_TTL_SECONDS: '3600',
  TUZI_GPT_IMAGE_2_COST_PER_IMAGE_CNY: '0.5',
  TUZI_GPT_IMAGE_2_MODEL: 'gpt-image-2',
  TUZI_SEEDANCE_COST_PER_MILLION_TOKENS_CNY: '15',
  TUZI_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND: '21600',
  TUZI_SEEDANCE_MODEL: 'doubao-seedance-1-5-pro_720p',
  ...overrides,
});

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
    assertIssue255LiveCollectorLaunch(
      {
        RUN_LIVE_ISSUE_255: '1',
        MODEL_EXECUTION_MODE: 'direct',
        MODEL_MEDIA_EXECUTION_MODE: 'tuzi',
        PROVIDER_LIVE_COST_CAP_CNY: '0.1',
      },
      () => true,
    ),
    { providerCapMicros: 100_000 },
  );
  assert.throws(
    () =>
      assertIssue255LiveCollectorLaunch(
        {
          RUN_LIVE_ISSUE_255: '1',
          MODEL_EXECUTION_MODE: 'direct',
          MODEL_MEDIA_EXECUTION_MODE: 'tuzi',
          PROVIDER_LIVE_COST_CAP_CNY: '0.1',
        },
        () => false,
      ),
    /requires the shared e2e lock/u,
  );
});

test('issue 255 Tuzi cancellation launch rejects the live collector flag in reverse', () => {
  assert.throws(
    () =>
      assertIssue255LiveModesMutuallyExclusive({
        RUN_LIVE_ISSUE_255: '1',
        RUN_LIVE_TUZI_CANCELLATION_TEST: '1',
      }),
    /mutually exclusive/u,
  );
});

test('issue 255 v4 envelope permits only the coordinator video retry', () => {
  assert.deepEqual(resolveIssue255LiveEnvelope({}, 'original-run'), {
    runNonce: 'original-run',
    modality: 'all',
  });
  assert.deepEqual(
    resolveIssue255LiveEnvelope(
      {
        ISSUE_255_LIVE_RUN_NONCE:
          'issue-255-live-anchors-2026-07-30-v4',
        ISSUE_255_LIVE_MODALITY: 'video',
      },
      'ignored-run',
    ),
    {
      runNonce: 'issue-255-live-anchors-2026-07-30-v4',
      modality: 'video',
    },
  );
  for (const env of [
    {
      ISSUE_255_LIVE_RUN_NONCE:
        'issue-255-live-anchors-2026-07-30-v4',
    },
    { ISSUE_255_LIVE_MODALITY: 'video' },
    {
      ISSUE_255_LIVE_RUN_NONCE:
        'issue-255-live-anchors-2026-07-30-v4',
      ISSUE_255_LIVE_MODALITY: 'copy',
    },
  ]) {
    assert.throws(
      () => resolveIssue255LiveEnvelope(env, 'ignored-run'),
      /coordinator v4 single video retry/u,
    );
  }
});

test('issue 255 live runtime preflight freezes all three approved deployments and positive prices', () => {
  const preflight = preflightIssue255LiveRuntime(issue255LiveRuntimeEnv());

  assert.deepEqual(
    [
      preflight.directDeployment.id,
      preflight.imageDeployment.id,
      preflight.videoDeployment.id,
    ],
    [
      'deepseek-v4-pro-direct',
      'gpt-image-2-tuzi-relay',
      'seedance-1-5-pro-tuzi-relay',
    ],
  );
  assert.deepEqual(preflight.frozenPrices, {
    directInputCostPerMillionCny: '3.2',
    directOutputCostPerMillionCny: '6.3',
    imageCostCny: '0.5',
    videoCostPerMillionTokensCny: '15',
  });
  assert.deepEqual(preflight.videoQuote, {
    durationSeconds: 5,
    estimatedTokensPerSecond: 21_600,
    amountMicros: 1_620_000,
  });

  assert.throws(
    () =>
      preflightIssue255LiveRuntime(
        issue255LiveRuntimeEnv({
          MODEL_DIRECT_CATALOG_MODEL_ID: 'llm-openai',
          MODEL_DIRECT_API_KEY: 'test-openai-key',
          MODEL_DIRECT_BASE_URL: 'https://copy.example.test/v1',
          MODEL_DIRECT_MODEL: 'openai-model',
        }),
      ),
    /could not freeze its approved deployment/u,
  );

  for (const [name, value] of [
    ['MODEL_DIRECT_INPUT_COST_PER_MILLION', '0'],
    ['MODEL_DIRECT_OUTPUT_COST_PER_MILLION', '0'],
    ['TUZI_GPT_IMAGE_2_COST_PER_IMAGE_CNY', '0'],
    ['TUZI_SEEDANCE_COST_PER_MILLION_TOKENS_CNY', '0'],
  ] as const) {
    assert.throws(
      () =>
        preflightIssue255LiveRuntime(
          issue255LiveRuntimeEnv({ [name]: value }),
        ),
      /positive frozen price/u,
    );
  }

  for (const name of [
    'MODEL_DIRECT_INPUT_COST_PER_MILLION',
    'MODEL_DIRECT_OUTPUT_COST_PER_MILLION',
    'TUZI_GPT_IMAGE_2_COST_PER_IMAGE_CNY',
    'TUZI_SEEDANCE_COST_PER_MILLION_TOKENS_CNY',
  ] as const) {
    assert.throws(
      () =>
        preflightIssue255LiveRuntime(
          issue255LiveRuntimeEnv({ [name]: undefined }),
        ),
      /non-negative number/u,
    );
  }

  for (const value of [undefined, '0', '1.5']) {
    assert.throws(
      () =>
        preflightIssue255LiveRuntime(
          issue255LiveRuntimeEnv({
            TUZI_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND: value,
          }),
        ),
      /positive integer/u,
    );
  }

  assert.throws(
    () =>
      preflightIssue255LiveRuntime(
        issue255LiveRuntimeEnv({
          TUZI_SEEDANCE_ESTIMATED_TOKENS_PER_SECOND: '200001',
        }),
      ),
    /video worst-case quote exceeds its approved cap/u,
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

test('issue 255 v3 reconciliation uses the failed-before-billing proof path', async () => {
  let providerLedgerReconciliations = 0;
  let providerRejectionPreparations = 0;
  const expected = [{ status: 'failed_before_billing' as const }];
  const result = await reconcileIssue255LiveRun({
    foundation: {} as never,
    receipts: {
      async prepareCoordinatorVideoV3FailedBeforeBilling() {
        providerRejectionPreparations += 1;
      },
      async confirmFailedBeforeBilling(runNonce: string) {
        assert.equal(
          runNonce,
          'issue-255-live-anchors-2026-07-30-v3',
        );
        return expected;
      },
      async listRun() {
        throw new Error('v3 must not use generic receipt reconciliation');
      },
      async reconcileFromProviderLedger() {
        providerLedgerReconciliations += 1;
        throw new Error('v3 must not require ProviderCost reconciliation');
      },
    } as never,
    runNonce: 'issue-255-live-anchors-2026-07-30-v3',
  });

  assert.equal(result, expected);
  assert.equal(providerRejectionPreparations, 1);
  assert.equal(providerLedgerReconciliations, 0);
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
      async recordProviderHttpResponse() {},
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
          async recordProviderHttpResponse() {},
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
