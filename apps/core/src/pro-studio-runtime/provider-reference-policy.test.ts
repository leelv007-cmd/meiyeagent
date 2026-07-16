import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CURRENT_PROVIDER_REFERENCE_POLICY,
  CURRENT_PROVIDER_REFERENCE_DECISION,
  ProviderReferencePolicyError,
  providerReferenceReleaseConformance,
} from './provider-reference-policy.js';

test('provider reference release conformance accepts owned reference uploads after the live probe passes', () => {
  assert.equal(
    CURRENT_PROVIDER_REFERENCE_DECISION.status,
    'accepted_owned_reference_upload',
  );
  assert.equal(CURRENT_PROVIDER_REFERENCE_DECISION.grantEndpoint, null);

  assert.deepEqual(providerReferenceReleaseConformance(), {
    failures: [],
    grantEndpoint: null,
    grantUrlsProduced: false,
    ready: true,
    verifiedTransports: [
      {
        deploymentId: 'gpt-image-2-tuzi-relay',
        executionChannelId: 'channel-tuzi-gpt-image-2-relay',
        operation: 'image.edit',
        providerModel: 'doubao-seedream-4-5-251128',
        providerProfileId: 'provider-tu-zi-openai',
        transport: 'multipart_upload_from_owned_data_url',
      },
    ],
  });
});

test('the current policy permits only the verified provider transport tuple', () => {
  assert.doesNotThrow(() =>
    CURRENT_PROVIDER_REFERENCE_POLICY.assertCanDispatch({
      deploymentId: 'gpt-image-2-tuzi-relay',
      executionChannelId: 'channel-tuzi-gpt-image-2-relay',
      operation: 'image.edit',
      providerModel: 'doubao-seedream-4-5-251128',
      providerProfileId: 'provider-tu-zi-openai',
      referenceAssetCount: 1,
    }),
  );
  assert.throws(
    () =>
      CURRENT_PROVIDER_REFERENCE_POLICY.assertCanDispatch({
        deploymentId: 'seedance-2-tuzi-relay',
        executionChannelId: 'channel-tuzi-seedance-relay',
        operation: 'video.generate',
        providerModel: 'doubao-seedance-1-5-pro_720p',
        providerProfileId: 'provider-tu-zi',
        referenceAssetCount: 1,
      }),
    (error: unknown) => {
      assert.ok(error instanceof ProviderReferencePolicyError);
      assert.equal(error.code, 'PROVIDER_REFERENCE_PROBE_REQUIRED');
      return true;
    },
  );
  assert.throws(() =>
    CURRENT_PROVIDER_REFERENCE_POLICY.assertCanDispatch({
      deploymentId: 'gpt-image-2-tuzi-relay',
      executionChannelId: 'channel-unverified-transport',
      operation: 'image.edit',
      providerModel: 'doubao-seedream-4-5-251128',
      providerProfileId: 'provider-tu-zi-openai',
      referenceAssetCount: 1,
    }),
  );
});

test('dispatches without references do not require a provider transport probe', () => {
  assert.doesNotThrow(() =>
    CURRENT_PROVIDER_REFERENCE_POLICY.assertCanDispatch({
      deploymentId: 'unverified-deployment',
      executionChannelId: 'unverified-channel',
      operation: 'video.generate',
      providerModel: 'unverified-model',
      providerProfileId: 'unverified-provider',
      referenceAssetCount: 0,
    }),
  );
});
