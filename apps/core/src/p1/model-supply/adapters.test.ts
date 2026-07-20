import assert from 'node:assert/strict';
import test from 'node:test';
import sharp from 'sharp';
import {
  AnthropicDirectRecordedAdapter,
  BifrostLiteLlmComparison,
  FalManagedMediaAdapter,
  GeminiDirectRecordedAdapter,
  GptImage2RecordedAdapter,
  GrokLatestVideoRecordedAdapter,
  KlingLatestRecordedAdapter,
  NanoBanana2RecordedAdapter,
  NanoBananaProRecordedAdapter,
  OpenAiCompatibleLlmExecutionPort,
  OpenAiDirectRecordedAdapter,
  ReplicateManagedMediaAdapter,
  RECORDED_MEDIA_ADAPTER_CONTRACTS,
  RecordedAdapterRouter,
  RecordedMediaAdapterError,
  Seedance2RecordedAdapter,
  Seedream5ProRecordedAdapter,
  VeoLatestRecordedAdapter,
  createModelExecutionRuntime,
  recordedRequest,
} from './adapters.js';
import { MemoryModelAssetStorage, RecordedGatewayPocPort } from './index.js';

test('three direct LLM families cover structured, stream and classified recorded failures', async () => {
  for (const adapter of [
    new OpenAiDirectRecordedAdapter(),
    new AnthropicDirectRecordedAdapter(),
    new GeminiDirectRecordedAdapter(),
  ]) {
    const structured = await adapter.execute(
      recordedRequest(adapter.catalogModelId, 'copy.generate')
    );
    assert.equal(structured.kind, 'completed');
    if (structured.kind === 'completed')
      assert.equal(structured.copyCandidates?.length, 3);

    for (const scenario of [
      '401',
      '403',
      '429',
      '5xx',
      'stream_partial',
    ] as const) {
      adapter.setNextScenario(scenario);
      const response = await adapter.execute(
        recordedRequest(adapter.catalogModelId, 'copy.generate')
      );
      assert.equal(response.kind, 'failure');
      if (response.kind === 'failure') {
        assert.equal(
          response.acceptance,
          scenario === 'stream_partial' ? 'accepted' : 'rejected_before_accept'
        );
        if (scenario === 'stream_partial')
          assert.ok((response.providerCost.usage.outputTokens ?? 0) > 0);
      }
    }
  }
});

test('recorded LLM copy is readable, grounded, and does not expose the internal prompt JSON', async () => {
  const adapter = new OpenAiDirectRecordedAdapter();
  const request = recordedRequest('llm-openai', 'copy.generate');
  request.submission.prompt = JSON.stringify({
    brief: { hook: '记录透亮猫眼的真实到店体验' },
    grounding: {
      city: '杭州',
      name: '暮色美甲',
      price: 299,
      project: '透亮猫眼',
    },
  });
  const response = await adapter.execute(request);
  assert.equal(response.kind, 'completed');
  if (response.kind !== 'completed') return;
  assert.equal(response.copyCandidates?.length, 3);
  assert.ok(
    response.copyCandidates?.every(
      (candidate) =>
        candidate.body.includes('暮色美甲') &&
        candidate.body.includes('¥299') &&
        !candidate.body.includes('"grounding"')
    )
  );
});

test('fixture-only recorded LLM emits strict Canvas Agent JSON without changing recorded mode', async () => {
  const request = recordedRequest('llm-openai', 'text.respond');
  request.submission.workspaceId = 'workspace-agent-fixture';
  request.submission.prompt = [
    'Return strict JSON for the fixed seven Canvas tools only:',
    'Never return provider routing, URLs, credentials, tokens, arbitrary tools, shell commands, or prose.',
    JSON.stringify({
      canvas: {
        projectId: 'project-agent-fixture',
        revision: 3,
        workspaceId: 'workspace-agent-fixture',
      },
      intent: 'Add one checked text node',
    }),
  ].join('\n');

  const fixture = await createModelExecutionRuntime({ mode: 'fixture' }).execution.execute(
    request,
  );
  assert.equal(fixture.kind, 'completed');
  if (fixture.kind !== 'completed') return;
  const plan = JSON.parse(fixture.text ?? '') as {
    operations: Array<{ node?: { id?: string }; tool: string }>;
  };
  assert.equal(plan.operations.length, 1);
  assert.equal(plan.operations[0]?.tool, 'create_node');
  assert.match(plan.operations[0]?.node?.id ?? '', /project-agent-fixture/);

  const recorded = await createModelExecutionRuntime({ mode: 'recorded' }).execution.execute(
    request,
  );
  assert.equal(recorded.kind, 'completed');
  if (recorded.kind === 'completed') {
    assert.equal(recorded.text, request.submission.prompt);
  }
});

