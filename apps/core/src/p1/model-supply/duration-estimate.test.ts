import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryFoundationRepository } from '../foundation/memory-repository.js';
import { durationEstimateFromSamples } from './duration-estimate.js';

const asOf = '2026-07-13T12:00:00.000Z';

test('duration estimates require five live samples', () => {
  assert.deepEqual(durationEstimateFromSamples([8, 9, 10, 11], asOf), {
    status: 'insufficient_data',
    sampleSize: 4,
    minimumSampleSize: 5,
    windowDays: 30,
    asOf,
  });
});

test('duration estimates report nearest-rank P50 and P90', () => {
  assert.deepEqual(
    durationEstimateFromSamples([30, 10, 50, 20, 40, 60, 70, 80, 90, 100], asOf),
    {
      status: 'observed',
      p50Seconds: 50,
      p90Seconds: 90,
      sampleSize: 10,
      windowDays: 30,
      asOf,
    }
  );
});

test('duration samples include only recent completed live-verified jobs for the fixed model', async () => {
  const repository = new MemoryFoundationRepository();
  await repository.insertRouteSnapshot({
    id: 'route-live',
    workspaceId: 'workspace-a',
    catalogRevision: 'catalog-v1',
    policyRevision: 'policy-v1',
    priceRevision: 'price-v1',
    requestedCatalogModelId: 'llm-openai',
    selectionMode: 'fixed',
    dataClass: 'public',
    fallbackConsent: false,
    allowedCandidates: [
      {
        catalogModelId: 'llm-openai',
        deploymentId: 'openai-live',
        region: 'global',
        credentialMode: 'platform',
        credentialVersion: 'credential-v1',
        activationStatus: 'live_verified',
      },
    ],
    createdAt: '2026-07-01T00:00:00.000Z',
  });
  await repository.insertRouteSnapshot({
    id: 'route-recorded',
    workspaceId: 'workspace-a',
    catalogRevision: 'catalog-v1',
    policyRevision: 'policy-v1',
    priceRevision: 'price-v1',
    requestedCatalogModelId: 'llm-openai',
    selectionMode: 'fixed',
    dataClass: 'public',
    fallbackConsent: false,
    allowedCandidates: [
      {
        catalogModelId: 'llm-openai',
        deploymentId: 'openai-recorded',
        region: 'global',
        credentialMode: 'platform',
        credentialVersion: 'credential-v1',
        activationStatus: 'recorded',
      },
    ],
    createdAt: '2026-07-01T00:00:00.000Z',
  });
  for (const [index, seconds] of [10, 20, 30, 40, 50].entries()) {
    await repository.insertGenerationJob({
      id: `job-live-${index}`,
      workspaceId: 'workspace-a',
      operation: 'copy',
      routeSnapshotId: 'route-live',
      usageReservationId: `usage-${index}`,
      status: 'completed',
      createdBy: 'owner-a',
      correlationId: `corr-${index}`,
      createdAt: '2026-07-10T00:00:00.000Z',
      updatedAt: new Date(
        Date.parse('2026-07-10T00:00:00.000Z') + seconds * 1_000
      ).toISOString(),
    });
  }
  await repository.insertGenerationJob({
    id: 'job-recorded',
    workspaceId: 'workspace-a',
    operation: 'copy',
    routeSnapshotId: 'route-recorded',
    usageReservationId: 'usage-recorded',
    status: 'completed',
    createdBy: 'owner-a',
    correlationId: 'corr-recorded',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:10:00.000Z',
  });
  await repository.insertGenerationJob({
    id: 'job-failed',
    workspaceId: 'workspace-a',
    operation: 'copy',
    routeSnapshotId: 'route-live',
    usageReservationId: 'usage-failed',
    status: 'failed',
    createdBy: 'owner-a',
    correlationId: 'corr-failed',
    createdAt: '2026-07-10T00:00:00.000Z',
    updatedAt: '2026-07-10T00:20:00.000Z',
  });

  assert.deepEqual(
    await repository.listGenerationDurationSamples(
      'workspace-a',
      'copy',
      'llm-openai',
      '2026-06-13T00:00:00.000Z'
    ),
    [10, 20, 30, 40, 50]
  );
});
