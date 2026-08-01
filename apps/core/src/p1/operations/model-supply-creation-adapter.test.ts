import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelSupplyControlPlaneService } from '../model-supply/foundation-module.js';
import {
  ModelSupplyCreationExecutor,
  type CreativeBrief,
  type CreativeExecutionContract,
  type CreativeGroundingSnapshot,
} from './index.js';

const contract: CreativeExecutionContract = {
  aigcLabelEnabled: true,
  catalogModelId: 'llm-live',
  catalogRevision: 'catalog-live-v1',
  currency: 'CNY',
  dataClass: [],
  estimatedAmount: 3,
  operation: 'copy.generate',
  outputCount: 3,
  outputLabel: '3 条内容候选',
  quoteAcceptedAt: '2026-07-12T08:00:00.000Z',
  quoteRevision:
    'catalog-live-v1:price-live-v1:llm-live:copy.generate:text',
  watermarkEnabled: false,
};

const videoContract: CreativeExecutionContract = {
  ...contract,
  aspectRatio: '9:16',
  catalogModelId: 'seedance-1-5-pro',
  durationSeconds: 15,
  operation: 'video.generate',
  outputCount: 1,
  outputLabel: '1 段竖屏视频',
};

function acceptedInspectionAuthority(
  executionContract: CreativeExecutionContract,
  quoteId = 'fresh-adjust-quote-1',
) {
  return {
    catalogModelId: executionContract.catalogModelId,
    catalogModelRevision: executionContract.catalogRevision,
    confirmedAmount: executionContract.estimatedAmount,
    currency: executionContract.currency,
    kind: 'accepted_product_quote' as const,
    outputCount: executionContract.outputCount,
    outputLabel: executionContract.outputLabel,
    quoteId,
    quoteRevision: executionContract.quoteRevision,
  };
}

function executor() {
  return new ModelSupplyCreationExecutor({
    async getCatalog() {
      return {
        models: [
          {
            activationEvidence: { status: 'live_verified' as const },
            availability: 'available' as const,
            capabilities: ['copy.generate' as const],
            dataClasses: {
              allowed: ['public' as const],
              denied: [],
            },
            displayName: 'Live copy',
            id: 'llm-live',
            manufacturer: 'Recorded',
            modality: 'llm' as const,
            operations: ['copy.generate' as const],
            qualityRank: 1,
            stableModelName: 'llm-live',
            unitPrice: {
              amountMicros: 1_000_000,
              currency: 'CNY' as const,
              revision: 'price-live-v1',
              unit: 'candidate',
            },
            version: '1',
          },
        ],
        operation: 'copy.generate' as const,
        revisionId: 'catalog-live-v1',
        stage: 'published' as const,
      };
    },
  } as unknown as ModelSupplyControlPlaneService);
}

test('accepts only the server-derived current creative quote', async () => {
  const creation = executor();
  await creation.inspect('workspace-a', contract);
  for (const altered of [
    { ...contract, estimatedAmount: 0 },
    { ...contract, currency: 'USD' },
    { ...contract, outputCount: 1 },
    { ...contract, quoteRevision: 'forged' },
  ]) {
    await assert.rejects(
      creation.inspect('workspace-a', altered),
      /execution quote changed/i
    );
  }
});

test('accepts an opaque ProductQuote revision only after Operations validated its quote binding', async () => {
  const creation = executor();
  const acceptedProductQuoteContract = {
    ...contract,
    quoteRevision: 'product-quote-sha256-opaque-revision',
  };

  await assert.rejects(
    creation.inspect('workspace-a', acceptedProductQuoteContract),
    /execution quote changed/i,
  );
  await creation.inspect('workspace-a', acceptedProductQuoteContract, {
    ...acceptedInspectionAuthority(acceptedProductQuoteContract),
  });

  await assert.rejects(
    creation.inspect(
      'workspace-a',
      { ...acceptedProductQuoteContract, estimatedAmount: 0 },
      acceptedInspectionAuthority(acceptedProductQuoteContract),
    ),
    /accepted Product quote no longer matches/i,
  );
  await assert.rejects(
    creation.inspect(
      'workspace-a',
      { ...acceptedProductQuoteContract, catalogRevision: 'stale-catalog' },
      acceptedInspectionAuthority(acceptedProductQuoteContract),
    ),
    /model catalog changed/i,
  );
});

