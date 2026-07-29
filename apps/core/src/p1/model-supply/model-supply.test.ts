import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  ContentWorkflowRunner,
  evaluateBeautyOfflineCase,
  InMemoryDurableVideoWorkflowStore,
  ModelSupplyApplicationService,
  RecordedGatewayPocPort,
  RecordedProviderExecutionPort,
  type CatalogModel,
  type ModelDeployment,
  type ModelSupplySubmission,
  type ModelSupplyPlanningControlPlanePort,
  type ProviderExecutionRequest,
  type ProviderExecutionResponse,
} from './index.js';

const models: CatalogModel[] = [
  {
    id: 'copy-quality',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: '文案质量优先',
    qualityRank: 90,
  },
  {
    id: 'copy-domestic',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: '国内文案',
    qualityRank: 70,
  },
  {
    id: 'copy-anthropic',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: 'Anthropic Direct',
    qualityRank: 85,
  },
  {
    id: 'copy-gemini',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: 'Gemini Direct',
    qualityRank: 80,
  },
  {
    id: 'gpt-image-2',
    modality: 'image',
    operations: ['image.generate', 'image.edit'],
    displayName: 'GPT Image 2',
    qualityRank: 90,
  },
  {
    id: 'nano-banana-2',
    modality: 'image',
    operations: ['image.generate', 'image.edit'],
    displayName: 'Nano Banana 2',
    qualityRank: 70,
  },
  {
    id: 'nano-banana-pro',
    modality: 'image',
    operations: ['image.generate', 'image.edit'],
    displayName: 'Nano Banana Pro',
    qualityRank: 85,
  },
  {
    id: 'seedream-5-pro',
    modality: 'image',
    operations: ['image.generate', 'image.edit'],
    displayName: 'Seedream 5.0 Pro',
    qualityRank: 80,
  },
  ...(['seedance-2', 'kling-latest', 'grok-latest-video', 'veo-latest'] as const).map<CatalogModel>(
    (id, index) => ({
      id,
      modality: 'video' as const,
      operations: ['video.generate'],
      displayName: id,
      qualityRank: 80 + index,
    })
  ),
];

const deployments: ModelDeployment[] = [
  {
    id: 'openai-direct',
    catalogModelId: 'copy-quality',
    apiFamily: 'openai',
    channel: 'direct',
    region: 'overseas',
    status: 'active',
  },
  {
    id: 'qwen-direct',
    catalogModelId: 'copy-domestic',
    apiFamily: 'openai',
    channel: 'direct',
    region: 'domestic',
    status: 'active',
  },
  {
    id: 'anthropic-direct',
    catalogModelId: 'copy-anthropic',
    apiFamily: 'anthropic',
    channel: 'direct',
    region: 'overseas',
    status: 'active',
  },
  {
    id: 'gemini-direct',
    catalogModelId: 'copy-gemini',
    apiFamily: 'gemini',
    channel: 'direct',
    region: 'overseas',
    status: 'active',
  },
  ...models
    .filter((model) => model.modality !== 'llm')
    .map<ModelDeployment>((model) => ({
      id: `${model.id}-recorded`,
      catalogModelId: model.id,
      apiFamily: model.modality === 'video' ? 'media' : 'image',
      channel: model.id === 'seedream-5-pro' || model.id === 'seedance-2' ? 'direct' : 'managed',
      region: model.id === 'seedream-5-pro' || model.id === 'seedance-2' ? 'domestic' : 'overseas',
      status: 'active' as const,
    })),
];

function service() {
  return new ModelSupplyApplicationService({
    models,
    deployments,
    execution: new RecordedProviderExecutionPort(),
  });
}

function governedCopyFallbackPlanning(): ModelSupplyPlanningControlPlanePort {
  return {
    async readPlanningState() {
      return {
        routePolicyRevisionId: 'route-policy:copy.generate:quality:r1',
        routePolicy: {
          operation: 'copy.generate' as const,
          qualityTier: 'quality' as const,
          hardConstraints: ['deployment_active', 'data_class'],
          candidateDeploymentIds: ['openai-direct', 'anthropic-direct'],
          maxAttempts: 2,
          fallbackAuthorized: true,
          modelSubstitutionDegradationSurfaces: {
            'anthropic-direct': ['tone_style'],
          },
        },
      };
    },
  };
}

function governedCopyFallbackDeployments() {
  return deployments.map((deployment) =>
    deployment.id === 'openai-direct' ||
    deployment.id === 'anthropic-direct'
      ? {
          ...deployment,
          executionChannelId: `channel-${deployment.id}`,
        }
      : deployment,
  );
}

test('historical Canvas submissions keep input assets without inventing empty node lineage', () => {
  const historicalService = new ModelSupplyApplicationService({
    models: [
      ...models,
      {
        id: 'text-response',
        modality: 'llm',
        operations: ['text.respond'],
        displayName: 'Text Response',
        qualityRank: 80,
      },
    ],
    deployments: [
      ...deployments,
      {
        id: 'text-response-direct',
        catalogModelId: 'text-response',
        apiFamily: 'openai',
        channel: 'direct',
        region: 'domestic',
        status: 'active',
      },
    ],
    execution: new RecordedProviderExecutionPort(),
  });
  const result = historicalService.previewTextSubmission({
    workspaceId: 'workspace-a',
    actorId: 'owner-a',
    idempotencyKey: 'historical-canvas-lineage-1',
    operation: 'text.respond',
    selection: { mode: 'fixed', catalogModelId: 'text-response' },
    dataClass: [],
    prompt: 'Describe this image.',
    origin: {
      kind: 'advanced_canvas',
      projectId: 'project-a',
      revisionId: 'revision-a',
    },
    input: {
      inputAssets: [
        { assetId: 'asset-a', role: 'reference_image' },
      ],
    },
  });

  assert.deepEqual(result.inputAssets, [
    { assetId: 'asset-a', role: 'reference_image' },
  ]);
  assert.equal('inputNodeBindings' in result, false);
});

