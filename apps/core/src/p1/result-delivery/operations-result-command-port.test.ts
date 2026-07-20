import assert from 'node:assert/strict';
import test from 'node:test';

import type { OperationsApplicationService } from '../operations/application-service.js';
import type { ProductBillingApplicationPort } from '../product-billing/durable-service.js';
import { OperationsResultCommandPort } from './operations-visual-adoption.js';

const context = {
  correlationId: 'corr-result-adjust',
  userId: 'owner-1',
  workspaceId: 'ws-1',
} as const;

function fixture(
  options: {
    quoteStatus?: 'confirmed' | 'quoted';
    quoteOutputCount?: number;
    scopedAssetIds?: string[];
  } = {},
) {
  const deriveCalls: unknown[] = [];
  const submitCalls: unknown[][] = [];
  const operations = {
    async executeIdempotentModuleCommand(
      _context: unknown,
      _key: string,
      _input: unknown,
      execute: () => Promise<unknown>,
    ) {
      return execute();
    },
    async getCreativeWorkbench() {
      return {
        works: [
          {
            id: 'work-1',
            currentJobId: 'job-1',
            intent: '夏日海报',
            sessionId: 'session-1',
            sourceReferences: [{ id: 'grounding-1', kind: 'asset' }],
            updatedAt: '2026-07-20T00:00:00.000Z',
          },
          {
            id: 'derived-work-1',
            currentJobId: undefined,
            intent: '夏日海报\n\n调整要求：换成夏日风格',
            sessionId: 'session-1',
            sourceReferences: [
              { id: 'work-1', kind: 'work' },
              { id: 'grounding-1', kind: 'asset' },
              ...(options.scopedAssetIds ?? []).map((id) => ({
                id,
                kind: 'asset' as const,
              })),
            ],
            updatedAt: '2026-07-20T00:01:00.000Z',
          },
        ],
        jobs: [
          {
            id: 'job-1',
            workId: 'work-1',
            status: 'completed',
            contract: {
              aigcLabelEnabled: true,
              aspectRatio: '3:4',
              catalogModelId: 'image-model-old',
              catalogRevision: 'catalog-old',
              currency: 'CNY',
              dataClass: [],
              estimatedAmount: 1,
              operation: 'image.generate',
              outputCount: 1,
              outputLabel: '1 张 3:4 图片',
              quoteAcceptedAt: '2026-07-19T00:00:00.000Z',
              quoteRevision: 'quote-old',
              watermarkEnabled: false,
            },
          },
        ],
        assets: [
          { id: 'asset-1', jobId: 'job-1', workId: 'work-1' },
          { id: 'asset-2', jobId: 'job-1', workId: 'work-1' },
          { id: 'grounding-1', jobId: 'input-job', workId: 'input-work' },
          { id: 'foreign-asset', jobId: 'job-2', workId: 'work-2' },
        ],
      };
    },
    async deriveCreativeWork(_context: unknown, _workId: string, input: unknown) {
      deriveCalls.push(input);
      return { id: 'derived-work-1' };
    },
    async submitCreativeWork(...args: unknown[]) {
      submitCalls.push(args);
      return { work: { id: 'derived-work-1' } };
    },
  } as unknown as OperationsApplicationService;
  const confirmCalls: unknown[] = [];
  let quoteStatus = options.quoteStatus ?? 'confirmed';
  const quoteOutputCount =
    options.quoteOutputCount ?? options.scopedAssetIds?.length ?? 1;
  const currentQuote = () => ({
    billingMode: 'per_request' as const,
    catalogModelId: 'image-model-old',
    catalogModelRevision: 'catalog-fresh',
    confirmedAmount: quoteOutputCount * 2,
    ...(quoteStatus === 'confirmed'
      ? {
          confirmedAt: '2026-07-20T00:02:00.000Z',
          taskId: 'derived-work-1',
        }
      : {}),
    formula: { currency: 'CNY', expression: 'fresh', unitRate: 2 },
    lifecycleStatus: quoteStatus,
    outputCount: quoteOutputCount,
    outputLabel: `${quoteOutputCount} 张 3:4 图片`,
    quoteId: 'quote-fresh',
    quotePolicyRevision: 'policy-fresh',
    revision: 'quote-revision-fresh',
    workspaceId: 'ws-1',
  });
  const quotes = {
    async getQuote() {
      return currentQuote();
    },
    async confirm(input: unknown) {
      confirmCalls.push(input);
      quoteStatus = 'confirmed';
      return currentQuote();
    },
  } as unknown as ProductBillingApplicationPort;
  return {
    confirmCalls,
    deriveCalls,
    port: new OperationsResultCommandPort(operations, quotes),
    submitCalls,
  };
}

