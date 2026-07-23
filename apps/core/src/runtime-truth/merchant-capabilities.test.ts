import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertMerchantOnlyStates,
  projectMerchantCapabilities,
  projectMerchantCapability,
} from './merchant-capabilities.js';

test('live_verified and merchant_validated project to verified only', () => {
  assert.equal(
    projectMerchantCapability({
      id: 'generation_copy',
      evidence: ['implemented', 'live_verified'],
    }).state,
    'verified',
  );
  assert.equal(
    projectMerchantCapability({
      id: 'generation_image',
      evidence: ['merchant_validated'],
    }).state,
    'verified',
  );
  const single = projectMerchantCapability({
    id: 'generation_video',
    evidence: ['implemented', 'live_verified'],
    channelMode: 'single_channel',
  });
  assert.equal(single.state, 'verified');
  assert.equal(single.channelMode, 'single_channel');
  assert.equal(single.channelLabel, 'single-channel/no-fallback');
  assert.match(single.safeExplanation, /single-channel\/no-fallback/);
});

test('recorded_verified never becomes verified', () => {
  const capability = projectMerchantCapability({
    id: 'generation_video',
    evidence: ['implemented', 'recorded_verified'],
    purpose: '视频生成',
  });
  assert.equal(capability.state, 'assisted');
  assert.match(capability.safeExplanation, /辅助/);
  assert.doesNotMatch(capability.safeExplanation, /live_verified|recorded/);
});

test('implemented alone stays unavailable unless assisted path exists', () => {
  assert.equal(
    projectMerchantCapability({
      id: 'generation_audio',
      evidence: ['implemented'],
    }).state,
    'unavailable',
  );
  assert.equal(
    projectMerchantCapability({
      id: 'publish_l3',
      evidence: ['implemented'],
      assistedPathAvailable: true,
    }).state,
    'assisted',
  );
});

test('merchant snapshot never leaks internal evidence vocabulary', () => {
  const snapshot = projectMerchantCapabilities({
    records: [
      {
        id: 'generation_copy',
        evidence: ['implemented', 'recorded_verified', 'live_verified'],
      },
      {
        id: 'generation_image',
        evidence: ['implemented'],
      },
    ],
  });
  assert.equal(snapshot.evidencePolicy, 'merchant_three_state_only');
  assert.deepEqual(
    snapshot.capabilities.map((entry) => entry.state),
    ['verified', 'unavailable'],
  );
  assert.doesNotThrow(() => assertMerchantOnlyStates(snapshot));
  const payload = JSON.stringify(snapshot);
  for (const banned of [
    'implemented',
    'recorded_verified',
    'live_verified',
    'merchant_validated',
  ]) {
    assert.equal(payload.includes(banned), false, banned);
  }
});