test('accepts server-bound single and set image quotes without legacy output-count reconstruction', async () => {
  const creation = new ModelSupplyCreationExecutor({
    async getCatalog() {
      return {
        models: [
          {
            activationEvidence: { status: 'live_verified' as const },
            availability: 'available' as const,
            capabilities: ['image.generate' as const],
            dataClasses: { allowed: ['public' as const], denied: [] },
            displayName: 'Live image',
            id: 'image-live',
            manufacturer: 'Recorded',
            modality: 'image' as const,
            operations: ['image.generate' as const],
            qualityRank: 1,
            stableModelName: 'image-live',
            unitPrice: {
              amountMicros: 1_000_000,
              currency: 'CNY' as const,
              revision: 'price-image-v1',
              unit: 'request',
            },
            version: '1',
          },
        ],
        operation: 'image.generate' as const,
        revisionId: 'catalog-image-v1',
        stage: 'published' as const,
      };
    },
  } as unknown as ModelSupplyControlPlaneService);
  const single: CreativeExecutionContract = {
    ...contract,
    aspectRatio: '3:4',
    catalogModelId: 'image-live',
    catalogRevision: 'catalog-image-v1',
    estimatedAmount: 1,
    operation: 'image.generate',
    outputCount: 1,
    outputLabel: '1 张 3:4 图片',
    quoteRevision: 'opaque-image-single',
  };
  const set: CreativeExecutionContract = {
    ...single,
    estimatedAmount: 3,
    outputCount: 3,
    outputLabel: '3 张 3:4 图片',
    quoteRevision: 'opaque-image-set',
  };

  await creation.inspect(
    'workspace-a',
    single,
    acceptedInspectionAuthority(single, 'quote-image-single'),
  );
  await creation.inspect(
    'workspace-a',
    set,
    acceptedInspectionAuthority(set, 'quote-image-set'),
  );

  for (const altered of [
    { ...set, estimatedAmount: 1 },
    { ...set, outputCount: 1 },
    { ...set, outputLabel: '1 张 3:4 图片' },
  ]) {
    await assert.rejects(
      creation.inspect(
        'workspace-a',
        altered,
        acceptedInspectionAuthority(set, 'quote-image-set'),
      ),
      /accepted Product quote no longer matches/i,
    );
  }
});

test('forwards the canonical Operations billing task into Model Supply', async () => {
  let captured:
    | { billingTaskId?: string; billingQuoteRevision?: string }
    | undefined;
  let bound:
    | {
        inputSnapshot: {
          input: Record<string, unknown> | null;
          prompt: string;
        };
        quoteRevision: string;
        taskId: string;
        workspaceId: string;
      }
    | undefined;
  const expectedError = new Error('stop after billing capture');
  const creation = new ModelSupplyCreationExecutor({
    async submitGeneration(_context: unknown, request: typeof captured) {
      captured = structuredClone(request);
      throw expectedError;
    },
  } as unknown as ModelSupplyControlPlaneService, undefined, {
    async bindMerchantExecutionInput(input) {
      bound = structuredClone(input);
    },
  });

  await assert.rejects(
    creation.submit({
      billingQuoteRevision: contract.quoteRevision,
      billingTaskId: 'creative-work-billing-1',
      context: {
        actor: 'owner',
        correlationId: 'corr-billing-task',
        userId: 'owner-a',
        workspaceId: 'workspace-a',
      },
      contract,
      idempotencyKey: 'billing-task-submit',
      intent: '写三条内容',
      productUsageQuantity: 1,
    }),
    expectedError,
  );

  assert.deepEqual(captured, {
    billingQuoteRevision: contract.quoteRevision,
    billingTaskId: 'creative-work-billing-1',
    dataClass: [],
    exampleSetRevision: 'none',
    input: {},
    operation: 'copy.generate',
    productUsageQuantity: 1,
    prompt: '写三条内容\n\n本次成套内容结构（按顺序全部覆盖）：社交媒体封面。',
    promptRevision: 'creative-brief-grounding-v3',
    selection: { catalogModelId: 'llm-live', mode: 'fixed' },
  });
  assert.deepEqual(bound, {
    inputSnapshot: {
      input: {},
      prompt: '写三条内容\n\n本次成套内容结构（按顺序全部覆盖）：社交媒体封面。',
    },
    quoteRevision: contract.quoteRevision,
    taskId: 'creative-work-billing-1',
    workspaceId: 'workspace-a',
  });
});

