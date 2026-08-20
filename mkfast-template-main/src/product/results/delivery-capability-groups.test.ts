/**
 * Capability-aware three groups + launch automatic_verified=0 (#101).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  floorCapabilitiesEnabled,
  launchAutomaticVerifiedCount,
  projectDeliveryCapabilityGroups,
  visibleDeliveryGroups,
  type DeliveryCapabilityFacts,
} from './delivery-capability-groups';

function baseFacts(
  overrides: Partial<DeliveryCapabilityFacts> = {}
): DeliveryCapabilityFacts {
  return {
    target: 'xiaohongshu',
    hasCopyableText: true,
    hasSingleDownload: true,
    hasFullPackage: true,
    hasExternalSendApproval: true,
    hasNavigatorShare: true,
    canShareFiles: true,
    hasOneShotLink: true,
    automaticVerifiedPlatformCount: launchAutomaticVerifiedCount(),
    ...overrides,
  };
}

test('launch automatic_verified count is 0', () => {
  assert.equal(launchAutomaticVerifiedCount(), 0);
});

test('three groups projected; direct_publish hidden at launch', () => {
  const groups = projectDeliveryCapabilityGroups(baseFacts());
  assert.equal(groups.length, 3);

  const getFiles = groups.find((g) => g.id === 'get_files');
  const handoff = groups.find((g) => g.id === 'handoff_to_platform');
  const direct = groups.find((g) => g.id === 'direct_publish');

  assert.ok(getFiles?.visible);
  assert.equal(getFiles?.label, '拿到文件');
  assert.ok(handoff?.visible);
  assert.equal(handoff?.label, '交接到平台');
  assert.equal(direct?.visible, false);
  assert.equal(direct?.label, '直接发布');

  const visible = visibleDeliveryGroups(baseFacts());
  assert.equal(visible.length, 2);
  assert.ok(!visible.some((g) => g.id === 'direct_publish'));
});

test('floor capabilities: copy / single download / full package', () => {
  const floor = floorCapabilitiesEnabled({
    hasCopyableText: true,
    hasSingleDownload: true,
    hasFullPackage: true,
  });
  assert.deepEqual(floor, {
    copy: true,
    single_download: true,
    full_package: true,
  });

  const groups = projectDeliveryCapabilityGroups(baseFacts());
  const actions = groups.find((g) => g.id === 'get_files')!.actions;
  assert.equal(actions.find((a) => a.id === 'copy')?.enabled, true);
  assert.equal(actions.find((a) => a.id === 'single_download')?.enabled, true);
  assert.equal(actions.find((a) => a.id === 'full_package')?.enabled, true);
});

test('full package label varies by target modality', () => {
  const xhs = projectDeliveryCapabilityGroups(
    baseFacts({ target: 'xiaohongshu' })
  );
  assert.match(
    xhs
      .find((g) => g.id === 'get_files')!
      .actions.find((a) => a.id === 'full_package')!.label,
    /小红书/u
  );

  const dy = projectDeliveryCapabilityGroups(baseFacts({ target: 'douyin' }));
  assert.match(
    dy
      .find((g) => g.id === 'get_files')!
      .actions.find((a) => a.id === 'full_package')!.label,
    /抖音/u
  );

  const moments = projectDeliveryCapabilityGroups(
    baseFacts({ target: 'wechat_moments' })
  );
  assert.match(
    moments
      .find((g) => g.id === 'get_files')!
      .actions.find((a) => a.id === 'full_package')!.label,
    /朋友圈分段/u
  );
});

test('direct_publish stays hidden even when automaticVerifiedPlatformCount > 0', () => {
  const groups = projectDeliveryCapabilityGroups(
    baseFacts({ automaticVerifiedPlatformCount: 1 })
  );
  const direct = groups.find((g) => g.id === 'direct_publish');
  assert.equal(direct?.visible, false);
  assert.deepEqual(direct?.actions, []);
  assert.ok(
    !visibleDeliveryGroups(
      baseFacts({ automaticVerifiedPlatformCount: 1 })
    ).some((g) => g.id === 'direct_publish')
  );
});

test('share and assisted require external send approval', () => {
  const groups = projectDeliveryCapabilityGroups(
    baseFacts({ hasExternalSendApproval: false })
  );
  const handoff = groups.find((g) => g.id === 'handoff_to_platform')!;
  assert.equal(
    handoff.actions.find((a) => a.id === 'system_share')?.enabled,
    false
  );
  assert.equal(
    handoff.actions.find((a) => a.id === 'assisted')?.enabled,
    false
  );
  // Floor get_files still available without approval.
  const files = groups.find((g) => g.id === 'get_files')!;
  assert.equal(files.actions.find((a) => a.id === 'copy')?.enabled, true);
  assert.equal(
    files.actions.find((a) => a.id === 'full_package')?.enabled,
    true
  );
});
