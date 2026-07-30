import assert from 'node:assert/strict';
import test from 'node:test';

import { resumeWithRaisedServerLimit } from './bounded-execution-controller.js';
import {
  mediaBoundedCurrentBestSchema,
  mediaBoundedRequestFingerprint,
  parseMediaBoundedResume,
} from './media-bounded-execution.js';

test('media bounded current-best is strict and rejects receipt replay', () => {
  const valid = {
    schemaVersion: 'harness-media-current-best/v1' as const,
    requestFingerprint: 'a'.repeat(64),
    executionRootFingerprint: 'd'.repeat(64),
    kind: 'image' as const,
    phase: 'ready' as const,
    attempts: [
      { role: 'primary' as const, jobId: 'job-1', status: 'completed' as const },
    ],
    asset: { id: 'asset-1', sha256: 'sha-1' },
    countedAttemptIds: ['attempt-1'],
    countedProviderCostIds: ['cost-1'],
    attemptReceiptDigests: [{ id: 'attempt-1', digest: 'b'.repeat(64) }],
    providerCostReceiptDigests: [{ id: 'cost-1', digest: 'c'.repeat(64) }],
  };
  assert.deepEqual(mediaBoundedCurrentBestSchema.parse(valid), valid);
  assert.throws(() =>
    mediaBoundedCurrentBestSchema.parse({
      ...valid,
      countedAttemptIds: ['attempt-1', 'attempt-1'],
    }),
  );
  assert.throws(() =>
    mediaBoundedCurrentBestSchema.parse({ ...valid, extra: true }),
  );
});

test('media bounded current-best pins one fixed exact-text route and rejects digest drift', () => {
  const snapshot = {
    id: 'route-text-1',
    catalogRevisionId: 'catalog-text-r1',
    requestedSelection: {
      mode: 'fixed' as const,
      catalogModelId: 'model-text-1',
      fallbackConsent: false,
    },
    candidateCatalogModelIds: ['model-text-1'],
    actualCatalogModelId: 'model-text-1',
    deploymentId: 'deployment-text-1',
    fallbackConsent: false,
    maxAttempts: 1,
    fallbackAuthorized: false,
    allowedCandidates: [
      {
        catalogModelId: 'model-text-1',
        deploymentId: 'deployment-text-1',
        modelOperations: ['text.respond'],
      },
    ],
    reason: 'fixed_selection' as const,
    dataClass: [],
    createdAt: '2026-07-29T00:00:00.000Z',
  };
  const exactTextRoute = {
    snapshot,
    digest: mediaBoundedRequestFingerprint(snapshot),
  };
  const currentBest = {
    schemaVersion: 'harness-media-current-best/v1' as const,
    requestFingerprint: 'a'.repeat(64),
    executionRootFingerprint: 'd'.repeat(64),
    kind: 'image' as const,
    phase: 'ready' as const,
    attempts: [
      { role: 'primary' as const, jobId: 'job-1', status: 'completed' as const },
    ],
    asset: { id: 'asset-1', sha256: 'sha-1' },
    countedAttemptIds: ['attempt-1'],
    countedProviderCostIds: ['cost-1'],
    attemptReceiptDigests: [{ id: 'attempt-1', digest: 'b'.repeat(64) }],
    providerCostReceiptDigests: [{ id: 'cost-1', digest: 'c'.repeat(64) }],
    exactTextRoute,
  };

  assert.deepEqual(
    mediaBoundedCurrentBestSchema.parse(currentBest).exactTextRoute,
    exactTextRoute,
  );
  assert.throws(
    () =>
      mediaBoundedCurrentBestSchema.parse({
        ...currentBest,
        exactTextRoute: {
          ...exactTextRoute,
          snapshot: {
            ...snapshot,
            createdAt: '2026-07-29T00:00:01.000Z',
          },
        },
      }),
    /digest does not match/u,
  );
  assert.throws(() =>
    mediaBoundedCurrentBestSchema.parse({
      ...currentBest,
      exactTextRoute: { ...exactTextRoute, extra: true },
    }),
  );
  const fallbackRoute = { ...snapshot, maxAttempts: 2 };
  assert.throws(() =>
    mediaBoundedCurrentBestSchema.parse({
      ...currentBest,
      exactTextRoute: {
        snapshot: fallbackRoute,
        digest: mediaBoundedRequestFingerprint(fallbackRoute),
      },
    }),
  );
});

test('media bounded fingerprint is canonical and resume accepts only the raised successor', () => {
  assert.equal(
    mediaBoundedRequestFingerprint({ z: 1, nested: { b: 2, a: 1 } }),
    mediaBoundedRequestFingerprint({ nested: { a: 1, b: 2 }, z: 1 }),
  );
  const predecessor = {
    schemaVersion: 'bounded-execution-snapshot/v1' as const,
    maxIterations: 1,
    maxCostCents: 'unset' as const,
    maxWallClockMs: 'unset' as const,
    maxDelegations: 'unset' as const,
    requiredLimits: ['maxIterations' as const],
    consumption: {
      iterations: 1,
      costCents: 0,
      wallClockMs: 0,
      delegations: 0,
    },
    stopReason: 'limit_reached' as const,
    triggeredLimit: 'maxIterations' as const,
  };
  const currentBest = {
    schemaVersion: 'harness-media-current-best/v1' as const,
    requestFingerprint: 'a'.repeat(64),
    executionRootFingerprint: 'd'.repeat(64),
    kind: 'image' as const,
    phase: 'ready' as const,
    attempts: [
      { role: 'primary' as const, jobId: 'job-1', status: 'completed' as const },
    ],
    asset: { id: 'asset-1', sha256: 'sha-1' },
    countedAttemptIds: ['attempt-1'],
    countedProviderCostIds: ['cost-1'],
    attemptReceiptDigests: [{ id: 'attempt-1', digest: 'b'.repeat(64) }],
    providerCostReceiptDigests: [{ id: 'cost-1', digest: 'c'.repeat(64) }],
  };
  const suspension = {
    state: 'suspended' as const,
    snapshot: predecessor,
    currentBest,
    unmetExplanation: 'limit reached',
    resumable: true as const,
  };
  const successor = resumeWithRaisedServerLimit(predecessor, {
    limit: 'maxIterations',
    value: 2,
  });
  assert.deepEqual(
    parseMediaBoundedResume(
      suspension,
      successor,
      'a'.repeat(64),
      'd'.repeat(64),
      'image',
    ),
    currentBest,
  );
  assert.throws(() =>
    parseMediaBoundedResume(
      suspension,
      { ...successor, consumption: { ...successor.consumption, costCents: 1 } },
      'a'.repeat(64),
      'd'.repeat(64),
      'image',
    ),
  );
  assert.throws(() =>
    parseMediaBoundedResume(
      suspension,
      successor,
      'b'.repeat(64),
      'd'.repeat(64),
      'image',
    ),
  );
  const forgedPredecessor = {
    ...predecessor,
    maxIterations: 5,
  };
  assert.throws(() =>
    parseMediaBoundedResume(
      { ...suspension, snapshot: forgedPredecessor },
      {
        ...successor,
        maxIterations: 6,
        consumption: forgedPredecessor.consumption,
      },
      'a'.repeat(64),
      'd'.repeat(64),
      'image',
    ),
  );
});