test('Auto applies data-class hard filtering, saves actual model and creates one primary copy candidate', async () => {
  const result = await service().submit({
    workspaceId: 'workspace-a',
    actorId: 'owner-a',
    idempotencyKey: 'copy-auto-1',
    operation: 'copy.generate',
    selection: { mode: 'auto', profile: 'quality' },
    dataClass: ['pii'],
    prompt: '为皮肤管理项目写小红书文案',
    promptRevision: 'prompt-v3',
    exampleSetRevision: 'examples-v2',
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.snapshot.actualCatalogModelId, 'copy-domestic');
  assert.equal(result.snapshot.reason, 'auto_quality_after_hard_filters');
  assert.equal(result.copyCandidates?.length, 1);
  assert.equal(result.snapshot.promptRevision, 'prompt-v3');
  assert.equal(result.usage.status, 'committed');
  assert.equal(result.providerCost.status, 'observed');
});

test('direct language submissions freeze one resolved prompt binding before provider execution', async () => {
  let executed: ProviderExecutionRequest | undefined;
  let resolveCount = 0;
  const app = new ModelSupplyApplicationService({
    models,
    deployments,
    execution: {
      async execute(request) {
        executed = request;
        return new RecordedProviderExecutionPort().execute(request);
      },
    },
    promptResolver: {
      async resolve({ operation }) {
        resolveCount += 1;
        return {
          name: 'harness/copy-generation',
          version: '23',
          content: `frozen:${operation}`,
          contentHash: contentHash(`frozen:${operation}`),
          label: 'production',
          source: 'langfuse',
          isFallback: false,
        };
      },
    },
  });

  const result = await app.submit({
    workspaceId: 'workspace-prompt-binding',
    actorId: 'owner-prompt-binding',
    idempotencyKey: 'copy-prompt-binding-1',
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: 'copy-quality' },
    dataClass: [],
    prompt: 'Write one grounded option.',
  });

  assert.equal(resolveCount, 1);
  assert.deepEqual(executed?.submission.promptBinding, {
    name: 'harness/copy-generation',
    version: '23',
    content: 'frozen:copy.generate',
    contentHash: contentHash('frozen:copy.generate'),
    label: 'production',
    source: 'langfuse',
    isFallback: false,
  });
  assert.deepEqual(result.snapshot.promptReference, {
    name: 'harness/copy-generation',
    version: '23',
    contentHash: contentHash('frozen:copy.generate'),
    label: 'production',
    source: 'langfuse',
    isFallback: false,
  });
  assert.equal(
    Object.hasOwn(result.snapshot.promptReference ?? {}, 'content'),
    false,
  );
});

test('direct language prompt fallbacks enter the Harness audit outbox without prompt content', async () => {
  const languageModel: CatalogModel = {
    id: 'all-language-operations',
    modality: 'llm',
    operations: ['copy.generate', 'copy.adapt', 'text.respond'],
    displayName: 'All language operations',
    qualityRank: 90,
  };
  const languageDeployment: ModelDeployment = {
    id: 'all-language-operations-direct',
    catalogModelId: languageModel.id,
    apiFamily: 'openai',
    channel: 'direct',
    region: 'domestic',
    status: 'active',
  };
  const audits: Array<Record<string, unknown>> = [];
  let resolverCalls = 0;
  const promptNames = {
    'copy.generate': 'harness/copy-generation',
    'copy.adapt': 'harness/platform-adaptation',
    'text.respond': 'harness/text-response',
  } as const;
  const app = new ModelSupplyApplicationService({
    models: [languageModel],
    deployments: [languageDeployment],
    execution: new RecordedProviderExecutionPort(),
    promptResolver: {
      async resolve({ operation }) {
        resolverCalls += 1;
        const content = `builtin:${operation}`;
        return {
          name: promptNames[operation],
          version: 'builtin-v1',
          content,
          contentHash: contentHash(content),
          label: 'production',
          source: 'builtin',
          isFallback: true,
          fallbackReason: 'http_503',
        };
      },
    },
    promptAudits: {
      async appendPromptAudit(event) {
        audits.push(
          structuredClone(event) as unknown as Record<string, unknown>,
        );
      },
    },
  });

  for (const operation of [
    'copy.generate',
    'copy.adapt',
    'text.respond',
  ] as const) {
    await app.submit({
      workspaceId: 'workspace-direct-fallback',
      actorId: 'owner-direct-fallback',
      correlationId: `correlation-${operation}`,
      idempotencyKey: `direct-fallback-${operation}`,
      operation,
      selection: { mode: 'fixed', catalogModelId: languageModel.id },
      dataClass: [],
      prompt: `Execute ${operation}.`,
    });
  }

  assert.equal(resolverCalls, 3);
  assert.equal(
    audits.filter(({ eventType }) => eventType === 'langfuse_prompt_fallback')
      .length,
    3,
  );
  assert.equal(JSON.stringify(audits).includes('builtin:copy.generate'), false);
  assert.deepEqual(
    audits
      .filter(({ eventType }) => eventType === 'langfuse_prompt_fallback')
      .map(({ payload }) => (payload as { promptKey: string }).promptKey),
    ['copyGeneration', 'platformAdaptation', 'textResponse'],
  );
});

test('prompt fallback audit identity ignores correlation ids and includes frozen lineage', async () => {
  const auditIdFor = async (
    promptBinding: ModelSupplySubmission['promptBinding'],
    correlationId: string,
  ) => {
    const audits: Array<{ id: string }> = [];
    const app = new ModelSupplyApplicationService({
      models,
      deployments,
      execution: new RecordedProviderExecutionPort(),
      promptAudits: {
        async appendPromptAudit(event) {
          audits.push(event);
        },
      },
    });
    await app.prepareSubmission({
      workspaceId: 'workspace-stable-prompt-audit',
      actorId: 'owner-stable-prompt-audit',
      correlationId,
      idempotencyKey: 'stable-prompt-audit',
      operation: 'copy.generate',
      selection: { mode: 'fixed', catalogModelId: 'copy-quality' },
      dataClass: [],
      prompt: 'Stable prompt audit identity.',
      promptBinding,
    });
    return audits[0]?.id;
  };
  const content = 'builtin:stable-copy-generation';
  const binding = {
    name: 'harness/copy-generation',
    version: 'builtin-v1',
    content,
    contentHash: contentHash(content),
    label: 'production',
    source: 'builtin' as const,
    isFallback: true,
    fallbackReason: 'request_failed',
  };

  const first = await auditIdFor(binding, 'correlation-first');
  const replay = await auditIdFor(binding, 'correlation-retry');
  const changedVersion = await auditIdFor(
    { ...binding, version: 'builtin-v2' },
    'correlation-first',
  );
  const changedSource = await auditIdFor(
    { ...binding, source: 'langfuse' },
    'correlation-first',
  );
  const changedReason = await auditIdFor(
    { ...binding, fallbackReason: 'http_503' },
    'correlation-first',
  );

  assert.equal(first, replay);
  assert.notEqual(first, changedVersion);
  assert.notEqual(first, changedSource);
  assert.notEqual(first, changedReason);
});

