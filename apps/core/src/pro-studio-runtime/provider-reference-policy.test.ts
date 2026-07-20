import assert from 'node:assert/strict';
import test from 'node:test';
import { MemoryProStudioAccessAudit } from '../pro-studio/security-access-audit.js';
import {
  CURRENT_PROVIDER_REFERENCE_POLICY,
  CURRENT_PROVIDER_REFERENCE_DECISION,
  LOCAL_FIXTURE_PROVIDER_REFERENCE_POLICY,
  ProviderReferencePolicyError,
  providerReferenceReleaseConformance,
  rejectProviderReferenceGrantAccess,
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
        deploymentId: 'seedream-4-5-tuzi-relay',
        executionChannelId: 'channel-tuzi-seedream-4-5-relay',
        operation: 'image.edit',
        providerModel: 'doubao-seedream-4-5-251128',
        providerProfileId: 'provider-tu-zi-openai',
        transport: 'multipart_upload_from_owned_data_url',
      },
      {
        deploymentId: 'seedream-4-5-tuzi-relay',
        executionChannelId: 'channel-tuzi-seedream-4-5-relay',
        operation: 'image.generate',
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
      deploymentId: 'seedream-4-5-tuzi-relay',
      executionChannelId: 'channel-tuzi-seedream-4-5-relay',
      operation: 'image.edit',
      providerModel: 'doubao-seedream-4-5-251128',
      providerProfileId: 'provider-tu-zi-openai',
      referenceAssetCount: 1,
    }),
  );
  assert.doesNotThrow(() =>
    CURRENT_PROVIDER_REFERENCE_POLICY.assertCanDispatch({
      deploymentId: 'seedream-4-5-tuzi-relay',
      executionChannelId: 'channel-tuzi-seedream-4-5-relay',
      operation: 'image.generate',
      providerModel: 'doubao-seedream-4-5-251128',
      providerProfileId: 'provider-tu-zi-openai',
      referenceAssetCount: 1,
    }),
  );
  assert.throws(
    () =>
      CURRENT_PROVIDER_REFERENCE_POLICY.assertCanDispatch({
        deploymentId: 'seedance-1-5-pro-tuzi-relay',
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
      deploymentId: 'seedream-4-5-tuzi-relay',
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

test('the explicitly injected local fixture policy permits owned references', () => {
  assert.doesNotThrow(() =>
    LOCAL_FIXTURE_PROVIDER_REFERENCE_POLICY.assertCanDispatch({
      deploymentId: 'fixture-image-deployment',
      executionChannelId: 'fixture-channel',
      operation: 'image.generate',
      providerModel: 'fixture-image-model',
      providerProfileId: 'fixture-provider',
      referenceAssetCount: 2,
    }),
  );
});

test('disabled grant mint attempts leave a grant_access_denied audit', async () => {
  const accessAudit = new MemoryProStudioAccessAudit(
    () => new Date('2026-07-16T12:00:00.000Z'),
  );
  await assert.rejects(
    rejectProviderReferenceGrantAccess({
      accessAudit,
      actorId: 'user-2',
      grantId: 'grant-foreign',
      workspaceId: 'workspace-2',
    }),
    (error: unknown) =>
      error instanceof ProviderReferencePolicyError &&
      error.code === 'PROVIDER_REFERENCE_PROBE_REQUIRED',
  );
  assert.equal(accessAudit.byKind('grant')[0]?.action, 'grant_access_denied');
  assert.equal(accessAudit.byKind('grant')[0]?.objectId, 'grant-foreign');
});
