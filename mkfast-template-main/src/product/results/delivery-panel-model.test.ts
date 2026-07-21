/**
 * Delivery panel composition + mobile full-height surface (#101).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import { handedOverReceiptFixture } from './delivery-assisted-model';
import { xiaohongshuPackageFixture } from './delivery-full-package';
import {
  launchDeliveryCapabilityDefaults,
  projectDeliveryPanel,
  type DeliveryPanelFacts,
} from './delivery-panel-model';

function basePanelFacts(
  overrides: Partial<DeliveryPanelFacts> = {}
): DeliveryPanelFacts {
  return {
    target: 'xiaohongshu',
    hasCopyableText: true,
    hasSingleDownload: true,
    hasFullPackage: true,
    hasExternalSendApproval: true,
    shareDevice: {
      hasNavigatorShare: true,
      canShareFiles: true,
      canShareText: true,
    },
    sharePayload: {
      kind: 'files',
      title: '包',
      files: [{ name: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }],
      oneShotLinkUrl: 'https://app.example/handoff/t',
      downloadHref: '/dl.zip',
    },
    fullPackagePlan: xiaohongshuPackageFixture(),
    assistedReceipt: handedOverReceiptFixture(),
    nowIso: '2026-07-20T12:00:00.000Z',
    viewport: 'desktop',
    ...overrides,
  };
}

test('panel hides direct_publish at launch and surfaces floor groups', () => {
  const view = projectDeliveryPanel(basePanelFacts());
  assert.equal(view.directPublishHidden, true);
  assert.equal(view.visibleGroups.length, 2);
  assert.ok(view.visibleGroups.some((g) => g.id === 'get_files'));
  assert.ok(view.visibleGroups.some((g) => g.id === 'handoff_to_platform'));
  assert.ok(view.fullPackage);
  assert.ok(view.assisted);
  assert.equal(view.assisted?.handedOverIsNotPublished, true);
  assert.equal(view.sharePlan.strategy, 'file');
});

test('mobile viewport uses full-height capability surface', () => {
  const view = projectDeliveryPanel(basePanelFacts({ viewport: 'mobile' }));
  assert.equal(view.surface.viewport, 'mobile');
  assert.equal(view.surface.fullHeight, true);
  assert.equal(view.surface.testId, 'delivery-panel');
  assert.equal(view.surface.mobileTestId, 'delivery-panel-mobile-fullheight');
});

test('desktop viewport is not full-height', () => {
  const view = projectDeliveryPanel(basePanelFacts({ viewport: 'desktop' }));
  assert.equal(view.surface.fullHeight, false);
});

test('active outcome projects distinct a11y announcement', () => {
  const view = projectDeliveryPanel(
    basePanelFacts({ activeOutcome: 'handed_over' })
  );
  assert.ok(view.outcome);
  assert.equal(view.outcome!.announcement, '已交接');
  assert.equal(view.outcome!.platformPublished, false);
  assert.equal(view.outcome!.testId, 'delivery-outcome-handed-over');
});

test('launchDeliveryCapabilityDefaults freezes automatic_verified at 0', () => {
  const defaults = launchDeliveryCapabilityDefaults('douyin');
  assert.equal(defaults.automaticVerifiedPlatformCount, 0);
  assert.equal(defaults.target, 'douyin');
});