test('four image and four video stable adapter classes enforce operation/spec and expose lifecycle contracts', async () => {
  const images = [
    new GptImage2RecordedAdapter(),
    new NanoBanana2RecordedAdapter(),
    new NanoBananaProRecordedAdapter(),
    new Seedream5ProRecordedAdapter(),
  ];
  for (const adapter of images) {
    const request = recordedRequest(adapter.catalogModelId, 'image.generate', {
      width: 1024,
      height: 1024,
    });
    const generated = await adapter.execute(request);
    const edited = await adapter.execute(
      recordedRequest(adapter.catalogModelId, 'image.edit', {
        referenceAssetIds: ['asset-1'],
      })
    );
    assert.equal(generated.kind, 'completed');
    assert.equal(edited.kind, 'completed');
    const task = await adapter.submit(request);
    assert.equal(
      (await adapter.poll(task.taskRef, request)).status,
      'completed'
    );
    assert.equal(
      (await adapter.cancel(task.taskRef, request)).status,
      'cancel_requested'
    );
    adapter.setNextPollStatus('unknown');
    assert.equal((await adapter.poll(task.taskRef, request)).status, 'unknown');
    assert.ok(adapter.assetTtlSeconds > 0);
    assert.equal(adapter.contract.catalogModelId, adapter.catalogModelId);
    assert.ok(adapter.contract.errorCodes.length >= 4);
    assert.match(adapter.contract.adapterRevision, /-v1$/);
    await assert.rejects(
      adapter.execute(recordedRequest(adapter.catalogModelId, 'image.edit')),
      /reference/
    );
    await assert.rejects(
      adapter.execute(
        recordedRequest(adapter.catalogModelId, 'image.generate', {
          width: adapter.contract.dimensions.max + 1,
          height: 1024,
        })
      ),
      /dimensions/
    );
  }

  assert.notEqual(
    RECORDED_MEDIA_ADAPTER_CONTRACTS['nano-banana-2'].priceRevision,
    RECORDED_MEDIA_ADAPTER_CONTRACTS['nano-banana-pro'].priceRevision
  );
  assert.notEqual(
    RECORDED_MEDIA_ADAPTER_CONTRACTS['nano-banana-2'].cost.amount,
    RECORDED_MEDIA_ADAPTER_CONTRACTS['nano-banana-pro'].cost.amount
  );

  for (const adapter of [
    new Seedance2RecordedAdapter(),
    new KlingLatestRecordedAdapter(),
    new GrokLatestVideoRecordedAdapter(),
    new VeoLatestRecordedAdapter(),
  ]) {
    const request = recordedRequest(adapter.catalogModelId, 'video.generate', {
      durationSeconds: 10,
    });
    const task = await adapter.submit(request);
    assert.equal(
      (await adapter.poll(task.taskRef, request)).status,
      'completed'
    );
    assert.equal(
      (await adapter.cancel(task.taskRef, request)).status,
      'cancel_requested'
    );
    assert.ok(adapter.assetTtlSeconds > 0);
    assert.equal(adapter.contract.catalogModelId, adapter.catalogModelId);
    assert.ok(adapter.contract.errorCodes.includes('acceptance_unknown'));
    adapter.setNextPollStatus('unknown');
    assert.equal((await adapter.poll(task.taskRef, request)).status, 'unknown');
    await assert.rejects(
      adapter.submit(
        recordedRequest(adapter.catalogModelId, 'video.generate', {
          durationSeconds: adapter.contract.durationSeconds.max + 1,
        })
      ),
      /duration/
    );
  }
});

