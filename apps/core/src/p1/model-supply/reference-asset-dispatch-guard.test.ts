import assert from 'node:assert/strict';
import test from 'node:test';
import type { ModelSupplySubmission } from './route-contracts.js';
import { withServerDerivedReferenceDataClass } from './reference-asset-dispatch-guard.js';

test('reference asset data classes are server-derived and ignore a client downgrade or blank value', async () => {
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
  assert.deepEqual(downgraded.dataClass, ['contains_face', 'pii']);
});