test('explicit frozen prompt binding wins on replay and resolver failures stop before provider I/O', async () => {
  let providerCalls = 0;
  let resolverCalls = 0;
  const explicit = {
    name: 'harness/text-response',
    version: '29',
    content: 'frozen:text-response',
    contentHash: contentHash('frozen:text-response'),
    label: 'production',
    source: 'langfuse' as const,
    isFallback: false,
  };
  const textModel = {
    ...models[0]!,
    id: 'text-response-prompt-binding',
    operations: ['text.respond' as const],
  };
  const textDeployment = {
    ...deployments[0]!,
    id: 'text-response-prompt-binding-direct',
    catalogModelId: textModel.id,
  };
  const app = new ModelSupplyApplicationService({
    models: [textModel],
    deployments: [textDeployment],
    execution: {
      async execute(request) {
        providerCalls += 1;
        assert.deepEqual(request.submission.promptBinding, explicit);
        return {
          kind: 'completed' as const,
          text: 'observed text',
          providerCost: {
            amount: 0,
            currency: 'USD' as const,
            usage: {},
          },
        };
      },
    },
    promptResolver: {
      async resolve() {
        resolverCalls += 1;
        throw new Error('prompt resolution unavailable');
      },
    },
  });

  await app.submit({
    workspaceId: 'workspace-explicit-prompt',
    actorId: 'owner-explicit-prompt',
    idempotencyKey: 'text-explicit-prompt-1',
    operation: 'text.respond',
    selection: { mode: 'fixed', catalogModelId: textModel.id },
    dataClass: [],
    prompt: 'Read the visible text.',
    promptBinding: explicit,
  });
  assert.equal(resolverCalls, 0);
  assert.equal(providerCalls, 1);

  await app.submit({
    workspaceId: 'workspace-explicit-prompt',
    actorId: 'owner-explicit-prompt',
    idempotencyKey: 'text-explicit-prompt-1',
    operation: 'text.respond',
    selection: { mode: 'fixed', catalogModelId: textModel.id },
    dataClass: [],
    prompt: 'Read the visible text.',
  });
  assert.equal(resolverCalls, 0);
  assert.equal(providerCalls, 1);

  await assert.rejects(
    app.submit({
      workspaceId: 'workspace-explicit-prompt',
      actorId: 'owner-explicit-prompt',
      idempotencyKey: 'text-missing-prompt-1',
      operation: 'text.respond',
      selection: { mode: 'fixed', catalogModelId: textModel.id },
      dataClass: [],
      prompt: 'Read the visible text.',
    }),
    /prompt resolution unavailable/u,
  );
  assert.equal(resolverCalls, 1);
  assert.equal(providerCalls, 1);
});

function contentHash(content: string) {
  return createHash('sha256').update(content).digest('hex');
}

test('fixed selection never crosses CatalogModel and inactive deployments cannot submit', async () => {
  const inactive = deployments.map((deployment) =>
    deployment.catalogModelId === 'gpt-image-2'
      ? { ...deployment, status: 'inactive' as const }
      : deployment
  );
  const app = new ModelSupplyApplicationService({
    models,
    deployments: inactive,
    execution: new RecordedProviderExecutionPort(),
  });

  await assert.rejects(
    app.submit({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      idempotencyKey: 'image-inactive-1',
      operation: 'image.generate',
      selection: { mode: 'fixed', catalogModelId: 'gpt-image-2' },
      dataClass: [],
      prompt: '门店环境氛围图',
    }),
    /not active/
  );
});