test('every recorded media model replays its structured error contract with acceptance, cost, and phase behavior', async () => {
  for (const adapter of [
    new GptImage2RecordedAdapter(),
    new NanoBanana2RecordedAdapter(),
    new NanoBananaProRecordedAdapter(),
    new Seedream5ProRecordedAdapter(),
    new Seedance2RecordedAdapter(),
    new KlingLatestRecordedAdapter(),
    new GrokLatestVideoRecordedAdapter(),
    new VeoLatestRecordedAdapter(),
  ]) {
    assert.equal(
      adapter.contract.errorContracts.length,
      adapter.contract.errorCodes.length
    );
    for (const errorContract of adapter.contract.errorContracts) {
      const operation =
        adapter.contract.modality === 'image'
          ? ('image.generate' as const)
          : ('video.generate' as const);
      const input =
        adapter.contract.modality === 'image'
          ? { width: 1024, height: 1024 }
          : { durationSeconds: 10 };
      const request = recordedRequest(adapter.catalogModelId, operation, input);
      request.submission.workspaceId = `workspace-${adapter.catalogModelId}-${errorContract.code}`;
      adapter.setNextErrorCode(errorContract.code);

      if (errorContract.phase === 'submit') {
        const response = await adapter.execute(request);
        assert.equal(response.kind, 'failure');
        if (response.kind !== 'failure') continue;
        assert.equal(response.errorCode, errorContract.code);
        assert.equal(response.acceptance, errorContract.acceptance);
        assert.equal(response.retryable, errorContract.retryable);
        assert.equal(response.providerCost.amount > 0, errorContract.billable);
        continue;
      }

      const task = await adapter.submit(request);
      assert.ok(Date.parse(task.deadlineAt) > Date.parse(task.createdAt));
      if (errorContract.phase === 'poll') {
        const state = await adapter.poll(task.taskRef, request);
        assert.equal(state.status, 'failed');
        assert.equal(state.errorCode, errorContract.code);
      } else if (errorContract.phase === 'download') {
        await assert.rejects(
          adapter.download({ ...request, taskRef: task.taskRef }),
          (error: unknown) =>
            error instanceof RecordedMediaAdapterError &&
            error.code === errorContract.code &&
            error.contract.billable === errorContract.billable
        );
      } else {
        const state = await adapter.cancel(task.taskRef, request);
        assert.equal(state.status, 'cancel_requested');
        assert.equal(state.errorCode, errorContract.code);
      }
    }
  }
});

test('recorded media 429 cooldown is isolated by workspace and credential', async () => {
  const adapter = new VeoLatestRecordedAdapter();
  const request = recordedRequest('veo-latest', 'video.generate', {
    durationSeconds: 10,
  });
  request.deployment.credentialVersion = 'credential-a';
  adapter.setNextErrorCode('rate_limited');
  const limited = await adapter.execute(request);
  assert.equal(limited.kind, 'failure');
  const cooling = await adapter.execute({
    ...structuredClone(request),
    jobId: 'same-scope-new-job',
  });
  assert.equal(cooling.kind, 'failure');
  if (cooling.kind === 'failure') {
    assert.equal(cooling.errorCode, 'rate_limited');
    assert.match(cooling.message, /cooling down/);
  }
  const isolated = structuredClone(request);
  isolated.jobId = 'isolated-workspace-job';
  isolated.submission.workspaceId = 'workspace-b';
  assert.equal((await adapter.execute(isolated)).kind, 'completed');
});

