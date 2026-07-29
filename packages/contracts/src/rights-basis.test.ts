import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  rightsBasisSchema,
  type RightsBasis,
  type SupplyContract,
} from './index.js';

describe('rights basis', () => {
  it('keeps source authorization and AI generation terms as exclusive branches', () => {
    const sourceBasis = {
      kind: 'source_asset_authorizations',
      rightsRefs: ['rights:asset:1'],
    } satisfies RightsBasis;
    const aiBasis = {
      kind: 'ai_generation_terms',
      generatedAssetId: 'asset:generated:1',
      runId: 'run:video:1',
      providerTaskRef: 'provider-task:1',
      termsRevisionId: 'terms:video:r1',
      commercialUse: 'allowed',
    } satisfies RightsBasis;

    assert.deepEqual(rightsBasisSchema.parse(sourceBasis), sourceBasis);
    assert.deepEqual(rightsBasisSchema.parse(aiBasis), aiBasis);
  });

  it('keeps historical supply contracts readable while admitting explicit commercial use', () => {
    const historical = {
      id: 'contract:video:legacy',
      providerProfileId: 'provider:video',
      termsRevisionId: 'terms:video:legacy',
      effectiveFrom: '2026-01-01T00:00:00.000Z',
    } satisfies SupplyContract;
    const commercial = {
      ...historical,
      id: 'contract:video:r1',
      termsRevisionId: 'terms:video:r1',
      commercialUse: 'allowed',
    } satisfies SupplyContract;

    assert.equal('commercialUse' in historical, false);
    assert.equal(commercial.commercialUse, 'allowed');
  });

  it('rejects empty, incomplete, non-commercial, and mixed rights evidence', () => {
    const invalid = [
      {
        kind: 'source_asset_authorizations',
        rightsRefs: [],
      },
      {
        kind: 'ai_generation_terms',
        generatedAssetId: 'asset:generated:1',
        runId: 'run:video:1',
        providerTaskRef: 'provider-task:1',
        commercialUse: 'allowed',
      },
      {
        kind: 'ai_generation_terms',
        generatedAssetId: 'asset:generated:1',
        runId: 'run:video:1',
        providerTaskRef: 'provider-task:1',
        termsRevisionId: 'terms:video:r1',
        commercialUse: 'unknown',
      },
      {
        kind: 'ai_generation_terms',
        generatedAssetId: 'asset:generated:1',
        runId: 'run:video:1',
        providerTaskRef: 'provider-task:1',
        termsRevisionId: 'terms:video:r1',
        commercialUse: 'allowed',
        rightsRefs: ['rights:asset:1'],
      },
      {
        kind: 'ai_generation_terms',
        generatedAssetId: ' ',
        runId: 'run:video:1',
        providerTaskRef: 'provider-task:1',
        termsRevisionId: 'terms:video:r1',
        commercialUse: 'allowed',
      },
    ];

    for (const candidate of invalid) {
      assert.equal(rightsBasisSchema.safeParse(candidate).success, false);
    }
  });
});