test('OpenAI, Anthropic and Gemini direct profiles share the recorded LLM contract without leaking SDK types', async () => {
  const app = service();
  for (const catalogModelId of ['copy-quality', 'copy-anthropic', 'copy-gemini']) {
    const result = await app.submit({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      idempotencyKey: `llm-family-${catalogModelId}`,
      operation: 'copy.generate',
      selection: { mode: 'fixed', catalogModelId },
      dataClass: [],
      prompt: '三条美业内容候选',
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.snapshot.actualCatalogModelId, catalogModelId);
    assert.equal(result.copyCandidates?.length, 1);
  }
});

test('language quality probe rejects text output for copy.generate', async () => {
  const app = new ModelSupplyApplicationService({
    models,
    deployments,
    execution: {
      async execute() {
        return {
          kind: 'completed' as const,
          text: 'Wrong output shape',
          providerCost: {
            amount: 0.01,
            currency: 'USD' as const,
            usage: { outputTokens: 3 },
          },
        };
      },
    },
  });

  await assert.rejects(
    app.executeLanguageQualityProbe({
      workspaceId: 'workspace-probe-shape',
      actorId: 'admin-a',
      idempotencyKey: 'probe-copy-generate-wrong-shape',
      operation: 'copy.generate',
      selection: { mode: 'fixed', catalogModelId: 'copy-quality' },
      dataClass: [],
      prompt: 'Generate three copy candidates.',
    }),
    /copy\.generate.*copy candidates/i,
  );
});

test('language quality probe rejects copy candidates for copy.adapt', async () => {
  const app = new ModelSupplyApplicationService({
    models: [
      {
        ...models[0]!,
        operations: ['copy.adapt'],
      },
    ],
    deployments: [deployments[0]!],
    execution: new RecordedProviderExecutionPort(),
  });

  await assert.rejects(
    app.executeLanguageQualityProbe({
      workspaceId: 'workspace-probe-shape',
      actorId: 'admin-a',
      idempotencyKey: 'probe-copy-adapt-wrong-shape',
      operation: 'copy.adapt',
      selection: { mode: 'fixed', catalogModelId: 'copy-quality' },
      dataClass: [],
      prompt: 'Adapt this copy for each platform.',
    }),
    /copy\.adapt.*platform variants/i,
  );
});

test('language quality probe rejects copy candidates for text.respond', async () => {
  const app = new ModelSupplyApplicationService({
    models: [
      {
        ...models[0]!,
        operations: ['text.respond'],
      },
    ],
    deployments: [deployments[0]!],
    execution: {
      async execute() {
        return {
          kind: 'completed' as const,
          copyCandidates: [
            {
              title: 'Wrong candidate',
              body: 'This is not a plain text response.',
              conversionHook: 'Wrong shape',
            },
          ],
          providerCost: {
            amount: 0.01,
            currency: 'USD' as const,
            usage: { outputTokens: 8 },
          },
        };
      },
    },
  });

  await assert.rejects(
    app.executeLanguageQualityProbe({
      workspaceId: 'workspace-probe-shape',
      actorId: 'admin-a',
      idempotencyKey: 'probe-text-respond-wrong-shape',
      operation: 'text.respond',
      selection: { mode: 'fixed', catalogModelId: 'copy-quality' },
      dataClass: [],
      prompt: 'Return one plain-text response.',
    }),
    /text\.respond.*plain text/i,
  );
});

test('language quality probe rejects empty operation-shaped output', async () => {
  const cases = [
    {
      operation: 'copy.generate' as const,
      response: {
        kind: 'completed' as const,
        copyCandidates: [],
        providerCost: {
          amount: 0.01,
          currency: 'USD' as const,
          usage: { outputTokens: 0 },
        },
      },
    },
    {
      operation: 'copy.adapt' as const,
      response: {
        kind: 'completed' as const,
        platformVariants: {},
        providerCost: {
          amount: 0.01,
          currency: 'USD' as const,
          usage: { outputTokens: 0 },
        },
      } as ProviderExecutionResponse,
    },
    {
      operation: 'text.respond' as const,
      response: {
        kind: 'completed' as const,
        text: '   ',
        providerCost: {
          amount: 0.01,
          currency: 'USD' as const,
          usage: { outputTokens: 0 },
        },
      },
    },
  ];

  for (const { operation, response } of cases) {
    const app = new ModelSupplyApplicationService({
      models: [
        {
          ...models[0]!,
          operations: [operation],
        },
      ],
      deployments: [deployments[0]!],
      execution: {
        async execute() {
          return response as ProviderExecutionResponse;
        },
      },
    });

    await assert.rejects(
      app.executeLanguageQualityProbe({
        workspaceId: 'workspace-probe-empty',
        actorId: 'admin-a',
        idempotencyKey: `probe-${operation}-empty`,
        operation,
        selection: { mode: 'fixed', catalogModelId: 'copy-quality' },
        dataClass: [],
        prompt: 'Return a non-empty probe output.',
      }),
      new RegExp(operation.replace('.', '\\.')),
    );
  }
});

test('custom LLM executes only by fixed selection and freezes its API family', async () => {
  const app = new ModelSupplyApplicationService({
    models: [
      {
        id: 'llm-custom',
        modality: 'llm',
        operations: ['copy.generate'],
        displayName: '自定义供应商',
        qualityRank: 0,
      },
    ],
    deployments: [
      {
        id: 'custom-direct',
        catalogModelId: 'llm-custom',
        apiFamily: 'custom',
        channel: 'direct',
        region: 'overseas',
        status: 'active',
      },
    ],
    execution: new RecordedProviderExecutionPort(),
  });

  const simulation = app.simulateRoute({
    workspaceId: 'workspace-custom',
    operation: 'copy.generate',
    selection: { mode: 'auto', profile: 'quality' },
    dataClass: [],
    failureScenario: 'success',
  });
  assert.equal(simulation.rankedCandidates.length, 0);
  assert.deepEqual(simulation.candidateEvaluations[0]?.exclusionReasons, [
    'custom_requires_fixed_selection',
  ]);

  const result = await app.submit({
    workspaceId: 'workspace-custom',
    actorId: 'admin-a',
    idempotencyKey: 'custom-fixed-selection',
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: 'llm-custom' },
    dataClass: [],
    prompt: '为测试门店生成三条文案',
  });
  assert.equal(result.snapshot.allowedCandidates?.[0]?.apiFamily, 'custom');
  assert.equal(result.copyCandidates?.length, 1);
  assert.ok(result.providerCost.amount > 0);
});

test('safe-only copy refunds acceptance_unknown and never retries another model', async () => {
  const execution = new RecordedProviderExecutionPort();
  const app = new ModelSupplyApplicationService({ models, deployments, execution });
  execution.failNext('copy-quality', 'acceptance_unknown');

  const result = await app.submit({
    workspaceId: 'workspace-a',
    actorId: 'owner-a',
    idempotencyKey: 'copy-fixed-unknown',
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: 'copy-quality' },
    dataClass: [],
    prompt: '同城到店文案',
  });

  assert.equal(result.status, 'unknown');
  assert.equal(result.attempt.acceptance, 'acceptance_unknown');
  assert.equal(app.attempts().length, 1);
  assert.equal(result.usage.status, 'refunded');
});

test('a provider rejection before acceptance can be retried instead of replaying the failed result', async () => {
  const recorded = new RecordedProviderExecutionPort();
  let executions = 0;
  const execution = {
    async execute(request: ProviderExecutionRequest) {
      executions += 1;
      return recorded.execute(request);
    },
  };
  const app = new ModelSupplyApplicationService({
    models,
    deployments,
    execution,
  });
  const submission = {
    workspaceId: 'workspace-a',
    actorId: 'owner-a',
    idempotencyKey: 'copy-fixed-retry-after-rejection',
    operation: 'copy.generate' as const,
    selection: {
      mode: 'fixed' as const,
      catalogModelId: 'copy-quality',
    },
    dataClass: [],
    prompt: '供应商瞬时拒绝后重试',
  };
  recorded.failNext('copy-quality', 'rejected_before_accept');

  const failed = await app.submit(submission);
  const retried = await app.submit(submission);

  assert.equal(failed.status, 'failed');
  assert.equal(retried.status, 'completed');
  assert.equal(executions, 2);
});

