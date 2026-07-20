/**
 * Multi-channel publish gate negative tests (I4 → Z2-ACCEPT).
 * Core op with <2 qualified independent fault domains cannot mark multi-channel ready.
 */
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adminChannelLabel,
  CHANNEL_LABEL,
  isSingleChannelNoFallback,
  userSelectChannelLabel,
} from './channel-label.js';
import {
  assertMultiChannelReadyClaim,
  evaluateMultiChannelPublishGate,
  MultiChannelPublishGateError,
  qualifiedDeployment,
} from './publish-gate.js';
import { faultDomainKey } from './types.js';

const catalogModelId = 'llm-doubao-seed-mini';

function dualLiveDeployments() {
  return [
    qualifiedDeployment({
      deploymentId: 'dep-text-ark',
      catalogModelId,
      providerProfileId: 'pp-volcengine-ark',
      executionChannelId: 'ec-ark',
      channelKind: 'official_direct',
      activationStatus: 'live_verified',
      manufacturer: 'volcengine',
      accountIdentity: 'ark-account-1',
      endpointFingerprint: 'ark.cn-beijing',
    }),
    qualifiedDeployment({
      deploymentId: 'dep-text-tuzi',
      catalogModelId,
      providerProfileId: 'pp-tuzi-upstream',
      executionChannelId: 'ec-tuzi',
      channelKind: 'upstream_reseller',
      activationStatus: 'live_verified',
      manufacturer: 'google',
      accountIdentity: 'tuzi-account-1',
      endpointFingerprint: 'tuzi.api',
    }),
  ];
}

test('core op with dual independent live_verified domains is multi_channel_ready', () => {
  const gate = evaluateMultiChannelPublishGate({
    operation: 'copy.generate',
    catalogModelId,
    deployments: dualLiveDeployments(),
    requireLiveVerified: true,
  });
  assert.equal(gate.status, 'multi_channel_ready');
  assert.equal(gate.multiChannelReady, true);
  assert.equal(gate.independentFaultDomainCount, 2);
  assert.equal(gate.manufacturerIndependent, true);
  assert.equal(gate.hasOfficialDirect, true);
  assert.equal(gate.hasUpstreamReseller, true);
  assert.equal(gate.channelLabel, CHANNEL_LABEL.multiChannelReady);
  assert.equal(gate.publishAllowed, true);

  const claimed = assertMultiChannelReadyClaim({
    operation: 'copy.generate',
    catalogModelId,
    deployments: dualLiveDeployments(),
    claim: 'multi_channel_ready',
    requireLiveVerified: true,
  });
  assert.equal(claimed.multiChannelReady, true);
});

test('NEGATIVE: single qualified Deployment cannot mark multi-channel ready', () => {
  const single = [
    qualifiedDeployment({
      deploymentId: 'dep-only',
      catalogModelId,
      providerProfileId: 'pp-volcengine-ark',
      executionChannelId: 'ec-ark',
      channelKind: 'official_direct',
      activationStatus: 'live_verified',
      manufacturer: 'volcengine',
      accountIdentity: 'ark-account-only',
      endpointFingerprint: 'ark.endpoint.only',
    }),
  ];
  const gate = evaluateMultiChannelPublishGate({
    operation: 'copy.generate',
    catalogModelId,
    deployments: single,
    requireLiveVerified: true,
  });
  assert.equal(gate.status, 'single_channel');
  assert.equal(gate.multiChannelReady, false);
  assert.equal(gate.independentFaultDomainCount, 1);
  assert.equal(gate.channelLabel, CHANNEL_LABEL.singleChannelNoFallback);
  assert.ok(isSingleChannelNoFallback(gate));
  assert.match(adminChannelLabel(gate), /single-channel\/no-fallback/);
  assert.equal(userSelectChannelLabel(gate), '单渠道 / 无回退');

  assert.throws(
    () =>
      assertMultiChannelReadyClaim({
        operation: 'copy.generate',
        catalogModelId,
        deployments: single,
        claim: 'multi_channel_ready',
        requireLiveVerified: true,
      }),
    (error: unknown) => {
      assert.ok(error instanceof MultiChannelPublishGateError);
      assert.equal(error.gate.multiChannelReady, false);
      assert.match(error.message, /multi_channel_ready/);
      return true;
    },
  );
});