test('routes native video submission through controlPlane.submitGeneration', async () => {
  const expectedError = new Error('stop after native video request capture');
  let capturedOperation: string | undefined;
  const creation = new ModelSupplyCreationExecutor({
    async submitGeneration(
      _context: unknown,
      request: { operation: string },
    ) {
      capturedOperation = request.operation;
      throw expectedError;
    },
  } as unknown as ModelSupplyControlPlaneService);

  await assert.rejects(
    creation.submit({
      context: {
        actor: 'owner',
        correlationId: 'corr-native-video',
        userId: 'owner-a',
        workspaceId: 'workspace-a',
      },
      contract: videoContract,
      idempotencyKey: 'native-video-submit',
      intent: '生成一条原生门店视频',
      productUsageQuantity: 1,
      workId: 'creative-work-video-native',
    }),
    expectedError,
  );

  assert.equal(capturedOperation, 'video.generate');
});

test('accepts an explicit local-fixture execution flag without live evidence', async () => {
  const creation = new ModelSupplyCreationExecutor({
    async getCatalog() {
      return {
        models: [
          {
            activationEvidence: { status: 'recorded' as const },
            available: true,
            availability: 'recorded' as const,
            capabilities: ['copy.generate' as const],
            dataClasses: {
              allowed: ['public' as const],
              denied: [],
            },
            displayName: 'Fixture copy',
            id: 'llm-live',
            manufacturer: 'Recorded',
            modality: 'llm' as const,
            operations: ['copy.generate' as const],
            qualityRank: 1,
            stableModelName: 'llm-live',
            unitPrice: {
              amountMicros: 1_000_000,
              currency: 'CNY' as const,
              revision: 'price-live-v1',
              unit: 'candidate',
            },
            version: '1',
          },
        ],
        operation: 'copy.generate' as const,
        revisionId: 'catalog-live-v1',
        stage: 'recorded' as const,
      };
    },
  } as unknown as ModelSupplyControlPlaneService);

  await creation.inspect('workspace-a', contract);
});

test('passes the selected content suite to the formal generation prompt', async () => {
  let prompt = '';
  const expectedError = new Error('stop after request capture');
  const creation = new ModelSupplyCreationExecutor({
    async submitGeneration(
      _context: unknown,
      request: { prompt: string }
    ) {
      prompt = request.prompt;
      throw expectedError;
    },
  } as unknown as ModelSupplyControlPlaneService);

  await assert.rejects(
    creation.submit({
      context: {
        actor: 'owner',
        correlationId: 'corr-content-suite',
        userId: 'owner-a',
        workspaceId: 'workspace-a',
      },
      contract: {
        ...contract,
        contentModules: ['store_intro', 'review_card'],
      },
      idempotencyKey: 'content-suite-request',
      intent: '写一组门店内容',
      productUsageQuantity: 1,
    }),
    expectedError
  );
  assert.match(prompt, /门店介绍/);
  assert.match(prompt, /好评卡/);
  assert.ok(prompt.indexOf('门店介绍') < prompt.indexOf('好评卡'));
});

test('passes only resolved inheritance facts to the formal generation prompt', async () => {
  let prompt = '';
  const expectedError = new Error('stop after request capture');
  const creation = new ModelSupplyCreationExecutor({
    async submitGeneration(_context: unknown, request: { prompt: string }) {
      prompt = request.prompt;
      throw expectedError;
    },
  } as unknown as ModelSupplyControlPlaneService);

  await assert.rejects(
    creation.submit({
      context: {
        actor: 'owner',
        correlationId: 'corr-inheritance-context',
        userId: 'owner-a',
        workspaceId: 'workspace-a',
      },
      contract,
      idempotencyKey: 'inheritance-context-request',
      inheritanceContext: {
        sources: [
          {
            facts: [
              {
                field: 'layout_slots',
                mediaSlotCount: 1,
                pageCount: 2,
                textSlotCount: 3,
              },
            ],
            internalMetadata: 'private-route-snapshot',
            kind: 'template',
            rawCopy: 'Private Store 18888888888 price 99',
            rawMediaUrl: 'https://private.example/source.png',
          },
        ],
      },
      intent: '沿用已选结构生成新内容',
      productUsageQuantity: 1,
    } as unknown as Parameters<typeof creation.submit>[0]),
    expectedError
  );

  assert.match(prompt, /2 页/);
  assert.match(prompt, /3 个文字槽/);
  assert.match(prompt, /1 个媒体槽/);
  assert.doesNotMatch(prompt, /private-route-snapshot/);
  assert.doesNotMatch(prompt, /private\.example/);
  assert.doesNotMatch(prompt, /Private Store|18888888888|price 99/);
});

