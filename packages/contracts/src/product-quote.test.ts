import assert from 'node:assert/strict';
import test from 'node:test';

import type { ProductQuoteSnapshot } from './product-quote.js';
import { toPublicProductQuoteSnapshot } from './product-quote.js';

test('public ProductQuoteSnapshot removes every server-only routing field', () => {
  const internal = {
    quoteId: 'quote-1',
    revision: 'rev-1',
    taskId: 'task-1',
    workspaceId: 'workspace-1',
    catalogModelId: 'catalog-model-1',
    catalogModelRevision: 'catalog-revision-1',
    quotePolicyRevision: 'quote.policy@1',
    billingMode: 'per_request',
    formula: {
      unitRate: 1.5,
      currency: 'CNY',
      expression: 'per_request × 1.5 × 1 outputs',
    },
    confirmedAmount: 1.5,
    authorizedCeiling: 1.5,
    routeSnapshotRef: 'route-secret',
    frozenCandidateDeploymentIds: ['deployment-secret', 'deployment-fallback'],
    lifecycleStatus: 'quoted',
    createdAt: '2026-07-20T00:00:00.000Z',
  } as ProductQuoteSnapshot;

  const result = toPublicProductQuoteSnapshot(internal);
  assert.equal(result.quoteId, 'quote-1');
  assert.equal(result.catalogModelId, 'catalog-model-1');
  assert.equal(result.confirmedAmount, 1.5);
  assert.equal('routeSnapshotRef' in result, false);
  assert.equal('frozenCandidateDeploymentIds' in result, false);

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    'deploymentId',
    'frozenCandidateDeploymentIds',
    'routeSnapshotRef',
    'credential',
    'Provider',
    'fallback',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
