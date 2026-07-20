/**
 * Delivery panel view model (WT-D / #101).
 *
 * Composes capability groups, full package, share degrade, assisted UI,
 * and a11y outcomes into one Result Center panel projection.
 */

import {
  launchAutomaticVerifiedCount,
  projectDeliveryCapabilityGroups,
  visibleDeliveryGroups,
  type DeliveryCapabilityFacts,
  type DeliveryGroupProjection,
} from './delivery-capability-groups';
import {
  projectAssistedHandoffUi,
  type AssistedHandoffUiProjection,
} from './delivery-assisted-model';
import {
  projectDeliveryOutcome,
  type DeliveryOutcome,
  type DeliveryOutcomeProjection,
} from './delivery-outcomes-a11y';
import {
  resolveShareDegrade,
  type ShareDegradePlan,
  type ShareDeviceCapability,
  type SharePayload,
} from './delivery-share-degrade';
import type {
  AssistedReceipt,
  DeliveryPanelTarget,
} from './delivery-b3-types';
import type { FullPackagePlan } from './delivery-full-package';

export type DeliveryPanelFacts = {
  target: DeliveryPanelTarget;
  hasCopyableText: boolean;
  hasSingleDownload: boolean;
  hasFullPackage: boolean;
  hasExternalSendApproval: boolean;
  shareDevice: ShareDeviceCapability;
  sharePayload: SharePayload;
  /** Override launch freeze only in tests that simulate a live-gated platform. */
  automaticVerifiedPlatformCount?: number;
  assistedReceipt?: AssistedReceipt;
  fullPackagePlan?: FullPackagePlan;
  /** Active outcome to announce (after user action). */
  activeOutcome?: DeliveryOutcome;
  nowIso: string;
  /** Mobile full-height capability surface. */
  viewport: 'desktop' | 'mobile';
};

export type DeliveryPanelView = {
  groups: DeliveryGroupProjection[];
  visibleGroups: DeliveryGroupProjection[];
  /** True when 直接发布 is hidden (launch default). */
  directPublishHidden: boolean;
  sharePlan: ShareDegradePlan;
  assisted: AssistedHandoffUiProjection | null;
  fullPackage: FullPackagePlan | null;
  outcome: DeliveryOutcomeProjection | null;
  /** Mobile uses full-height capability surface. */
  surface: {
    viewport: 'desktop' | 'mobile';
    fullHeight: boolean;
    testId: 'delivery-panel';
    mobileTestId: 'delivery-panel-mobile-fullheight';
  };
  /** a11y: live region id for outcomes. */
  liveRegionId: 'delivery-panel-live';
};

/**
 * Project the full delivery panel from canonical facts.
 * Pure — no I/O.
 */
export function projectDeliveryPanel(
  facts: DeliveryPanelFacts,
): DeliveryPanelView {
  const autoCount =
    facts.automaticVerifiedPlatformCount ?? launchAutomaticVerifiedCount();

  const capabilityFacts: DeliveryCapabilityFacts = {
    target: facts.target,
    hasCopyableText: facts.hasCopyableText,
    hasSingleDownload: facts.hasSingleDownload,
    hasFullPackage: facts.hasFullPackage,
    hasExternalSendApproval: facts.hasExternalSendApproval,
    hasNavigatorShare: facts.shareDevice.hasNavigatorShare,
    canShareFiles: facts.shareDevice.canShareFiles,
    hasOneShotLink: Boolean(facts.sharePayload.oneShotLinkUrl),
    automaticVerifiedPlatformCount: autoCount,
  };

  const groups = projectDeliveryCapabilityGroups(capabilityFacts);
  const visible = visibleDeliveryGroups(capabilityFacts);
  const sharePlan = resolveShareDegrade(
    facts.sharePayload,
    facts.shareDevice,
  );
  const assisted = facts.assistedReceipt
    ? projectAssistedHandoffUi(facts.assistedReceipt, facts.nowIso)
    : null;
  const outcome = facts.activeOutcome
    ? projectDeliveryOutcome(facts.activeOutcome)
    : null;

  const fullHeight = facts.viewport === 'mobile';

  return {
    groups,
    visibleGroups: visible,
    directPublishHidden: !groups.find((g) => g.id === 'direct_publish')
      ?.visible,
    sharePlan,
    assisted,
    fullPackage: facts.fullPackagePlan ?? null,
    outcome,
    surface: {
      viewport: facts.viewport,
      fullHeight,
      testId: 'delivery-panel',
      mobileTestId: 'delivery-panel-mobile-fullheight',
    },
    liveRegionId: 'delivery-panel-live',
  };
}

/** Launch defaults for capability facts (automatic_verified = 0). */
export function launchDeliveryCapabilityDefaults(
  target: DeliveryPanelTarget,
): Pick<
  DeliveryCapabilityFacts,
  | 'target'
  | 'hasCopyableText'
  | 'hasSingleDownload'
  | 'hasFullPackage'
  | 'hasExternalSendApproval'
  | 'hasNavigatorShare'
  | 'canShareFiles'
  | 'hasOneShotLink'
  | 'automaticVerifiedPlatformCount'
> {
  return {
    target,
    hasCopyableText: true,
    hasSingleDownload: true,
    hasFullPackage: true,
    hasExternalSendApproval: true,
    hasNavigatorShare: true,
    canShareFiles: true,
    hasOneShotLink: true,
    automaticVerifiedPlatformCount: launchAutomaticVerifiedCount(),
  };
}