test('media lifecycle router preserves structured submit, poll, and cancellation errors', async () => {
  const adapter = new VeoLatestRecordedAdapter();
  const router = new RecordedAdapterRouter([adapter]);
  const request = {
    ...recordedRequest('veo-latest', 'video.generate', {
      durationSeconds: 10,
    }),
    effectIdempotencyKey: 'structured-router-errors',
  };

  adapter.setNextErrorCode('preview_unavailable');
  const rejected = await router.submit(request);
  assert.equal(rejected.acceptance, 'rejected_before_accept');
  assert.equal(rejected.errorCode, 'preview_unavailable');
  assert.equal(rejected.retryable, true);
  assert.equal(rejected.providerCost.amount, 0);

  request.jobId = 'structured-router-terminal-job';
  const submitted = await router.submit(request);
  assert.equal(submitted.acceptance, 'accepted');
  adapter.setNextErrorCode('logical_timeout');
  const timedOut = await router.poll({
    ...request,
    taskRef: submitted.taskRef ?? '',
  });
  assert.equal(timedOut.status, 'failed');
  assert.equal(timedOut.errorCode, 'logical_timeout');
  assert.equal(timedOut.retryable, true);

  request.jobId = 'structured-router-cancel-job';
  const cancellable = await router.submit(request);
  adapter.setNextErrorCode('cancel_pending');
  const cancellation = await router.cancel({
    ...request,
    taskRef: cancellable.taskRef ?? '',
  });
  assert.equal(cancellation?.status, 'pending');
  assert.equal(cancellation?.errorCode, 'cancel_pending');
});

test('fal and Replicate managed adapters normalize queue, poll, webhook, cancel and asset ingest', async () => {
  for (const adapter of [
    new FalManagedMediaAdapter(),
    new ReplicateManagedMediaAdapter(),
  ]) {
    const storage = new MemoryModelAssetStorage();
    const request = recordedRequest('veo-latest', 'video.generate', {
      durationSeconds: 10,
    });
    request.deployment.credentialVersion = 'credential-a';
    const task = await adapter.submit(request);
    assert.ok(
      task.taskRef.startsWith(
        adapter.provider === 'fal' ? 'fal-queue-task-' : 'replicate-prediction-'
      )
    );
    assert.equal(
      (await adapter.poll(task.taskRef, request)).status,
      'completed'
    );
    assert.equal(
      (await adapter.webhook(task.taskRef, 'completed', request)).status,
      'completed'
    );
    assert.equal(
      (await adapter.cancel(task.taskRef, request)).status,
      'cancel_requested'
    );
    const scope = {
      workspaceId: 'workspace-a',
      credentialVersion: 'credential-a',
    };
    const asset = await adapter.ingest(task.taskRef, scope, storage);
    assert.ok(asset.objectKey.startsWith('workspace-a/'));
    assert.equal(storage.read(asset.objectKey)?.byteLength, asset.sizeBytes);
    await assert.rejects(
      adapter.ingest(
        task.taskRef,
        { ...scope, workspaceId: 'workspace-b' },
        storage
      ),
      /another workspace or credential/
    );
    const wrongCredential = structuredClone(request);
    wrongCredential.deployment.credentialVersion = 'credential-b';
    await assert.rejects(
      adapter.poll(task.taskRef, wrongCredential),
      /another workspace or credential/
    );
    const wrongWorkspace = structuredClone(request);
    wrongWorkspace.submission.workspaceId = 'workspace-b';
    await assert.rejects(
      adapter.webhook(task.taskRef, 'completed', wrongWorkspace),
      /another workspace or credential/
    );
    await assert.rejects(
      adapter.cancel(task.taskRef, wrongWorkspace),
      /another workspace or credential/
    );
  }
});

test('fal and Replicate satisfy the shared durable media lifecycle port', async () => {
  for (const adapter of [
    new FalManagedMediaAdapter(),
    new ReplicateManagedMediaAdapter(),
  ]) {
    const port = new RecordedAdapterRouter([adapter]);
    const request = {
      ...recordedRequest('veo-latest', 'video.generate', {
        durationSeconds: 10,
      }),
      effectIdempotencyKey: `${adapter.provider}-media-port`,
    };
    request.deployment.credentialVersion = `${adapter.provider}-credential`;

    const submitted = await port.submit(request);
    assert.equal(submitted.acceptance, 'accepted');
    assert.ok(submitted.taskRef);
    const polled = await port.poll({
      ...request,
      taskRef: submitted.taskRef ?? '',
    });
    assert.equal(polled.status, 'completed');
    const downloaded = await port.download({
      ...request,
      taskRef: submitted.taskRef ?? '',
    });
    assert.equal(downloaded.contentType, 'video/mp4');
    assert.ok(downloaded.bytes.byteLength > 0);

    request.jobId = `${adapter.provider}-cancel-job`;
    const cancellable = await port.submit(request);
    const cancelled = await port.cancel({
      ...request,
      taskRef: cancellable.taskRef ?? '',
    });
    assert.equal(cancelled.status, 'cancelled');
  }
});