test('passes frozen Brief and confirmed Product grounding to copy, image and video execution contracts', async () => {
  const briefSnapshot: CreativeBrief = {
    confirmedAt: '2026-07-14T08:00:00.000Z',
    fields: {
      audience: {
        aiDraft: '第一次到店的新客',
        current: '第一次到店的新客',
        owner: 'ai',
      },
      intent: {
        aiDraft: '介绍真实门店项目',
        current: '介绍真实门店项目',
        owner: 'ai',
      },
      tone: { current: '真诚、不夸张', owner: 'merchant' },
    },
    updatedAt: '2026-07-14T08:00:00.000Z',
  };
  const groundingSnapshot: CreativeGroundingSnapshot = {
    assets: [
      {
        authorizationStatus: 'authorized',
        category: 'store',
        consentScope: 'public_marketing',
        containsPerson: false,
        containsSensitiveData: false,
        id: 'asset-real-a',
        minorStatus: 'none',
        rightsEvidenceRecorded: true,
        sourceType: 'real',
        tags: ['门头'],
      },
    ],
    capturedAt: '2026-07-14T08:00:00.000Z',
    store: {
      address: '88 号',
      booking: '提前预约',
      brandVoice: '真诚、不夸张',
      city: '成都',
      confirmedAt: '2026-07-14T07:00:00.000Z',
      district: '锦江区',
      name: '春日美甲',
      prohibitions: ['不虚构折扣'],
      projects: [
        {
          durationMinutes: 90,
          id: 'project-a',
          name: '纯色美甲',
          price: 168,
        },
      ],
      regulated: false,
    },
  };
  const requests: Array<{
    input?: { referenceAssetIds?: string[] };
    operation: string;
    prompt: string;
  }> = [];
  const expectedError = new Error('stop after request capture');
  const creation = new ModelSupplyCreationExecutor(
    {
      async submitGeneration(_context: unknown, request: typeof requests[number]) {
        requests.push(structuredClone(request));
        throw expectedError;
      },
    } as unknown as ModelSupplyControlPlaneService,
    {
      async inspect(_workspaceId, assetIds) {
        return assetIds.map((assetId) => ({
          assetId,
          contentType: 'image/png',
          kind: 'resolved' as const,
        }));
      },
      async resolve() {
        throw new Error('execution resolution is not part of submission');
      },
    }
  );

  for (const operation of [
    'copy.generate',
    'image.generate',
    'video.generate',
  ] as const) {
    await assert.rejects(
      creation.submit({
        briefSnapshot,
        context: {
          actor: 'owner',
          correlationId: `corr-${operation}`,
          userId: 'owner-a',
          workspaceId: 'workspace-a',
        },
        contract:
          operation === 'video.generate'
            ? {
                ...contract,
                aspectRatio: '9:16',
                durationSeconds: 15,
                operation,
              }
            : { ...contract, operation },
        groundingSnapshot,
        idempotencyKey: `grounding-${operation}`,
        intent: '这个原始意图不得覆盖已确认 Brief',
        productUsageQuantity: 1,
        ...(operation === 'video.generate'
          ? { workId: 'creative-work-video-grounding' }
          : {}),
      }),
      expectedError
    );
  }

  assert.deepEqual(
    requests.map((request) => request.operation),
    ['copy.generate', 'image.generate', 'video.generate']
  );
  for (const request of requests) {
    assert.deepEqual(request.input?.referenceAssetIds, ['asset-real-a']);
    assert.match(request.prompt, /第一次到店的新客/);
    assert.match(request.prompt, /春日美甲/);
    assert.match(request.prompt, /纯色美甲/);
    assert.match(request.prompt, /168/);
    assert.match(request.prompt, /asset-real-a/);
    assert.match(request.prompt, /不得编造价格、折扣或授权/);
  }

});

