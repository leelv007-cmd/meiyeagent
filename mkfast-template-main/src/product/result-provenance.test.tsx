import assert from 'node:assert/strict';
import test from 'node:test';

import type { CreativeJob } from '@meiye/contracts';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import { ResultProvenance } from './result-provenance';

function job(overrides: Partial<CreativeJob> = {}): CreativeJob {
  return {
    batchNumber: 1,
    batchRootJobId: 'job-1',
    contract: {
      aigcLabelEnabled: true,
      catalogModelId: 'model.local-copy',
      catalogRevision: 'catalog-v1',
      currency: 'CNY',
      dataClass: [],
      estimatedAmount: 1,
      operation: 'copy.generate',
      outputCount: 3,
      outputLabel: '3 条内容候选',
      quoteAcceptedAt: '2026-01-01T00:00:00.000Z',
      quoteRevision: 'quote-v1',
      watermarkEnabled: false,
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    executionProvenance: {
      activationStatus: 'recorded',
      actualCatalogModelId: 'model.local-copy',
      apiCounterparty: 'Local fixture',
      modelDisplayName: '本地文案模型',
      providerModel: 'fixture-copy-v1',
    },
    id: 'job-1',
    outputAssetIds: [],
    outputContentIds: [],
    productUsageQuantity: 1,
    qualityRetryNumber: 0,
    routeSnapshotId: 'route-snapshot-secret-id',
    status: 'completed',
    submissionKey: 'job-1-submit',
    updatedAt: '2026-01-01T00:00:00.000Z',
    workId: 'work-1',
    workspaceId: 'workspace-1',
    ...overrides,
  };
}

test('shows merchant model labels without RouteSnapshot raw ids', () => {
  const html = renderToStaticMarkup(
    createElement(ResultProvenance, { job: job() })
  );

  assert.match(html, /实际模型：本地文案模型|Actual model: 本地文案模型/u);
  assert.match(html, /本地测试可用|Available for local testing/u);
  assert.match(html, /data-route-snapshot-id="route-snapshot-secret-id"/u);
  assert.match(html, /data-provenance="local_fixture"/u);
  assert.doesNotMatch(html, /RouteSnapshot/u);
  assert.doesNotMatch(html, /route-snapshot-secret-id(?!")/u);
});

test('keeps production provenance free of technical route chrome', () => {
  const html = renderToStaticMarkup(
    createElement(ResultProvenance, {
      job: job({
        executionProvenance: {
          activationStatus: 'live_verified',
          actualCatalogModelId: 'model.prod-copy',
          apiCounterparty: 'OpenAI',
          modelDisplayName: '生产文案模型',
          providerModel: 'gpt-fixture',
        },
        routeSnapshotId: 'route-prod-id',
      }),
    })
  );

  assert.match(html, /生产文案模型/u);
  assert.match(html, /data-provenance="production"/u);
  assert.doesNotMatch(
    html,
    /OpenAI|RouteSnapshot|local_fixture|route-prod-id(?!")/u
  );
});
