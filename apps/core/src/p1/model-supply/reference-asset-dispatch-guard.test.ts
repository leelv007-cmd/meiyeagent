import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelSupplySubmission } from './route-contracts.js';
import { withServerDerivedReferenceDataClass } from './reference-asset-dispatch-guard.js';

test('reference asset data classes preserve declared classes and add server-derived classes', async () => {
  const base = {
    actorId: 'user-a',
    dataClass: [],
    idempotencyKey: 'dispatch-1',
    input: {
      inputAssets: [{ assetId: 'asset-sensitive', role: 'reference_image' }],
    },
    operation: 'image.edit',
    prompt: 'Use this reference.',
    selection: { catalogModelId: 'model-image', mode: 'fixed' },
    workspaceId: 'workspace-a',
  } satisfies ModelSupplySubmission;
  const resolver = {
    async inspect() {
      return [
        {
          assetId: 'asset-sensitive',
          contentType: 'image/png',
          dataClass: ['contains_face', 'pii'] as Array<
            'contains_face' | 'pii'
          >,
          kind: 'resolved' as const,
          rightsRevision: 'rights-r2',
          sha256: 'a'.repeat(64),
        },
      ];
    },
  };

  const blank = await withServerDerivedReferenceDataClass(base, resolver);
  const downgraded = await withServerDerivedReferenceDataClass(
    { ...base, dataClass: ['medical'] },
    resolver,
  );

  assert.deepEqual(blank.dataClass, ['contains_face', 'pii']);
  assert.deepEqual(downgraded.dataClass, [
    'contains_face',
    'medical',
    'pii',
  ]);
});

test('reference asset inspection failures fail closed before route planning', async () => {
  const submission = {
    actorId: 'user-a',
    dataClass: [],
    idempotencyKey: 'dispatch-fail-closed',
    input: {
      inputAssets: [{ assetId: 'asset-a', role: 'reference_image' }],
    },
    operation: 'image.edit',
    prompt: 'Use this reference.',
    selection: { catalogModelId: 'model-image', mode: 'fixed' },
    workspaceId: 'workspace-a',
  } satisfies ModelSupplySubmission;

  await assert.rejects(
    withServerDerivedReferenceDataClass(submission, undefined),
    /resolver is unavailable/u,
  );
  await assert.rejects(
    withServerDerivedReferenceDataClass(submission, {
      async inspect() {
        throw new Error('storage offline');
      },
    }),
    /inspection failed/u,
  );
  await assert.rejects(
    withServerDerivedReferenceDataClass(submission, {
      async inspect() {
        return [];
      },
    }),
    /incomplete or out of order/u,
  );
  await assert.rejects(
    withServerDerivedReferenceDataClass(submission, {
      async inspect() {
        return [
          {
            assetId: 'asset-a',
            kind: 'failure' as const,
            reason: 'rights_incomplete' as const,
          },
        ];
      },
    }),
    /is not dispatchable: rights_incomplete/u,
  );
});

test('unclassified owned references carry a domestic-only dispatch predicate without inventing a data class', async () => {
  const submission = {
    actorId: 'user-a',
    dataClass: [],
    idempotencyKey: 'dispatch-domestic-only',
    input: {
      inputAssets: [{ assetId: 'asset-local', role: 'reference_image' }],
    },
    operation: 'image.edit',
    prompt: 'Use this reference.',
    selection: { catalogModelId: 'model-image', mode: 'fixed' },
    workspaceId: 'workspace-a',
  } satisfies ModelSupplySubmission;

  const guarded = await withServerDerivedReferenceDataClass(submission, {
    async inspect() {
      return [
        {
          assetId: 'asset-local',
          classificationSource: 'unclassified' as const,
          contentType: 'image/png',
          dataClass: [],
          kind: 'resolved' as const,
          rightsRevision: 'rights-r1',
          sha256: 'a'.repeat(64),
        },
      ];
    },
  });

  assert.deepEqual(guarded.dataClass, []);
  assert.equal(guarded.referenceAssetRegionBoundary, 'domestic');
});