test('route simulator shares real hard filters and ranking without executing a provider', () => {
  const app = service();
  const simulation = app.simulateRoute({
    workspaceId: 'workspace-route-simulator',
    operation: 'copy.generate',
    selection: {
      mode: 'auto',
      profile: 'quality',
      fallbackConsent: true,
    },
    dataClass: [],
    failureScenario: 'rejected_before_accept',
    unavailableDeploymentIds: ['openai-direct'],
  });

  assert.equal(simulation.rankedCandidates[0]?.deploymentId, 'anthropic-direct');
  assert.equal(simulation.rankedCandidates[1]?.deploymentId, 'gemini-direct');
  assert.deepEqual(
    simulation.candidateEvaluations.find(
      (candidate) => candidate.deploymentId === 'openai-direct',
    )?.exclusionReasons,
    ['simulated_unavailable'],
  );
  assert.deepEqual(simulation.expectedOutcome, {
    action: 'fallback',
    attemptLimit: 2,
    expectedAttempts: 2,
    primaryDeploymentId: 'anthropic-direct',
    fallbackDeploymentId: 'gemini-direct',
    reason: 'safe_auto_fallback',
  });
  assert.deepEqual(simulation.estimatedMaximumCost, {
    amountMicros: 40_000,
    currency: 'USD',
    source: 'recorded_estimate',
    unit: 'request',
  });
  assert.equal(app.attempts().length, 0);
});

test('route simulator explains data-class exclusions and safe-only stop semantics', () => {
  const app = service();
  const sensitive = app.simulateRoute({
    workspaceId: 'workspace-route-sensitive',
    operation: 'image.generate',
    selection: { mode: 'fixed', catalogModelId: 'gpt-image-2' },
    dataClass: ['contains_face'],
    failureScenario: 'success',
  });
  assert.equal(sensitive.rankedCandidates.length, 0);
  assert.equal(
    sensitive.candidateEvaluations.find(
      (candidate) => candidate.deploymentId === 'gpt-image-2-recorded',
    )?.exclusionReasons.includes('data_class_disallowed'),
    true,
  );
  assert.equal(sensitive.expectedOutcome.action, 'awaiting_selection');

  const unknown = app.simulateRoute({
    workspaceId: 'workspace-route-unknown',
    operation: 'copy.generate',
    selection: { mode: 'auto', profile: 'quality', fallbackConsent: true },
    dataClass: [],
    failureScenario: 'acceptance_unknown',
  });
  assert.equal(unknown.expectedOutcome.action, 'recover_without_resubmit');
  assert.equal(unknown.expectedOutcome.expectedAttempts, 1);
  assert.equal(unknown.expectedOutcome.reason, 'provider_acceptance_unknown');
  assert.equal(app.attempts().length, 0);
});

test('Auto settles and refunds before an undeclared cross-model fallback', async () => {
  const recorded = new RecordedProviderExecutionPort();
  let checkpointCalls = 0;
  let providerCalls = 0;
  let settlementCalls = 0;
  let settledUsageStatus: string | undefined;
  const app = new ModelSupplyApplicationService({
    models,
    deployments,
    execution: {
      async execute(request) {
        providerCalls += 1;
        return recorded.execute(request);
      },
    },
    ledger: {
      async checkpointAttempt() {
        checkpointCalls += 1;
        return { replayed: false };
      },
      async settleAttempt({ result }) {
        settlementCalls += 1;
        settledUsageStatus = result.usage.status;
      },
    },
  });
  recorded.failNext('copy-quality', 'rejected_before_accept');

  const result = await app.submit({
    workspaceId: 'workspace-undeclared-fallback',
    actorId: 'owner-a',
    idempotencyKey: 'copy-auto-undeclared-fallback',
    operation: 'copy.generate',
    selection: { mode: 'auto', profile: 'quality' },
    dataClass: [],
    prompt: '不得静默换模型',
  });
  assert.equal(result.status, 'failed');
  assert.equal(result.usage.status, 'refunded');
  assert.deepEqual(
    {
      checkpointCalls,
      providerCalls,
      settlementCalls,
      settledUsageStatus,
    },
    {
      checkpointCalls: 1,
      providerCalls: 1,
      settlementCalls: 1,
      settledUsageStatus: 'refunded',
    },
  );
});

test('Auto records every pre-accept fallback attempt and provider cost under one generation job', async () => {
  const recorded = new RecordedProviderExecutionPort();
  const requests: ProviderExecutionRequest[] = [];
  const promptAudits: Array<Record<string, unknown>> = [];
  let promptResolutions = 0;
  const app = new ModelSupplyApplicationService({
    models,
    deployments: governedCopyFallbackDeployments(),
    execution: {
      async execute(request) {
        requests.push(structuredClone(request));
        return recorded.execute(request);
      },
    },
    promptResolver: {
      async resolve() {
        promptResolutions += 1;
        const content = 'frozen:fallback-copy-generation';
        return {
          name: 'harness/copy-generation',
          version: '43',
          content,
          contentHash: contentHash(content),
          label: 'production',
          source: 'builtin',
          isFallback: true,
          fallbackReason: 'request_failed',
        };
      },
    },
    promptAudits: {
      async appendPromptAudit(event) {
        promptAudits.push(
          structuredClone(event) as unknown as Record<string, unknown>,
        );
      },
    },
    planningControlPlane: governedCopyFallbackPlanning(),
  });
  recorded.failNext('copy-quality', 'rejected_before_accept');
  const result = await app.submit({
    workspaceId: 'workspace-a',
    actorId: 'owner-a',
    idempotencyKey: 'copy-auto-fallback',
    operation: 'copy.generate',
    selection: { mode: 'auto', profile: 'quality' },
    dataClass: [],
    prompt: 'Auto 回退合同',
  });
  assert.equal(result.status, 'completed');
  assert.equal(result.snapshot.actualCatalogModelId, 'copy-anthropic');
  assert.equal(result.attempts.length, 2);
  assert.equal(new Set(result.attempts.map((attempt) => attempt.jobId)).size, 1);
  assert.equal(result.providerCosts.length, 2);
  assert.deepEqual(
    result.failoverAvailabilityEvents?.[0]?.degradationSurfaces,
    ['tone_style'],
  );
  assert.deepEqual(
    result.providerCosts[1]?.failover?.degradationSurfaces,
    ['tone_style'],
  );
  assert.equal(promptResolutions, 1);
  assert.equal(promptAudits.length, 1);
  assert.equal(promptAudits[0]?.eventType, 'langfuse_prompt_fallback');
  assert.equal(requests.length, 2);
  assert.deepEqual(
    requests.map(({ submission }) => submission.promptBinding),
    [requests[0]?.submission.promptBinding, requests[0]?.submission.promptBinding],
  );
});