test('gateway mode routes Veo through the shared fal queue while direct-only video models stay outside it', async () => {
  const runtime = createModelExecutionRuntime({
    mode: 'gateway',
    gateway: 'bifrost',
  });
  assert.ok(runtime.media);
  const veoRequest = {
    ...recordedRequest('veo-latest', 'video.generate', {
      durationSeconds: 10,
    }),
    effectIdempotencyKey: 'gateway-veo-effect',
  };
  const seedanceRequest = {
    ...recordedRequest('seedance-2', 'video.generate', {
      durationSeconds: 10,
    }),
    effectIdempotencyKey: 'gateway-seedance-effect',
  };

  const veo = await runtime.media!.submit(veoRequest);
  const seedance = await runtime.media!.submit(seedanceRequest);
  assert.match(veo.taskRef ?? '', /^fal-queue-task-/);
  assert.match(seedance.taskRef ?? '', /^recorded-task-/);
});

test('configured media runtime routes Ark and Tuzi by deployment channel', async () => {
  const calls: string[] = [];
  const mediaOptions = {
    apiKey: 'media-secret',
    baseUrl: 'https://ark.example.test/v1',
    credentialVersion: 'media-key-v1',
    endpointRevision: 'media-v1',
    image: {
      catalogModelId: 'seedream-5-pro' as const,
      costPerImage: 0.2,
      model: 'image-model',
    },
    sourceUrlTtlSeconds: 3600,
    video: {
      catalogModelId: 'seedance-2' as const,
      costPerMillionTokens: 20,
      estimatedTokensPerSecond: 10_000,
      model: 'video-model',
    },
  };
  const runtime = createModelExecutionRuntime({
    mode: 'recorded',
    arkMedia: {
      ...mediaOptions,
      fetch: async (input) => {
        calls.push(String(input));
        return Response.json({
          data: [{ url: 'https://assets.test/ark.png' }],
        });
      },
    },
    tuziMedia: {
      ...mediaOptions,
      baseUrl: 'https://tuzi.example.test/v1',
      image: {
        catalogModelId: 'gpt-image-2',
        costPerImage: 0.2,
        model: 'gpt-image-2',
      },
      fetch: async (input) => {
        calls.push(String(input));
        return Response.json({
          data: [{ url: 'https://assets.test/tuzi.png' }],
        });
      },
    },
  });
  const arkRequest = recordedRequest('seedream-5-pro', 'image.generate');
  const tuziRequest = recordedRequest('gpt-image-2', 'image.edit', {
    referenceAssetIds: ['reference-image'],
  });
  arkRequest.deployment.executionChannelId = 'channel-seedream-ark-direct';
  tuziRequest.deployment.executionChannelId =
    'channel-tuzi-gpt-image-2-relay';
  const minimalPng = await sharp({
    create: {
      background: { alpha: 1, b: 0, g: 0, r: 0 },
      channels: 4,
      height: 1,
      width: 1,
    },
  })
    .png()
    .toBuffer();

  const ark = await runtime.media!.submit({
    ...arkRequest,
    effectIdempotencyKey: 'ark-image-effect',
  });
  const tuzi = await runtime.media!.submit({
    ...tuziRequest,
    effectIdempotencyKey: 'tuzi-image-effect',
    resolvedReferenceAssets: [
      {
        assetId: 'reference-image',
        bytes: minimalPng,
        contentType: 'image/png',
        kind: 'resolved',
        providerReadableUrl: `data:image/png;base64,${minimalPng.toString('base64')}`,
        sha256: 'reference-image-sha256',
      },
    ],
  });

  assert.equal(ark.acceptance, 'accepted');
  assert.equal(tuzi.acceptance, 'accepted');
  assert.deepEqual(calls, [
    'https://ark.example.test/v1/images/generations',
    'https://tuzi.example.test/v1/images/edits',
  ]);
});

