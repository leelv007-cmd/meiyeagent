/**
 * Capability-aware delivery panel groups (D-086 / #101).
 *
 * Three groups: 拿到文件 / 交接到平台 / 直接发布.
 * Launch freezes automatic_verified = 0 → "直接发布" group is hidden.
 */

import type { DeliveryPanelTarget } from './delivery-b3-types';

export const DELIVERY_GROUP_IDS = [
  'get_files',
  'handoff_to_platform',
  'direct_publish',
] as const;

export type DeliveryGroupId = (typeof DELIVERY_GROUP_IDS)[number];

export const DELIVERY_ACTION_IDS = [
  'copy',
  'single_download',
  'full_package',
  'system_share',
  'assisted',
  'automatic_verified',
] as const;

export type DeliveryActionId = (typeof DELIVERY_ACTION_IDS)[number];

export type DeliveryActionProjection = {
  id: DeliveryActionId;
  enabled: boolean;
  /** Product label (Chinese). */
  label: string;
  /** Why disabled / alternative path hint. */
  reason?: string;
  group: DeliveryGroupId;
};

export type DeliveryGroupProjection = {
  id: DeliveryGroupId;
  /** Group heading. */
  label: string;
  /** Hidden groups are not rendered (e.g. direct_publish at launch). */
  visible: boolean;
  actions: DeliveryActionProjection[];
};

export type DeliveryCapabilityFacts = {
  /** Target carrier for this panel instance. */
  target: DeliveryPanelTarget;
  /** Copyable text exists (title/body/topics). */
  hasCopyableText: boolean;
  /** At least one single media/text asset can be downloaded. */
  hasSingleDownload: boolean;
  /**
   * Canonical/adopted revision can generate a full package
   * (manifest/v1 ZIP or moments segments).
   */
  hasFullPackage: boolean;
  /** External send already has ApprovalReceipt (required for share/assisted). */
  hasExternalSendApproval: boolean;
  /** Device/browser Web Share API present. */
  hasNavigatorShare: boolean;
  /** Whether current payload files pass canShare. */
  canShareFiles: boolean;
  /** One-shot handoff link available as share fallback. */
  hasOneShotLink: boolean;
  /**
   * Count of platforms that currently pass automatic_verified live gate.
   * Launch freezes this at 0 (D-086 / D-098 C2).
   */
  automaticVerifiedPlatformCount: number;
  /** Assisted handoff is available for this target (always preferred over auto). */
  assistedAvailable?: boolean;
};

export const DELIVERY_GROUP_LABEL: Record<DeliveryGroupId, string> = {
  get_files: '拿到文件',
  handoff_to_platform: '交接到平台',
  direct_publish: '直接发布',
};

export const DELIVERY_ACTION_LABEL: Record<DeliveryActionId, string> = {
  copy: '复制',
  single_download: '单项下载',
  full_package: '完整发布包',
  system_share: '系统分享',
  assisted: '辅助交接',
  automatic_verified: '直接发布',
};

/**
 * Floor capabilities that must remain available whenever materials exist.
 * copy / single download / full package are the launch baseline.
 */
export function floorCapabilitiesEnabled(
  facts: Pick<
    DeliveryCapabilityFacts,
    'hasCopyableText' | 'hasSingleDownload' | 'hasFullPackage'
  >,
): {
  copy: boolean;
  single_download: boolean;
  full_package: boolean;
} {
  return {
    copy: facts.hasCopyableText,
    single_download: facts.hasSingleDownload,
    full_package: facts.hasFullPackage,
  };
}

/**
 * Project the three capability groups for the delivery panel.
 * Pure — no I/O. automatic_verified group is hidden when count is 0.
 */
export function projectDeliveryCapabilityGroups(
  facts: DeliveryCapabilityFacts,
): DeliveryGroupProjection[] {
  const floor = floorCapabilitiesEnabled(facts);
  const assistedOk =
    facts.assistedAvailable !== false && facts.hasExternalSendApproval;
  const shareOk =
    facts.hasExternalSendApproval &&
    (facts.hasNavigatorShare || facts.hasOneShotLink || facts.hasFullPackage);

  const getFiles: DeliveryGroupProjection = {
    id: 'get_files',
    label: DELIVERY_GROUP_LABEL.get_files,
    visible: true,
    actions: [
      {
        id: 'copy',
        enabled: floor.copy,
        label: DELIVERY_ACTION_LABEL.copy,
        group: 'get_files',
        ...(floor.copy
          ? {}
          : { reason: '当前没有可复制的文案，请使用下载' }),
      },
      {
        id: 'single_download',
        enabled: floor.single_download,
        label: DELIVERY_ACTION_LABEL.single_download,
        group: 'get_files',
        ...(floor.single_download
          ? {}
          : { reason: '没有可单独导出的文件，请使用完整发布包' }),
      },
      {
        id: 'full_package',
        enabled: floor.full_package,
        label: fullPackageLabel(facts.target),
        group: 'get_files',
        ...(floor.full_package
          ? {}
          : { reason: '当前版本尚不能生成完整发布包' }),
      },
    ],
  };

  const handoff: DeliveryGroupProjection = {
    id: 'handoff_to_platform',
    label: DELIVERY_GROUP_LABEL.handoff_to_platform,
    visible: true,
    actions: [
      {
        id: 'system_share',
        enabled: shareOk,
        label: DELIVERY_ACTION_LABEL.system_share,
        group: 'handoff_to_platform',
        ...(shareOk
          ? {}
          : {
              reason: facts.hasExternalSendApproval
                ? '当前设备无法分享，请复制交接链接或下载'
                : '外部发送前需完成一次性批准',
            }),
      },
      {
        id: 'assisted',
        enabled: assistedOk,
        label: DELIVERY_ACTION_LABEL.assisted,
        group: 'handoff_to_platform',
        ...(assistedOk
          ? {}
          : {
              reason: facts.hasExternalSendApproval
                ? '辅助交接暂不可用'
                : '外部发送前需完成一次性批准',
            }),
      },
    ],
  };

  // Launch: automatic_verified = 0 → hide entire "直接发布" group.
  const autoCount = facts.automaticVerifiedPlatformCount;
  const directPublish: DeliveryGroupProjection = {
    id: 'direct_publish',
    label: DELIVERY_GROUP_LABEL.direct_publish,
    visible: autoCount > 0,
    actions:
      autoCount > 0
        ? [
            {
              id: 'automatic_verified',
              enabled: true,
              label: DELIVERY_ACTION_LABEL.automatic_verified,
              group: 'direct_publish',
            },
          ]
        : [],
  };

  return [getFiles, handoff, directPublish];
}

function fullPackageLabel(target: DeliveryPanelTarget): string {
  switch (target) {
    case 'xiaohongshu':
      return '完整发布包（小红书）';
    case 'douyin':
      return '完整发布包（抖音）';
    case 'video_account':
      return '完整发布包（视频号）';
    case 'wechat_moments':
      return '朋友圈分段包';
  }
}

/** Visible groups only — what the panel renders. */
export function visibleDeliveryGroups(
  facts: DeliveryCapabilityFacts,
): DeliveryGroupProjection[] {
  return projectDeliveryCapabilityGroups(facts).filter((g) => g.visible);
}

/**
 * Launch baseline: automatic_verified platform count is frozen at 0.
 * Direct publish group must not appear for any launch target.
 */
export function launchAutomaticVerifiedCount(): number {
  return 0;
}