test('Auto keeps Product Core as the only retry owner and stops after two pre-accept attempts', async () => {
  const execution = new RecordedProviderExecutionPort();
  const app = new ModelSupplyApplicationService({
    models,
    deployments: governedCopyFallbackDeployments(),
    execution,
    planningControlPlane: governedCopyFallbackPlanning(),
  });
  execution.failNext('copy-quality', 'rejected_before_accept');
  execution.failNext('copy-anthropic', 'rejected_before_accept');
  const result = await app.submit({
    workspaceId: 'workspace-a',
    actorId: 'owner-a',
    idempotencyKey: 'copy-auto-two-attempt-limit',
    operation: 'copy.generate',
    selection: { mode: 'auto', profile: 'quality' },
    dataClass: [],
    prompt: '最多两次',
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.attempts.length, 2);
  assert.equal(app.attempts().length, 2);
});

test('Auto honors explicit frozen fallback refusal after rejection-before-accept', async () => {
  const execution = new RecordedProviderExecutionPort();
  const app = new ModelSupplyApplicationService({ models, deployments, execution });
  execution.failNext('copy-quality', 'rejected_before_accept');
  const result = await app.submit({
    workspaceId: 'workspace-a',
    actorId: 'owner-a',
    idempotencyKey: 'copy-auto-no-fallback',
    operation: 'copy.generate',
    selection: { mode: 'auto', profile: 'quality', fallbackConsent: false },
    dataClass: [],
    prompt: '禁止自动回退',
  });

  assert.equal(result.status, 'failed');
  assert.equal(result.attempts.length, 1);
});

test('all admitted image and video models use the same durable asset and cost contract', async () => {
  const app = service();
  for (const model of models.filter((candidate) => candidate.modality !== 'llm')) {
    const result = await app.submit({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      idempotencyKey: `recorded-${model.id}`,
      operation: model.modality === 'image' ? 'image.edit' : 'video.generate',
      selection: { mode: 'fixed', catalogModelId: model.id },
      dataClass: [],
      prompt: `${model.displayName} recorded contract`,
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.snapshot.actualCatalogModelId, model.id);
    assert.ok(result.asset?.objectKey.startsWith('workspace-a/'));
    assert.equal(result.asset?.sha256.length, 64);
    assert.equal(result.providerCost.status, 'observed');
  }
});

test('application service writes a completed generation through the repository sink before returning', async () => {
  const persisted: Array<{ workspaceId: string; jobId: string }> = [];
  const app = new ModelSupplyApplicationService({
    models,
    deployments,
    execution: new RecordedProviderExecutionPort(),
    resultSink: {
      async saveResult(workspaceId, result) {
        persisted.push({ workspaceId, jobId: result.jobId });
      },
    },
  });
  const result = await app.submit({
    workspaceId: 'workspace-a',
    actorId: 'owner-a',
    idempotencyKey: 'persist-result-1',
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: 'copy-quality' },
    dataClass: [],
    prompt: '持久化结果',
  });
  assert.deepEqual(persisted, [{ workspaceId: 'workspace-a', jobId: result.jobId }]);
});

test('managed-media PoC denies sensitive data before the shared external channel and records a durable task reference', async () => {
  const app = service();
  await assert.rejects(
    app.submit({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      idempotencyKey: 'media-sensitive',
      operation: 'video.generate',
      selection: { mode: 'fixed', catalogModelId: 'veo-latest' },
      dataClass: ['contains_face'],
      prompt: '顾客到店视频',
    }),
    /data class/
  );

  const result = await app.submit({
    workspaceId: 'workspace-a',
    actorId: 'owner-a',
    idempotencyKey: 'media-poc',
    operation: 'video.generate',
    selection: { mode: 'fixed', catalogModelId: 'veo-latest' },
    dataClass: [],
    prompt: '门店空镜视频',
  });
  assert.equal(result.attempt.providerTaskRef?.startsWith('recorded-task-'), true);
  assert.equal(result.asset?.sourceTaskRef, result.attempt.providerTaskRef);
});

test('deployment data-class policy honors regional defaults and explicit restrictions', async () => {
  const restrictedDeployments = deployments.map((deployment) =>
    deployment.catalogModelId === 'copy-domestic'
      ? {
          ...deployment,
          allowedDataClasses: ['public'] as ModelDeployment['allowedDataClasses'],
        }
      : deployment
  );
  const app = new ModelSupplyApplicationService({
    models,
    deployments: restrictedDeployments,
    execution: new RecordedProviderExecutionPort(),
  });

  await assert.rejects(
    app.submit({
      workspaceId: 'workspace-policy',
      actorId: 'owner-policy',
      idempotencyKey: 'restricted-domestic-pii',
      operation: 'copy.generate',
      selection: { mode: 'fixed', catalogModelId: 'copy-domestic' },
      dataClass: ['pii'],
      prompt: '敏感顾客资料不得越过显式分类策略',
    }),
    /not allowed by the deployment policy/
  );

  const defaultDomesticResult = await service().submit({
    workspaceId: 'workspace-policy',
    actorId: 'owner-policy',
    idempotencyKey: 'default-domestic-pii',
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: 'copy-domestic' },
    dataClass: ['pii'],
    prompt: '国产 deployment 未声明时使用国产默认分类',
  });
  assert.equal(
    defaultDomesticResult.snapshot.actualCatalogModelId,
    'copy-domestic'
  );

  const overseasCannotExpand = new ModelSupplyApplicationService({
    models,
    deployments: deployments.map((deployment) =>
      deployment.catalogModelId === 'copy-quality'
        ? {
            ...deployment,
            allowedDataClasses: [
              'public',
              'pii',
            ] as ModelDeployment['allowedDataClasses'],
          }
        : deployment
    ),
    execution: new RecordedProviderExecutionPort(),
  });
  await assert.rejects(
    overseasCannotExpand.submit({
      workspaceId: 'workspace-policy',
      actorId: 'owner-policy',
      idempotencyKey: 'overseas-explicit-pii',
      operation: 'copy.generate',
      selection: { mode: 'fixed', catalogModelId: 'copy-quality' },
      dataClass: ['pii'],
      prompt: '海外 deployment 的显式声明不得扩大区域硬边界',
    }),
    /not allowed by the deployment policy/
  );
});