test('configured media runtime routes real speech through the TTS lifecycle', async () => {
  const synthesisRequests: unknown[] = [];
  const runtime = createModelExecutionRuntime({
    mode: 'recorded',
    volcengineTts: {
      approvedPricePerTextWordCny: 0.002,
      credentialVersion: 'tts-credential-v1',
      priceRevision: 'tts-price-approved-v1',
      synthesis: {
        async synthesize(input) {
          synthesisRequests.push(input);
          return {
            billedTextWords: 4,
            bytes: Uint8Array.from([0x49, 0x44, 0x33, 1]),
            contentType: 'audio/mpeg',
          };
        },
      },
      validateAudio: async () => ({ durationSeconds: 1 }),
    },
  });
  assert.ok(runtime.media);
  const base = recordedRequest('seed-tts-2', 'audio.speech', {
    format: 'mp3',
    language: 'zh-CN',
    maxDurationSeconds: 30,
    speed: 1,
    tone: 'natural',
    voice: 'default',
  });
  const request = {
    ...base,
    deployment: {
      ...base.deployment,
      id: 'seed-tts-2-volcengine-direct',
      credentialVersion: 'tts-credential-v1',
      executionChannelId: 'channel-seed-tts-volcengine-direct',
      priceRevision: 'tts-price-approved-v1',
      unitPrice: {
        amountMicros: 2_000,
        currency: 'CNY' as const,
        unit: 'text_word',
      },
    },
    effectIdempotencyKey: 'tts-routing-effect',
  };

  const submitted = await runtime.media!.submit(request);
  assert.equal(submitted.acceptance, 'accepted');
  const state = await runtime.media!.poll({
    ...request,
    taskRef: submitted.taskRef!,
  });
  assert.equal(state.status, 'completed');
  assert.equal(state.providerCost.amount, 0.008);
  assert.equal(
    (
      await runtime.media!.download({
        ...request,
        taskRef: submitted.taskRef!,
      })
    ).contentType,
    'audio/mpeg',
  );
  assert.equal(synthesisRequests.length, 1);
});

test('Bifrost and LiteLLM comparison remains an evidence-backed six-axis report, not product state', () => {
  const comparison = new BifrostLiteLlmComparison().report();
  assert.deepEqual(
    comparison.candidates.map((candidate) => candidate.name),
    ['bifrost', 'litellm']
  );
  assert.equal(comparison.productionDependency, false);
  assert.equal(comparison.productTruthOwner, 'product_core');
  assert.equal(comparison.llmTrack.retryOwner, 'product_core');
  assert.deepEqual(comparison.mediaTrack.directOnlyModels, [
    'seedance-2',
    'kling-latest',
  ]);
  assert.equal(comparison.migration.productionTraffic, false);
  assert.match(comparison.measurementRevision, /^gateway-poc-evidence-/);
  const evidenceIds = new Set(comparison.evidence.map((item) => item.id));
  for (const candidate of comparison.candidates) {
    assert.ok(candidate.deploymentWeight);
    assert.ok(candidate.licenseBoundary);
    assert.ok(candidate.operationalDependencies.length > 0);
    assert.ok(candidate.mediaSupport.llm);
    assert.ok(candidate.migrationCost.requiredSteps.length > 0);
    assert.equal(candidate.upgradeRollback.productionTrafficDuringPoc, false);
    assert.ok(candidate.evidenceRefs.every((id) => evidenceIds.has(id)));
  }
  assert.deepEqual(comparison.migration.directAdapterReductionCandidates, [
    'veo-latest-direct-poc',
  ]);
  assert.ok(evidenceIds.has(comparison.migration.evidenceRef));
});

