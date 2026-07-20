import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { P1ApplicationService } from './application-service.js';
import { MemoryFoundationRepository } from './memory-repository.js';

const owner = {
  workspaceId: 'ws-compensate',
  userId: 'owner-compensate',
  correlationId: 'corr-compensate',
};

const routeSnapshot = {
  id: 'route-outer',
  catalogRevision: 'catalog-r1',
  policyRevision: 'policy-r1',
  priceRevision: 'price-r1',
  requestedCatalogModelId: 'seedance-2',
  selectionMode: 'fixed' as const,
  dataClass: 'public' as const,
  fallbackConsent: false,
  allowedCandidates: [
    {
      catalogModelId: 'seedance-2',
      deploymentId: 'seedance-primary',
      region: 'cn' as const,
      credentialMode: 'platform' as const,
      credentialVersion: 'v1',
    },
  ],
};

describe('Td-2 compensateCommittedUsage', () => {
  it('refunds reserved usage and compensates committed usage idempotently', async () => {
    const repository = new MemoryFoundationRepository();
    repository.grantOwner(owner.workspaceId, owner.userId);
    const service = new P1ApplicationService(repository);

    await service.appendUsageEvent(
      owner,
      {
        id: 'adj-open',
        resource: 'video',
        action: 'adjust',
        amount: 5,
        reason: 'open',
      },
      'adj-open',
    );
    await service.appendUsageEvent(
      owner,
      {
        id: 'res-1',
        resource: 'video',
        action: 'reserve',
        amount: 1,
        reservationId: 'reservation-outer',
        reason: 'video_generate',
      },
      'res-1',
    );
    await service.startGeneration(
      owner,
      {
        jobId: 'job-outer',
        operation: 'video',
        usageReservationId: 'reservation-outer',
        routeSnapshot: { ...routeSnapshot, id: 'route-outer' },
      },
      'start-outer',
    );

    // Still reserved → refund path.
    const refunded = await service.compensateCommittedUsage(
      owner,
      { jobId: 'job-outer', reason: 'outer_compose_failed' },
      'comp-1',
    );
    assert.equal(refunded.kind, 'refund');
    assert.equal(refunded.amount, 1);

    // New committed reservation for second job.
    await service.appendUsageEvent(
      owner,
      {
        id: 'res-2',
        resource: 'video',
        action: 'reserve',
        amount: 1,
        reservationId: 'reservation-committed',
        reason: 'video_generate',
      },
      'res-2',
    );
    await service.startGeneration(
      owner,
      {
        jobId: 'job-committed',
        operation: 'video',
        usageReservationId: 'reservation-committed',
        routeSnapshot: { ...routeSnapshot, id: 'route-committed' },
      },
      'start-committed',
    );
    await service.appendUsageEvent(
      owner,
      {
        id: 'commit-2',
        resource: 'video',
        action: 'commit',
        amount: 1,
        reservationId: 'reservation-committed',
        reason: 'owned_asset_delivered',
      },
      'commit-2',
    );

    const before = await service.getUsageProjection(owner, 'video');
    const compensated = await service.compensateCommittedUsage(
      owner,
      {
        jobId: 'job-committed',
        reason: 'COMPOSED_VIDEO_TECHNICAL_VALIDATION_FAILED',
      },
      'comp-2',
    );
    assert.equal(compensated.kind, 'compensate');
    assert.equal(compensated.amount, 1);
    const after = await service.getUsageProjection(owner, 'video');
    assert.equal(after.available, before.available + 1);

    const replay = await service.compensateCommittedUsage(
      owner,
      {
        jobId: 'job-committed',
        reason: 'COMPOSED_VIDEO_TECHNICAL_VALIDATION_FAILED',
      },
      'comp-2',
    );
    assert.equal(replay.kind, 'compensate');
    const afterReplay = await service.getUsageProjection(owner, 'video');
    assert.equal(afterReplay.available, after.available);
  });
});