test('accepted frozen routes do not reread a later deployment data-class policy', async () => {
  const app = service();
  const frozen = app.freezeFixedRoute({
    workspaceId: 'workspace-frozen-policy',
    operation: 'copy.generate',
    catalogModelId: 'copy-domestic',
    dataClass: ['medical'],
  });
  app.applyCatalogRevision(
    'workspace-frozen-policy',
    'restricted-policy-v2',
    models,
    deployments.map((deployment) =>
      deployment.catalogModelId === 'copy-domestic'
        ? {
            ...deployment,
            allowedDataClasses: ['public'] as ModelDeployment['allowedDataClasses'],
          }
        : deployment
    )
  );

  const replayed = await app.submit({
    workspaceId: 'workspace-frozen-policy',
    actorId: 'owner-frozen-policy',
    idempotencyKey: 'frozen-medical-policy',
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: 'copy-domestic' },
    dataClass: ['medical'],
    prompt: '已受理冻结路由不得重读后发部署策略',
    frozenRouteSnapshot: frozen,
  });
  assert.equal(replayed.snapshot.id, frozen.id);
  assert.deepEqual(replayed.snapshot.dataClass, ['medical']);
});

test('frozen routes execute the credential, policy, price, channel, and model version that were recorded', async () => {
  const recorded = new RecordedProviderExecutionPort();
  let executed: ProviderExecutionRequest | undefined;
  const originalModels = models.map((model) =>
    model.id === 'copy-domestic'
      ? { ...model, stableModelName: 'qwen-v1', version: 'v1' }
      : model
  );
  const originalDeployments = deployments.map((deployment) =>
    deployment.id === 'qwen-direct'
      ? {
          ...deployment,
          credentialMode: 'platform' as const,
          credentialVersion: 'secret-v1',
          providerProfileId: 'provider-domestic-v1',
          executionChannelId: 'channel-domestic-v1',
          apiCounterparty: 'Domestic API Counterparty',
          credentialOwner: 'platform' as const,
          lifecycleRevision: 'deployment-lifecycle-v1',
          policyRevision: 'policy-v1',
          priceRevision: 'price-v1',
          unitPrice: {
            amountMicros: 11,
            currency: 'CNY' as const,
            unit: 'request',
          },
        }
      : deployment
  );
  const app = new ModelSupplyApplicationService({
    models: originalModels,
    deployments: originalDeployments,
    execution: {
      async execute(request) {
        executed = request;
        return recorded.execute(request);
      },
    },
  });
  const frozen = app.freezeFixedRoute({
    workspaceId: 'workspace-frozen-execution',
    operation: 'copy.generate',
    catalogModelId: 'copy-domestic',
    dataClass: [],
  });
  app.applyCatalogRevision(
    'workspace-frozen-execution',
    'catalog-v2',
    originalModels.map((model) =>
      model.id === 'copy-domestic'
        ? { ...model, stableModelName: 'qwen-v2', version: 'v2' }
        : model
    ),
    originalDeployments.map((deployment) =>
      deployment.id === 'qwen-direct'
        ? {
            ...deployment,
            channel: 'bifrost' as const,
            credentialVersion: 'secret-v2',
            policyRevision: 'policy-v2',
            priceRevision: 'price-v2',
            unitPrice: {
              amountMicros: 99,
              currency: 'CNY' as const,
              unit: 'request',
            },
          }
        : deployment
    )
  );

  const result = await app.submit({
    workspaceId: 'workspace-frozen-execution',
    actorId: 'owner-frozen-execution',
    idempotencyKey: 'frozen-execution-v1',
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: 'copy-domestic' },
    dataClass: [],
    prompt: '执行必须与冻结快照一致',
    frozenRouteSnapshot: frozen,
  });

  assert.equal(executed?.deployment.credentialVersion, 'secret-v1');
  assert.equal(
    executed?.deployment.providerProfileId,
    'provider-domestic-v1'
  );
  assert.equal(executed?.deployment.executionChannelId, 'channel-domestic-v1');
  assert.equal(
    executed?.deployment.apiCounterparty,
    'Domestic API Counterparty'
  );
  assert.equal(executed?.deployment.credentialOwner, 'platform');
  assert.equal(
    executed?.deployment.lifecycleRevision,
    'deployment-lifecycle-v1'
  );
  assert.equal(executed?.deployment.policyRevision, 'policy-v1');
  assert.equal(executed?.deployment.priceRevision, 'price-v1');
  assert.equal(executed?.deployment.channel, 'direct');
  assert.equal(executed?.deployment.unitPrice?.amountMicros, 11);
  assert.equal(executed?.model.stableModelName, 'qwen-v1');
  assert.equal(executed?.model.version, 'v1');
  assert.equal(result.snapshot.credentialVersion, 'secret-v1');
  assert.equal(result.snapshot.providerProfileId, 'provider-domestic-v1');
});