test('Bifrost and LiteLLM share failure, isolation, cooldown, and redacted evidence behavior', async () => {
  for (const gateway of ['bifrost', 'litellm'] as const) {
    for (const acceptance of [
      'rejected_before_accept',
      'accepted',
      'acceptance_unknown',
    ] as const) {
      const adapter = new RecordedGatewayPocPort(gateway, () => 1_000);
      adapter.failNext('llm-openai', acceptance);
      const request = recordedRequest('llm-openai', 'copy.generate');
      request.submission.workspaceId = `workspace-${gateway}-${acceptance}`;
      request.deployment.credentialVersion = 'credential-v1';
      const failed = await adapter.execute(request);
      assert.equal(failed.kind, 'failure');
      if (failed.kind === 'failure') {
        assert.equal(failed.acceptance, acceptance);
      }

      if (acceptance !== 'rejected_before_accept') {
        const cooling = await adapter.execute(request);
        assert.equal(cooling.kind, 'failure');
        if (cooling.kind === 'failure') {
          assert.equal(cooling.acceptance, 'rejected_before_accept');
          assert.match(cooling.message, /cooling down/);
        }
        const isolated = structuredClone(request);
        isolated.submission.workspaceId = `${request.submission.workspaceId}-other`;
        assert.equal((await adapter.execute(isolated)).kind, 'completed');
      }

      const evidence = JSON.stringify(adapter.safeExecutionEvents());
      assert.doesNotMatch(evidence, /credential-v1|copy prompt|secret/i);
      assert.match(evidence, new RegExp(gateway));
    }
  }
});

test('OpenAI-compatible direct execution makes one request, parses exactly three candidates and calculates observed cost', async () => {
  let calls = 0;
  const adapter = new OpenAiCompatibleLlmExecutionPort({
    catalogModelId: 'llm-openai',
    baseUrl: 'https://llm.example.test/v1',
    apiKey: 'secret-test-key',
    model: 'provider-copy-model',
    inputCostPerMillion: 2,
    outputCostPerMillion: 8,
    fetch: async (_input, init) => {
      calls += 1;
      assert.equal(init?.method, 'POST');
      assert.equal(
        new Headers(init?.headers).get('authorization'),
        'Bearer secret-test-key'
      );
      return new Response(
        JSON.stringify({
          object: 'chat.completion',
          id: 'completion-1',
          created: 1_752_364_800,
          model: 'provider-copy-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  candidates: [
                    { title: 'A', body: 'A body', conversionHook: 'A hook' },
                    { title: 'B', body: 'B body', conversionHook: 'B hook' },
                    { title: 'C', body: 'C body', conversionHook: 'C hook' },
                  ],
                }),
              },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      );
    },
  });

  const response = await adapter.execute(
    recordedRequest('llm-openai', 'copy.generate')
  );

  assert.equal(calls, 1);
  assert.equal(response.kind, 'completed');
  if (response.kind === 'completed') {
    assert.equal(response.copyCandidates?.length, 3);
    assert.equal(response.providerTaskRef, 'completion-1');
    assert.deepEqual(response.providerCost.usage, {
      inputTokens: 100,
      outputTokens: 50,
    });
    assert.equal(response.providerCost.amount, 0.0006);
  }
  const mismatch = await adapter.execute(
    recordedRequest('llm-anthropic', 'copy.generate')
  );
  assert.equal(mismatch.kind, 'failure');
  if (mismatch.kind === 'failure') {
    assert.equal(mismatch.acceptance, 'rejected_before_accept');
  }
  assert.equal(calls, 1);
});