test('NEGATIVE: same-account dual token does not count as two fault domains', () => {
  const sameAccount = [
    qualifiedDeployment({
      deploymentId: 'dep-token-a',
      catalogModelId,
      providerProfileId: 'pp-volcengine-ark',
      executionChannelId: 'ec-ark-a',
      channelKind: 'official_direct',
      activationStatus: 'live_verified',
      manufacturer: 'volcengine',
      accountIdentity: 'shared-account',
      endpointFingerprint: 'ark.cn-beijing',
    }),
    qualifiedDeployment({
      deploymentId: 'dep-token-b',
      catalogModelId,
      providerProfileId: 'pp-volcengine-ark',
      executionChannelId: 'ec-ark-b',
      channelKind: 'official_direct',
      activationStatus: 'live_verified',
      manufacturer: 'volcengine',
      accountIdentity: 'shared-account',
      endpointFingerprint: 'ark.cn-beijing',
    }),
  ];
  // Same provider+channel+account+endpoint → one domain key.
  assert.equal(
    faultDomainKey({
      accountIdentity: 'shared-account',
      endpointFingerprint: 'ark.cn-beijing',
    }),
    sameAccount[0]!.faultDomainKey,
  );
  assert.equal(sameAccount[0]!.faultDomainKey, sameAccount[1]!.faultDomainKey);

  const gate = evaluateMultiChannelPublishGate({
    operation: 'image.generate',
    catalogModelId: 'seedream-5-pro',
    deployments: sameAccount,
    requireLiveVerified: true,
  });
  assert.equal(gate.independentFaultDomainCount, 1);
  assert.equal(gate.multiChannelReady, false);
  assert.equal(gate.status, 'single_channel');

  assert.throws(() =>
    assertMultiChannelReadyClaim({
      operation: 'image.generate',
      catalogModelId: 'seedream-5-pro',
      deployments: sameAccount,
      claim: 'multi_channel_ready',
    }),
  );
});

test('NEGATIVE: same-endpoint dual alias does not count as two fault domains', () => {
  const aliases = [
    qualifiedDeployment({
      deploymentId: 'dep-alias-1',
      catalogModelId: 'seedance-1-5-pro',
      providerProfileId: 'pp-tuzi-upstream',
      executionChannelId: 'ec-tuzi-1',
      channelKind: 'upstream_reseller',
      activationStatus: 'live_verified',
      manufacturer: 'bytedance',
      accountIdentity: 'tuzi-1',
      endpointFingerprint: 'api.tuzi.com/v1',
    }),
    qualifiedDeployment({
      deploymentId: 'dep-alias-2',
      catalogModelId: 'seedance-1-5-pro',
      providerProfileId: 'pp-tuzi-upstream',
      executionChannelId: 'ec-tuzi-2',
      channelKind: 'upstream_reseller',
      activationStatus: 'live_verified',
      manufacturer: 'bytedance',
      accountIdentity: 'tuzi-1',
      endpointFingerprint: 'api.tuzi.com/v1',
    }),
  ];
  const gate = evaluateMultiChannelPublishGate({
    operation: 'video.generate',
    catalogModelId: 'seedance-1-5-pro',
    deployments: aliases,
  });
  assert.equal(gate.independentFaultDomainCount, 1);
  assert.equal(gate.multiChannelReady, false);
});

test('NEGATIVE: different registry IDs without stable account and endpoint identities are not independent domains', () => {
  const gate = evaluateMultiChannelPublishGate({
    operation: 'copy.generate',
    catalogModelId,
    deployments: [
      qualifiedDeployment({
        deploymentId: 'dep-direct-generated-id',
        catalogModelId,
        providerProfileId: 'provider-direct-generated-id',
        executionChannelId: 'channel-direct-generated-id',
        channelKind: 'official_direct',
        activationStatus: 'live_verified',
      }),
      qualifiedDeployment({
        deploymentId: 'dep-reseller-generated-id',
        catalogModelId,
        providerProfileId: 'provider-reseller-generated-id',
        executionChannelId: 'channel-reseller-generated-id',
        channelKind: 'upstream_reseller',
        activationStatus: 'live_verified',
      }),
    ],
  });

  assert.equal(gate.independentFaultDomainCount, 0);
  assert.equal(gate.multiChannelReady, false);
  assert.equal(gate.status, 'single_channel');
});