test('preserves every copy candidate conversion hook from Model Supply', async () => {
  const creation = new ModelSupplyCreationExecutor({
    async submitGeneration() {
      return {
        attempt: { acceptance: 'accepted' },
        copyCandidates: [
          { title: 'A', body: 'Alpha', conversionHook: '立即留言' },
          { title: 'B', body: 'Beta', conversionHook: '先收藏' },
          { title: 'C', body: 'Gamma', conversionHook: '再预约' },
        ],
        jobId: 'model-job-copy-hooks',
        providerCost: {
          amount: 0.003,
          currency: 'USD',
          status: 'observed',
        },
        routeSnapshotId: 'route-copy-hooks',
        snapshot: {
          actualCatalogModelId: 'llm-live',
          allowedCandidates: [
            {
              activationStatus: 'recorded',
              catalogModelId: 'llm-live',
              modelDisplayName: 'Recorded copy',
              stableModelName: 'recorded-copy-v1',
            },
          ],
          apiCounterparty: 'recorded-fixture',
          id: 'route-copy-hooks',
        },
        status: 'completed',
        usage: { quantity: 1, status: 'committed' },
      };
    },
  } as unknown as ModelSupplyControlPlaneService);

  const result = await creation.submit({
    context: {
      actor: 'owner',
      correlationId: 'corr-copy-hooks',
      userId: 'owner-a',
      workspaceId: 'workspace-a',
    },
    contract,
    idempotencyKey: 'copy-hooks',
    intent: '保留转化钩子',
    productUsageQuantity: 1,
  });

  assert.deepEqual(
    result.copyCandidates?.map((candidate) => candidate.conversionHook),
    ['立即留言', '先收藏', '再预约'],
  );
  assert.deepEqual(result.productUsage, {
    quantity: 1,
    status: 'committed',
  });
  assert.deepEqual(result.providerCost, {
    amount: 0.003,
    currency: 'USD',
    status: 'observed',
  });
  assert.deepEqual(result.executionProvenance, {
    activationStatus: 'recorded',
    actualCatalogModelId: 'llm-live',
    apiCounterparty: 'recorded-fixture',
    modelDisplayName: 'Recorded copy',
    providerModel: 'recorded-copy-v1',
  });
});

test('rejects unresolved media references before creating a generation job', async () => {
  let submitCalls = 0;
  const creation = new ModelSupplyCreationExecutor(
    {
      async submitGeneration() {
        submitCalls += 1;
        throw new Error('must not submit');
      },
    } as unknown as ModelSupplyControlPlaneService,
    {
      async inspect() {
        return [
          {
            assetId: 'asset-missing',
            kind: 'failure' as const,
            reason: 'not_found' as const,
          },
          {
            assetId: 'asset-withdrawn',
            kind: 'failure' as const,
            reason: 'authorization_withdrawn' as const,
          },
        ];
      },
      async resolve() {
        throw new Error('execution resolution is not part of submission');
      },
    }
  );

  await assert.rejects(
    creation.submit({
      context: {
        actor: 'owner',
        correlationId: 'corr-reference-fail-fast',
        userId: 'owner-a',
        workspaceId: 'workspace-a',
      },
      contract: {
        ...contract,
        aspectRatio: '1:1',
        operation: 'image.generate',
        outputCount: 1,
        outputLabel: '1 张 1:1 图片',
      },
      groundingSnapshot: {
        assets: [
          {
            authorizationStatus: 'authorized',
            containsPerson: false,
            containsSensitiveData: false,
            consentScope: 'public_marketing',
            id: 'asset-missing',
            minorStatus: 'none',
            rightsEvidenceRecorded: true,
            sourceType: 'real',
            tags: ['门店'],
          },
          {
            authorizationStatus: 'authorized',
            containsPerson: false,
            containsSensitiveData: false,
            consentScope: 'public_marketing',
            id: 'asset-withdrawn',
            minorStatus: 'none',
            rightsEvidenceRecorded: true,
            sourceType: 'real',
            tags: ['护理室'],
          },
        ],
        capturedAt: '2026-07-15T02:00:00.000Z',
        store: {
          address: '88 号',
          booking: '提前预约',
          brandVoice: '真诚',
          city: '成都',
          confirmedAt: '2026-07-15T01:00:00.000Z',
          district: '锦江区',
          name: '春日美甲',
          prohibitions: [],
          projects: [],
          regulated: false,
        },
      },
      idempotencyKey: 'reference-fail-fast',
      intent: '基于门店照片生成封面',
      productUsageQuantity: 1,
    }),
    (error: unknown) => {
      if (
        !(error instanceof Error) ||
        !('code' in error) ||
        error.code !== 'REFERENCE_ASSET_UNRESOLVED' ||
        !('status' in error) ||
        error.status !== 409 ||
        !('details' in error)
      ) {
        return false;
      }
      assert.deepEqual(error.details, {
        referenceFailures: [
          { assetId: 'asset-missing', reasonCode: 'not_found' },
          {
            assetId: 'asset-withdrawn',
            reasonCode: 'authorization_withdrawn',
          },
        ],
      });
      return true;
    }
  );
  assert.equal(submitCalls, 0);
});