test('OpenAI-compatible text.respond returns one plain-text deliverable', async () => {
  const adapter = new OpenAiCompatibleLlmExecutionPort({
    catalogModelId: 'llm-openai',
    baseUrl: 'https://llm.example.test/v1',
    apiKey: 'secret-test-key',
    model: 'provider-text-model',
    inputCostPerMillion: 2,
    outputCostPerMillion: 8,
    fetch: async () =>
      new Response(
        JSON.stringify({
          object: 'chat.completion',
          id: 'completion-text-1',
          created: 1_752_364_800,
          model: 'provider-text-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'One canvas response.' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 4 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
  });

  const response = await adapter.execute(
    recordedRequest('llm-openai', 'text.respond'),
  );

  assert.equal(response.kind, 'completed');
  if (response.kind === 'completed') {
    assert.equal(response.text, 'One canvas response.');
    assert.equal(response.copyCandidates, undefined);
    assert.equal(response.providerTaskRef, 'completion-text-1');
    assert.deepEqual(response.providerCost.usage, {
      inputTokens: 20,
      outputTokens: 4,
    });
  }
});

test('OpenAI-compatible direct execution rejects title-only candidate variations', async () => {
  const adapter = new OpenAiCompatibleLlmExecutionPort({
    catalogModelId: 'llm-openai',
    baseUrl: 'https://llm.example.test/v1',
    apiKey: 'secret-test-key',
    model: 'provider-copy-model',
    inputCostPerMillion: 2,
    outputCostPerMillion: 8,
    fetch: async () =>
      new Response(
        JSON.stringify({
          object: 'chat.completion',
          id: 'completion-duplicate',
          created: 1_752_364_800,
          model: 'provider-copy-model',
          choices: [
            {
              index: 0,
              message: {
                role: 'assistant',
                content: JSON.stringify({
                  candidates: [
                    {
                      title: '标题一',
                      body: '同一正文',
                      conversionHook: '收藏',
                    },
                    {
                      title: '标题二',
                      body: ' 同一  正文 ',
                      conversionHook: '留言',
                    },
                    {
                      title: '标题三',
                      body: '同一正文',
                      conversionHook: '到店',
                    },
                  ],
                }),
              },
              finish_reason: 'stop',
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } }
      ),
  });

  const response = await adapter.execute(
    recordedRequest('llm-openai', 'copy.generate')
  );
  assert.equal(response.kind, 'failure');
  if (response.kind === 'failure') {
    assert.equal(response.acceptance, 'acceptance_unknown');
    assert.match(response.message, /materially distinct/);
  }
});

test('OpenAI-compatible direct execution classifies 4xx before accept and 5xx or interrupted responses as unknown without retrying', async () => {
  for (const scenario of ['4xx', '5xx', 'interrupted'] as const) {
    let calls = 0;
    const adapter = new OpenAiCompatibleLlmExecutionPort({
      catalogModelId: 'llm-openai',
      baseUrl: 'https://llm.example.test/v1',
      apiKey: 'secret-test-key',
      model: 'provider-copy-model',
      inputCostPerMillion: 2,
      outputCostPerMillion: 8,
      fetch: async () => {
        calls += 1;
        if (scenario === 'interrupted') throw new TypeError('socket closed');
        return new Response('upstream error', {
          status: scenario === '4xx' ? 429 : 503,
        });
      },
    });
    const response = await adapter.execute(
      recordedRequest('llm-openai', 'copy.generate')
    );
    assert.equal(calls, 1);
    assert.equal(response.kind, 'failure');
    if (response.kind === 'failure') {
      assert.equal(
        response.acceptance,
        scenario === '4xx' ? 'rejected_before_accept' : 'acceptance_unknown'
      );
    }
  }
});

test('runtime factory reports honest disabled, recorded, gateway PoC and configured-unverified direct modes', async () => {
  const disabled = createModelExecutionRuntime({ mode: 'disabled' });
  assert.equal(disabled.activation, 'disabled');
  assert.equal(
    (
      await disabled.execution.execute(
        recordedRequest('llm-openai', 'copy.generate')
      )
    ).kind,
    'failure'
  );

  assert.equal(
    createModelExecutionRuntime({ mode: 'recorded' }).activation,
    'recorded_only'
  );
  const gateway = createModelExecutionRuntime({
    mode: 'gateway',
    gateway: 'bifrost',
  });
  assert.equal(gateway.activation, 'recorded_only');
  assert.equal(gateway.gateway, 'bifrost');
  const direct = createModelExecutionRuntime({
    mode: 'direct',
    direct: {
      catalogModelId: 'llm-openai',
      baseUrl: 'https://llm.example.test/v1',
      apiKey: 'configured-secret',
      model: 'provider-copy-model',
      inputCostPerMillion: 1,
      outputCostPerMillion: 1,
      fetch: async () => new Response('', { status: 401 }),
    },
  });
  assert.equal(direct.activation, 'configured_unverified');
  assert.throws(
    () => createModelExecutionRuntime({ mode: 'direct' }),
    /requires explicit direct configuration/
  );
});
