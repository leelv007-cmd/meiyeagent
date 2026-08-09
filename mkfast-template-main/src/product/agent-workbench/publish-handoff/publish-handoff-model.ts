/**
 * V31-17 Publish Handoff pure projection (agent-workbench).
 * Reuses contract helpers; no I/O.
 */

import {
  buildPublishHandoffCopyBlocks,
  buildVideoHandoffSafetyChecklist,
  decidePublishFromHandoff,
  projectPublishCapabilityPresentation,
  type MobilePublishHandoff,
  type OutcomeSelfReportChipSignal,
  type PublishCapabilityMode,
  type PublishFromHandoffIntent,
  type PublishHandoffCopyBlock,
  type PublishHandoffView,
  type SelfReportAskDecision,
  type SelfReportAskEvent,
  type VideoHandoffSafetyChecklist,
} from '@meiye/contracts';

export type PublishHandoffPanelFacts = {
  contentPackageId: string;
  contentPackageRevision: number;
  platform: string;
  title?: string;
  body?: string;
  topics?: readonly string[];
  cta?: string;
  orderedAssetCount?: number;
  zipFileName?: string;
  capabilityMode: PublishCapabilityMode;
  mobileHandoff?: MobilePublishHandoff;
  workId?: string;
  isVideo?: boolean;
  hasSubtitles?: boolean;
};

export type PublishHandoffPanelView = {
  contentPackageId: string;
  contentPackageRevision: number;
  publicationBindingRevision: number;
  platform: string;
  copyBlocks: PublishHandoffCopyBlock[];
  orderedImagePaths: string[];
  zipFileName?: string;
  capability: ReturnType<typeof projectPublishCapabilityPresentation>;
  mobileHandoff?: MobilePublishHandoff;
  videoSafety?: VideoHandoffSafetyChecklist;
  /** Never show a direct-publish CTA when capability forbids it. */
  showDirectPublishCta: boolean;
  workId?: string;
  testId: 'publish-handoff-panel';
};

export const SELF_REPORT_CHIP_LABEL: Record<
  OutcomeSelfReportChipSignal,
  string
> = {
  inquiry: '有人问',
  wechat: '加微信',
  booking: '预约了',
  purchase: '买券',
  visit: '到店',
  no_activity: '没动静',
};

export function projectPublishHandoffPanel(
  facts: PublishHandoffPanelFacts
): PublishHandoffPanelView {
  const capability = projectPublishCapabilityPresentation(facts.capabilityMode);
  const copyBlocks = buildPublishHandoffCopyBlocks({
    title: facts.title,
    body: facts.body,
    topics: facts.topics,
    cta: facts.cta,
  });
  const count = Math.max(0, facts.orderedAssetCount ?? 0);
  const orderedImagePaths = Array.from({ length: count }, (_, index) => {
    const n = String(index + 1).padStart(2, '0');
    return `images/${n}.jpg`;
  });
  return {
    contentPackageId: facts.contentPackageId,
    contentPackageRevision: facts.contentPackageRevision,
    publicationBindingRevision: facts.contentPackageRevision,
    platform: facts.platform,
    copyBlocks,
    orderedImagePaths,
    ...(facts.zipFileName ? { zipFileName: facts.zipFileName } : {}),
    capability,
    ...(facts.mobileHandoff ? { mobileHandoff: facts.mobileHandoff } : {}),
    ...(facts.isVideo
      ? {
          videoSafety: buildVideoHandoffSafetyChecklist({
            platform: facts.platform,
            hasSubtitles: Boolean(facts.hasSubtitles),
          }),
        }
      : {}),
    showDirectPublishCta: capability.showDirectPublish,
    ...(facts.workId ? { workId: facts.workId } : {}),
    testId: 'publish-handoff-panel',
  };
}

/** Convert contract view → panel view (after prepare_mobile_publish_handoff). */
export function panelViewFromPublishHandoff(
  view: PublishHandoffView
): PublishHandoffPanelView {
  return {
    contentPackageId: view.contentPackageRef.id,
    contentPackageRevision:
      typeof view.contentPackageRef.revision === 'number'
        ? view.contentPackageRef.revision
        : Number(view.contentPackageRef.revision) || 0,
    publicationBindingRevision:
      typeof view.publicationBindingRevision === 'number'
        ? view.publicationBindingRevision
        : Number(view.publicationBindingRevision) || 0,
    platform: view.platform,
    copyBlocks: view.copyBlocks,
    orderedImagePaths: view.orderedImagePaths,
    ...(view.zipFileName ? { zipFileName: view.zipFileName } : {}),
    capability: view.capability,
    ...(view.mobileHandoff ? { mobileHandoff: view.mobileHandoff } : {}),
    ...(view.videoSafety ? { videoSafety: view.videoSafety } : {}),
    showDirectPublishCta: view.capability.showDirectPublish,
    ...(view.workId ? { workId: view.workId } : {}),
    testId: 'publish-handoff-panel',
  };
}

export function evaluateDrivenPublishFromQr(intent: PublishFromHandoffIntent) {
  return decidePublishFromHandoff(intent);
}
