import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CURRENT_PROVIDER_REFERENCE_POLICY,
  CURRENT_PROVIDER_REFERENCE_DECISION,
  ProviderReferencePolicyError,
  providerReferenceReleaseConformance,
  resolveProviderReferenceTransport,
} from './provider-reference-policy.js';

test('provider reference release conformance fails closed while the live probe is undetermined', () => {
  assert.equal(CURRENT_PROVIDER_REFERENCE_DECISION.status, 'undetermined');
  assert.equal(CURRENT_PROVIDER_REFERENCE_DECISION.grantEndpoint, null);

  assert.deepEqual(providerReferenceReleaseConformance(), {
    failures: ['PROVIDER_REFERENCE_PROBE_REQUIRED'],
    grantEndpoint: null,
    grantUrlsProduced: false,
    ready: false,
  });
});

test('an undetermined provider reference decision cannot produce a provider or grant URL', () => {
  assert.throws(
    () =>
      resolveProviderReferenceTransport({
        assetId: 'owned-reference-a',
        ownedDataUrl: 'data:image/png;base64,AQID',
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderReferencePolicyError);
      assert.equal(error.code, 'PROVIDER_REFERENCE_PROBE_REQUIRED');
      assert.doesNotMatch(error.message, /data:image|AQID|owned-reference-a/u);
      return true;
    },
  );
});

test('the current policy blocks only dispatches that contain reference assets', () => {
  assert.doesNotThrow(() =>
    CURRENT_PROVIDER_REFERENCE_POLICY.assertCanDispatch({
      referenceAssetCount: 0,
    }),
  );
  assert.throws(
    () =>
      CURRENT_PROVIDER_REFERENCE_POLICY.assertCanDispatch({
        referenceAssetCount: 1,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderReferencePolicyError);
      assert.equal(error.code, 'PROVIDER_REFERENCE_PROBE_REQUIRED');
      assert.doesNotMatch(error.message, /video|referenceAssetCount|1/u);
      return true;
    },
  );
});
