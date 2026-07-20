import assert from 'node:assert/strict';
import test from 'node:test';
import {
  MemoryModelSupplyControlPlaneRepository,
} from './foundation-module.js';
import type { ModelSupplyResult } from './ledger-contracts.js';

function result(input: {
  jobId: string;
  operation: 'copy.generate' | 'image.generate';
  createdAt: string;
  deploymentId: string;
  dataClass: 'contains_face' | null;
}): ModelSupplyResult {
  const attempt = {
    id: `attempt:${input.jobId}`,
    jobId: input.jobId,
    catalogModelId:
      input.operation === 'image.generate' ? 'model-image' : 'model-copy',
    deploymentId: input.deploymentId,
    acceptance: 'accepted' as const,
    status: 'completed' as const,
    createdAt: input.createdAt,
  };
  return {
    jobId: input.jobId,
    operation: input.operation,
    status: 'completed',
    snapshot: {
      id: `snapshot:${input.jobId}`,
      catalogRevisionId: 'catalog:r1',
      requestedSelection: { mode: 'fixed' },
      candidateCatalogModelIds: [attempt.catalogModelId],
      actualCatalogModelId: attempt.catalogModelId,
      deploymentId: input.deploymentId,
      policyRevision: 'policy:r1',
      priceRevision: 'price:r1',
      credentialMode: 'platform',
      credentialVersion: 'credential:r1',
      fallbackConsent: false,
      reason: 'fixed_selection',
      dataClass: input.dataClass ? [input.dataClass] : [],
      createdAt: input.createdAt,
    },
    attempt,
    attempts: [attempt],
    usage: { id: `usage:${input.jobId}`, status: 'committed', quantity: 1 },
    providerCost: {
      id: `cost:${input.jobId}`,
      status: 'observed',
      amount: 0.01,
      currency: 'CNY',
      usage: {},
    },
    providerCosts: [],
  };
}

test('listJobs returns a filtered, sorted server page', async () => {
  const repository = new MemoryModelSupplyControlPlaneRepository();
  await repository.saveResult(
    'workspace-a',
    result({
      jobId: 'image-old',
      operation: 'image.generate',
      createdAt: '2026-07-20T01:00:00.000Z',
      deploymentId: 'deployment-image-a',
      dataClass: null,
    }),
  );
  await repository.saveResult(
    'workspace-a',
    result({
      jobId: 'copy-newest',
      operation: 'copy.generate',
      createdAt: '2026-07-20T03:00:00.000Z',
      deploymentId: 'deployment-copy-a',
      dataClass: null,
    }),
  );
  await repository.saveResult(
    'workspace-a',
    result({
      jobId: 'image-new',
      operation: 'image.generate',
      createdAt: '2026-07-20T02:00:00.000Z',
      deploymentId: 'deployment-image-b',
      dataClass: 'contains_face',
    }),
  );

  const page = await repository.listJobs('workspace-a', {
    page: 1,
    pageSize: 1,
    sort: 'startedAt',
    dir: 'desc',
    operation: 'image.generate',
  });

  assert.equal(page.total, 2);
  assert.equal(page.items.length, 1);
  assert.equal(page.items[0]?.jobId, 'image-new');
  assert.deepEqual(page.facets.operations, [
    'copy.generate',
    'image.generate',
  ]);
});