test('image adjustment freezes an owned explicit scope into derived intent', async () => {
  const { deriveCalls, port, submitCalls } = fixture();
  const prepared = await port.prepareAdjust(
    context,
    {
      baseJobId: 'job-1',
      expectedWorkUpdatedAt: '2026-07-20T00:00:00.000Z',
      instruction: '换成夏日风格',
      scope: { assetId: 'asset-1', kind: 'asset' },
      workId: 'work-1',
    },
    'adjust-1',
  );
  assert.match(JSON.stringify(deriveCalls), /调整范围：单张 asset-1/);
  assert.deepEqual(prepared.quoteIntent, {
    aspectRatio: '3:4',
    catalogModelId: 'image-model-old',
    operation: 'image.generate',
    quantity: 1,
  });
  assert.deepEqual(submitCalls, []);
});

test('image adjustment rejects an asset outside the frozen source Job', async () => {
  const { deriveCalls, port } = fixture();
  await assert.rejects(
    port.prepareAdjust(
      context,
      {
        baseJobId: 'job-1',
        expectedWorkUpdatedAt: '2026-07-20T00:00:00.000Z',
        instruction: '换成夏日风格',
        scope: { assetId: 'foreign-asset', kind: 'asset' },
        workId: 'work-1',
      },
      'adjust-2',
    ),
    /adjustment scope does not belong to the source Job/,
  );
  assert.deepEqual(deriveCalls, []);
});

test('confirmed adjustment submits with only the server quote facts', async () => {
  const { port, submitCalls } = fixture();
  await port.adjust(
    context,
    {
      baseJobId: 'job-1',
      billingQuoteId: 'quote-fresh',
      derivedWorkId: 'derived-work-1',
    },
    'adjust-confirm-1',
  );

  assert.equal(submitCalls.length, 1);
  const contract = submitCalls[0]?.[2] as Record<string, unknown>;
  assert.deepEqual(
    {
      catalogModelId: contract.catalogModelId,
      catalogRevision: contract.catalogRevision,
      currency: contract.currency,
      estimatedAmount: contract.estimatedAmount,
      quoteAcceptedAt: contract.quoteAcceptedAt,
      quoteRevision: contract.quoteRevision,
    },
    {
      catalogModelId: 'image-model-old',
      catalogRevision: 'catalog-fresh',
      currency: 'CNY',
      estimatedAmount: 2,
      quoteAcceptedAt: '2026-07-20T00:02:00.000Z',
      quoteRevision: 'quote-revision-fresh',
    },
  );
  assert.equal(submitCalls[0]?.[8], 'quote-fresh');
});

test('adjust confirmation binds a fresh quote to the server-derived Work', async () => {
  const { confirmCalls, port } = fixture({ quoteStatus: 'quoted' });
  await port.adjust(
    context,
    {
      baseJobId: 'job-1',
      billingQuoteId: 'quote-fresh',
      derivedWorkId: 'derived-work-1',
    },
    'adjust-confirm-quoted',
  );
  assert.deepEqual(confirmCalls, [
    {
      quoteId: 'quote-fresh',
      taskId: 'derived-work-1',
      workspaceId: 'ws-1',
    },
  ]);
});

test('set adjustment freezes the explicit set size into the submitted contract', async () => {
  const { port, submitCalls } = fixture({
    scopedAssetIds: ['asset-1', 'asset-2'],
  });
  await port.adjust(
    context,
    {
      baseJobId: 'job-1',
      billingQuoteId: 'quote-fresh',
      derivedWorkId: 'derived-work-1',
    },
    'adjust-confirm-set',
  );
  const contract = submitCalls[0]?.[2] as Record<string, unknown>;
  assert.equal(contract.outputCount, 2);
  assert.equal(contract.outputLabel, '2 张 3:4 图片');
  assert.equal(contract.estimatedAmount, 4);
});

test('set adjustment rejects a quote for a different output quantity', async () => {
  const { port, submitCalls } = fixture({
    quoteOutputCount: 1,
    scopedAssetIds: ['asset-1', 'asset-2'],
  });
  await assert.rejects(
    port.adjust(
      context,
      {
        baseJobId: 'job-1',
        billingQuoteId: 'quote-fresh',
        derivedWorkId: 'derived-work-1',
      },
      'adjust-confirm-wrong-quantity',
    ),
    /fresh Product quote does not match this prepared adjustment/,
  );
  assert.deepEqual(submitCalls, []);
});