test('forwards zero product usage and records rerolls without changing the fixed model', async () => {
  let productUsageQuantity: 0 | 1 | undefined;
  let promptRevision: string | undefined;
  let exampleSetRevision: string | undefined;
  const qualityEvents: Array<Record<string, unknown>> = [];
  const expectedError = new Error('stop after request capture');
  const creation = new ModelSupplyCreationExecutor({
    async submitGeneration(
      _context: unknown,
      request: {
        productUsageQuantity?: 0 | 1;
        promptRevision?: string;
        exampleSetRevision?: string;
      },
    ) {
      productUsageQuantity = request.productUsageQuantity;
      promptRevision = request.promptRevision;
      exampleSetRevision = request.exampleSetRevision;
      throw expectedError;
    },
    async recordQuality(_workspaceId: string, event: Record<string, unknown>) {
      qualityEvents.push(structuredClone(event));
      return event;
    },
  } as unknown as ModelSupplyControlPlaneService);

  await assert.rejects(
    creation.submit({
      context: {
        actor: 'owner',
        correlationId: 'corr-quality-retry',
        userId: 'owner-a',
        workspaceId: 'workspace-a',
      },
      contract,
      idempotencyKey: 'quality-retry-request',
      intent: '原创作意图',
      productUsageQuantity: 0,
    }),
    expectedError,
  );
  assert.equal(productUsageQuantity, 0);
  assert.equal(promptRevision, 'creative-brief-grounding-v3');
  assert.equal(exampleSetRevision, 'none');

  const rerollEvent = {
    context: {
      actor: 'owner',
      correlationId: 'corr-quality-reroll',
      userId: 'owner-a',
      workspaceId: 'workspace-a',
    },
    contract,
    rerollKind: 'quality',
    targetJobId: 'creative-job-quality-1',
  } as const;
  await creation.recordReroll?.(rerollEvent);
  await creation.recordReroll?.(rerollEvent);
  assert.equal(qualityEvents.length, 2);
  assert.equal(qualityEvents[0]?.id, qualityEvents[1]?.id);
  assert.deepEqual(
    {
      catalogModelId: qualityEvents[0]?.catalogModelId,
      exampleSetRevision: qualityEvents[0]?.exampleSetRevision,
      outcome: qualityEvents[0]?.outcome,
      promptRevision: qualityEvents[0]?.promptRevision,
      scenario: qualityEvents[0]?.scenario,
    },
    {
      catalogModelId: contract.catalogModelId,
      exampleSetRevision: 'none',
      outcome: 'rerolled',
      promptRevision: 'creative-brief-grounding-v3',
      scenario: 'creative_copy_quality_reroll',
    },
  );
});

/**
 * T37-R2 / M-04 provenance 同源对齐.
 *
 * Migrated from `uiux-upgrade-b-results.spec.ts:439-458`, which asserts the
 * same contract but sits in the retired-workbench family — a spec no required
 * job runs, so those two lines never executed. This is the seam they were
 * really about: `executionResult` builds `executionProvenance` out of the
 * frozen RouteSnapshot, so the two must name the same provider model and the
 * same API counterparty, and neither may be blank. The T07 F2 ruling is the
 * point: `expect.any(String)` accepted the empty string, which asserts a
 * field's type rather than that it came from anywhere.
 */