test('NEGATIVE: distinct endpoints on one stable account are still one fault domain', () => {
  const deployments = dualLiveDeployments();
  deployments[1] = {
    ...deployments[1]!,
    accountIdentity: deployments[0]!.accountIdentity,
  };
  const gate = evaluateMultiChannelPublishGate({
    operation: 'copy.generate',
    catalogModelId,
    deployments,
  });

  assert.equal(gate.independentFaultDomainCount, 1);
  assert.equal(gate.multiChannelReady, false);
});

test('NEGATIVE: distinct accounts on one stable endpoint are still one fault domain', () => {
  const deployments = dualLiveDeployments();
  deployments[1] = {
    ...deployments[1]!,
    endpointFingerprint: deployments[0]!.endpointFingerprint,
  };
  const gate = evaluateMultiChannelPublishGate({
    operation: 'copy.generate',
    catalogModelId,
    deployments,
  });

  assert.equal(gate.independentFaultDomainCount, 1);
  assert.equal(gate.multiChannelReady, false);
});

test('shared manufacturer dual channel is multi_channel_ready at channel level only', () => {
  const deployments = [
    qualifiedDeployment({
      deploymentId: 'dep-video-ark',
      catalogModelId: 'seedance-1-5-pro',
      providerProfileId: 'pp-volcengine-ark',
      executionChannelId: 'ec-ark',
      channelKind: 'official_direct',
      activationStatus: 'live_verified',
      manufacturer: 'bytedance',
      accountIdentity: 'ark',
      endpointFingerprint: 'ark-seedance',
    }),
    qualifiedDeployment({
      deploymentId: 'dep-video-tuzi',
      catalogModelId: 'seedance-1-5-pro',
      providerProfileId: 'pp-tuzi-upstream',
      executionChannelId: 'ec-tuzi',
      channelKind: 'upstream_reseller',
      activationStatus: 'live_verified',
      manufacturer: 'bytedance',
      accountIdentity: 'tuzi',
      endpointFingerprint: 'tuzi-seedance',
    }),
  ];
  const gate = evaluateMultiChannelPublishGate({
    operation: 'video.generate',
    catalogModelId: 'seedance-1-5-pro',
    deployments,
  });
  assert.equal(gate.multiChannelReady, true);
  assert.equal(gate.manufacturerIndependent, false);
  assert.equal(gate.faultDomainKind, 'shared_manufacturer_only');
  assert.match(gate.reason, /Channel-level|shared manufacturer/i);
});

test('recorded evidence can satisfy unit gate when requireLiveVerified=false', () => {
  const deployments = dualLiveDeployments().map((d) => ({
    ...d,
    activationStatus: 'recorded' as const,
  }));
  const liveOnly = evaluateMultiChannelPublishGate({
    operation: 'copy.generate',
    catalogModelId,
    deployments,
    requireLiveVerified: true,
  });
  assert.equal(liveOnly.multiChannelReady, false);

  const recordedOk = evaluateMultiChannelPublishGate({
    operation: 'copy.generate',
    catalogModelId,
    deployments,
    requireLiveVerified: false,
  });
  assert.equal(recordedOk.multiChannelReady, true);
});

test('secondary op with one live_verified is single-channel publishable, not multi', () => {
  const gate = evaluateMultiChannelPublishGate({
    operation: 'copy.adapt',
    catalogModelId,
    deployments: [
      qualifiedDeployment({
        deploymentId: 'dep-adapt',
        catalogModelId,
        providerProfileId: 'pp-volcengine-ark',
        executionChannelId: 'ec-ark',
        channelKind: 'official_direct',
        activationStatus: 'live_verified',
        manufacturer: 'volcengine',
      }),
    ],
  });
  assert.equal(gate.status, 'single_channel');
  assert.equal(gate.multiChannelReady, false);
  assert.equal(gate.publishAllowed, true);
  assert.equal(gate.channelLabel, CHANNEL_LABEL.singleChannelNoFallback);
  assert.throws(() =>
    assertMultiChannelReadyClaim({
      operation: 'copy.adapt',
      catalogModelId,
      deployments: gate.qualifiedDeployments,
      claim: 'multi_channel_ready',
    }),
  );
});

test('health-blocking deployment is excluded from qualified set', () => {
  const deployments = dualLiveDeployments();
  deployments[1] = { ...deployments[1]!, healthBlocking: true };
  const gate = evaluateMultiChannelPublishGate({
    operation: 'copy.generate',
    catalogModelId,
    deployments,
  });
  assert.equal(gate.qualifiedDeployments.length, 1);
  assert.equal(gate.multiChannelReady, false);
});
