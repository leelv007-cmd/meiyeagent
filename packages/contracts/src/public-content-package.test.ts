import assert from 'node:assert/strict';
import test from 'node:test';

import type { ContentPackage } from './content-package.js';
import { toPublicContentPackage } from './public-content-package.js';

test('public ContentPackage removes every supplier routing and internal cost field', () => {
  const internal = {
    id: 'package-1',
    generated: {
      assetIds: ['asset-1'],
      childRuns: [
        {
          actualCatalogModelId: 'catalog-model-1',
          apiCounterparty: 'provider-secret',
          assetIds: ['asset-1'],
          providerCost: { amount: 1.23, currency: 'USD', status: 'observed' },
          providerCosts: [
            {
              amount: 1.23,
              currency: 'USD',
              id: 'provider-cost-1',
              status: 'observed',
              usage: { mediaUnits: 1 },
            },
          ],
          providerModel: 'provider-model-secret',
          providerAttempts: [
            {
              acceptance: 'accepted',
              catalogModelId: 'catalog-model-1',
              createdAt: '2026-07-20T00:00:00.000Z',
              deploymentId: 'deployment-secret',
              id: 'attempt-1',
              jobId: 'job-1',
              providerTaskRef: 'provider-task-secret',
              status: 'completed',
            },
          ],
          routeSnapshot: {
            actualCatalogModelId: 'catalog-model-1',
            apiCounterparty: 'provider-secret',
            catalogRevisionId: 'catalog-revision-1',
            deploymentId: 'deployment-secret',
            endpointRevision: 'endpoint-secret',
            id: 'route-secret',
            providerModel: 'provider-model-secret',
          },
          routeSnapshotId: 'route-secret',
          runId: 'run-1',
          runType: 'model_job',
          status: 'succeeded',
        },
      ],
    },
  } as unknown as ContentPackage;

  const result = toPublicContentPackage(internal);
  const run = result.generated.childRuns[0]!;
  assert.equal(run.runId, 'run-1');
  assert.deepEqual(run.assetIds, ['asset-1']);
  assert.equal(run.actualCatalogModelId, 'catalog-model-1');

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    'apiCounterparty',
    'providerCost',
    'providerCosts',
    'providerModel',
    'providerAttempts',
    'providerTaskRef',
    'deploymentId',
    'routeSnapshot',
    'routeSnapshotId',
    'endpointRevision',
    'credential',
    'fallback',
  ]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
});