test('frozen routes survive worker restart after their catalog entries are deleted', async () => {
  const frozenModel: CatalogModel = {
    id: 'removed-copy-model',
    modality: 'llm',
    operations: ['copy.generate'],
    displayName: 'Removed Copy Model',
    qualityRank: 73,
    manufacturer: 'Archived Vendor',
    stableModelName: 'archived-copy',
    version: '2026-06-01',
    capabilities: ['copy.generate'],
  };
  const frozenDeployment: ModelDeployment = {
    id: 'removed-copy-deployment',
    catalogModelId: frozenModel.id,
    apiFamily: 'openai',
    channel: 'bifrost',
    region: 'domestic',
    status: 'active',
    allowedDataClasses: ['public', 'medical'],
    credentialMode: 'platform',
    credentialVersion: 'removed-secret-v1',
    policyRevision: 'removed-policy-v1',
    priceRevision: 'removed-price-v1',
    unitPrice: {
      amountMicros: 37,
      currency: 'CNY',
      unit: 'request',
    },
  };
  const snapshot = new ModelSupplyApplicationService({
    models: [frozenModel],
    deployments: [frozenDeployment],
    execution: new RecordedProviderExecutionPort(),
  }).freezeFixedRoute({
    workspaceId: 'workspace-deleted-route',
    operation: 'copy.generate',
    catalogModelId: frozenModel.id,
    dataClass: ['medical'],
  });

  let executed: ProviderExecutionRequest | undefined;
  const restartedWorker = new ModelSupplyApplicationService({
    models: [],
    deployments: [],
    execution: {
      async execute(request) {
        executed = request;
        return new RecordedProviderExecutionPort().execute(request);
      },
    },
  });
  const result = await restartedWorker.submit({
    workspaceId: 'workspace-deleted-route',
    actorId: 'owner-deleted-route',
    idempotencyKey: 'deleted-route-v1',
    operation: 'copy.generate',
    selection: { mode: 'fixed', catalogModelId: frozenModel.id },
    dataClass: ['medical'],
    prompt: '目录删除后仍按冻结路由执行',
    frozenRouteSnapshot: snapshot,
  });

  assert.equal(result.status, 'completed');
  assert.deepEqual(executed?.model, frozenModel);
  assert.deepEqual(executed?.deployment, {
    ...frozenDeployment,
    pricingTier: 'standard',
  });
});

test('Bifrost and LiteLLM isolated PoC ports satisfy the same LLM result contract without owning catalog state', async () => {
  for (const gateway of ['bifrost', 'litellm'] as const) {
    const app = new ModelSupplyApplicationService({
      models,
      deployments,
      execution: new RecordedGatewayPocPort(gateway),
    });
    const result = await app.submit({
      workspaceId: 'workspace-a',
      actorId: 'owner-a',
      idempotencyKey: `gateway-poc-${gateway}`,
      operation: 'copy.generate',
      selection: { mode: 'fixed', catalogModelId: 'copy-quality' },
      dataClass: [],
      prompt: '网关合同对照',
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.snapshot.actualCatalogModelId, 'copy-quality');
    assert.equal(result.copyCandidates?.length, 1);
  }
});

test('quality feedback is revision-attributed and north-star remains unknown without a sample', () => {
  const app = service();
  assert.deepEqual(app.qualityNorthStar(), {
    status: 'unknown',
    rate: undefined,
    sampleSize: 0,
    minimumSampleSize: 20,
  });
  app.recordQuality({
    outcome: 'adopted_with_small_edit',
    catalogModelId: 'copy-domestic',
    promptRevision: 'prompt-v3',
    exampleSetRevision: 'examples-v2',
    scenario: '到店转化',
    templateRevision: 'template-v1',
    editDistance: 0.08,
  });
  assert.deepEqual(app.qualityNorthStar(), {
    status: 'unknown',
    rate: undefined,
    sampleSize: 1,
    minimumSampleSize: 20,
  });
  for (let index = 1; index < 20; index += 1) {
    app.recordQuality({
      outcome: 'adopted_directly',
      catalogModelId: 'copy-domestic',
      promptRevision: 'prompt-v3',
      exampleSetRevision: 'examples-v2',
      scenario: '到店转化',
    });
  }
  assert.deepEqual(app.qualityNorthStar(), {
    status: 'known',
    rate: 1,
    sampleSize: 20,
    minimumSampleSize: 20,
  });
});

test('offline beauty evaluation is revisioned, catches invented prices and only warns without rewriting copy', () => {
  const result = evaluateBeautyOfflineCase({
    id: 'beauty-price-1',
    revision: 'beauty-eval-v1',
    platform: 'xiaohongshu',
    knownPrice: 199,
    candidates: [
      { title: '真实价格', body: '本周 ¥199 到店体验。', conversionHook: '预约' },
      { title: '错误价格', body: '今天只要 ¥99，保证有效。', conversionHook: '预约' },
    ],
  });
  assert.equal(result.revision, 'beauty-eval-v1');
  assert.equal(result.priceIntegrity, false);
  assert.equal(result.factAccuracy, false);
  assert.equal(result.brandVoiceMatch, true);
  assert.equal(result.platformFit, true);
  assert.equal(result.conversationalNaturalness, true);
  assert.equal(result.unsafeOrDeceptiveWarning, true);
  assert.deepEqual(result.warnings, [
    'price_not_grounded',
    'required_fact_missing',
    'unsafe_or_deceptive_language',
  ]);
});

test('durable composed workflow freezes a confirmed storyboard and reuses completed clips on resume', async () => {
  const app = service();
  const store = new InMemoryDurableVideoWorkflowStore();
  const runner = new ContentWorkflowRunner(app, undefined, store);
  const draft = runner.createVideoWorkflow({
    workspaceId: 'workspace-a',
    actorId: 'owner-a',
    dataClass: [],
    storyboardRevision: 'storyboard-v2',
    catalogModelId: 'seedance-2',
    shots: ['开场门店', '项目细节'],
  });
  await assert.rejects(runner.runVideoWorkflow(draft.id), /confirmed/);
  runner.confirmVideoWorkflow(draft.id);
  let pending = await runner.runVideoWorkflow(draft.id);
  assert.equal(pending.status, 'awaiting_quality_review');
  for (const shot of pending.shots) {
    runner.selectVideoCandidate({
      actorId: 'reviewer-a',
      candidateIndex: 0,
      correlationId: `review-${shot.id}`,
      shotId: shot.id,
      workflowId: draft.id,
      workspaceId: draft.workspaceId,
    });
    pending = await runner.runVideoWorkflow(draft.id);
  }
  const completed = pending;
  const resumed = await new ContentWorkflowRunner(app, undefined, store).runVideoWorkflow(draft.id);
  assert.equal(completed.status, 'completed');
  assert.equal(completed.composedAsset?.technicalValidation?.playable, true);
  assert.equal(completed.composedAsset?.qualityScore, undefined);
  assert.equal(resumed.attempts.length, completed.attempts.length);
});