test('execution provenance restates the frozen route, never a blank counterparty', async () => {
  const snapshot = {
    actualCatalogModelId: 'llm-live',
    allowedCandidates: [
      {
        activationStatus: 'live_verified' as const,
        catalogModelId: 'llm-live',
        modelDisplayName: 'Live copy',
        providerModel: 'live-copy-v2',
        stableModelName: 'live-copy-stable',
      },
    ],
    apiCounterparty: 'recorded-counterparty',
    id: 'route-provenance-alignment',
  };
  const creation = new ModelSupplyCreationExecutor({
    async submitGeneration() {
      return {
        attempt: { acceptance: 'accepted' },
        copyCandidates: [{ body: 'Alpha', title: 'A' }],
        jobId: 'model-job-provenance',
        providerCost: { amount: 0.001, currency: 'USD', status: 'observed' },
        routeSnapshotId: snapshot.id,
        snapshot,
        status: 'completed',
        usage: { quantity: 1, status: 'committed' },
      };
    },
  } as unknown as ModelSupplyControlPlaneService);

  const result = await creation.submit({
    context: {
      actor: 'owner',
      correlationId: 'corr-provenance',
      userId: 'owner-a',
      workspaceId: 'workspace-a',
    },
    contract,
    idempotencyKey: 'provenance-alignment',
    intent: '对齐冻结路由与执行留痕',
    productUsageQuantity: 1,
  });

  const provenance = result.executionProvenance;
  assert.ok(
    typeof provenance?.providerModel === 'string' &&
      provenance.providerModel.trim().length > 0,
    `frozen route must name a provider model; got ${JSON.stringify(provenance?.providerModel)}`,
  );
  assert.ok(
    typeof provenance?.apiCounterparty === 'string' &&
      provenance.apiCounterparty.trim().length > 0,
    `frozen route must name an API counterparty; got ${JSON.stringify(provenance?.apiCounterparty)}`,
  );
  // 同源: both restate the RouteSnapshot this run was frozen against.
  assert.equal(
    provenance?.providerModel,
    snapshot.allowedCandidates[0]?.providerModel,
  );
  assert.equal(provenance?.apiCounterparty, snapshot.apiCounterparty);
  assert.equal(provenance?.actualCatalogModelId, snapshot.actualCatalogModelId);
  assert.equal(result.routeSnapshotId, snapshot.id);
});

test('provenance falls back to the stable model name, and still names one', async () => {
  // Same resolution order the migrated case walked:
  // snapshot.providerModel ?? candidate.providerModel ?? candidate.stableModelName.
  const snapshot = {
    actualCatalogModelId: 'llm-live',
    allowedCandidates: [
      {
        activationStatus: 'recorded' as const,
        catalogModelId: 'llm-live',
        modelDisplayName: 'Recorded copy',
        stableModelName: 'recorded-copy-v1',
      },
    ],
    apiCounterparty: 'recorded-fixture',
    id: 'route-provenance-fallback',
  };
  const creation = new ModelSupplyCreationExecutor({
    async submitGeneration() {
      return {
        attempt: { acceptance: 'accepted' },
        copyCandidates: [{ body: 'Alpha', title: 'A' }],
        jobId: 'model-job-provenance-fallback',
        providerCost: { amount: 0.001, currency: 'USD', status: 'observed' },
        routeSnapshotId: snapshot.id,
        snapshot,
        status: 'completed',
        usage: { quantity: 1, status: 'committed' },
      };
    },
  } as unknown as ModelSupplyControlPlaneService);

  const result = await creation.submit({
    context: {
      actor: 'owner',
      correlationId: 'corr-provenance-fallback',
      userId: 'owner-a',
      workspaceId: 'workspace-a',
    },
    contract,
    idempotencyKey: 'provenance-fallback',
    intent: '回退到稳定模型名仍要有名字',
    productUsageQuantity: 1,
  });

  const provenance = result.executionProvenance;
  assert.ok(
    typeof provenance?.providerModel === 'string' &&
      provenance.providerModel.trim().length > 0,
    `frozen route must name a provider model; got ${JSON.stringify(provenance?.providerModel)}`,
  );
  assert.equal(
    provenance?.providerModel,
    snapshot.allowedCandidates[0]?.stableModelName,
  );
  assert.ok(
    typeof provenance?.apiCounterparty === 'string' &&
      provenance.apiCounterparty.trim().length > 0,
    `frozen route must name an API counterparty; got ${JSON.stringify(provenance?.apiCounterparty)}`,
  );
  assert.equal(provenance?.apiCounterparty, snapshot.apiCounterparty);
});
