/**
 * System share degrade matrix (D-096 / #101).
 *
 * Capability order: file → one-shot link → download.
 * Cancel does NOT mark delivered. System accept ≠ platform published.
 */

export type SharePayload = {
  /** File descriptors for canShare probing (not real File objects in pure model). */
  files?: readonly { name: string; mimeType: string; sizeBytes: number }[];
  /** One-shot handoff URL (72h TTL from B3). */
  oneShotLinkUrl?: string;
  /** Download fallback href / object key. */
  downloadHref?: string;
};

export type ShareDeviceCapability = {
  /** navigator.share exists. */
  hasNavigatorShare: boolean;
  /**
   * navigator.canShare({ files }) for current payload.
   * Must be tested against actual files — not only API presence (D-086).
   */
  canShareFiles: boolean;
  /** canShare for text/url only. */
  canShareText: boolean;
};

export type ShareStrategy = 'file' | 'one_shot_link' | 'download';

export type ShareDegradePlan = {
  /** Chosen primary strategy. */
  strategy: ShareStrategy;
  /** Ordered fallbacks if primary fails or is unavailable. */
  fallbacks: ShareStrategy[];
};

/**
 * Resolve share strategy by capability degrade matrix.
 * Prefer files when canShare; else one-shot link; else download.
 * Default: do not send files AND link together (D-096).
 */
export function resolveShareDegrade(
  payload: SharePayload,
  device: ShareDeviceCapability
): ShareDegradePlan {
  const hasFiles = Boolean(payload.files && payload.files.length > 0);
  const hasLink = Boolean(payload.oneShotLinkUrl);
  const hasDownload = Boolean(payload.downloadHref);

  const canFile = device.hasNavigatorShare && device.canShareFiles && hasFiles;
  const canLinkShare =
    device.hasNavigatorShare &&
    device.canShareText &&
    hasLink &&
    // Prefer link when files cannot be shared.
    !canFile;
  const strategy: ShareStrategy = canFile
    ? 'file'
    : hasLink && (canLinkShare || !device.hasNavigatorShare)
      ? 'one_shot_link'
      : 'download';

  const fallbacks: ShareStrategy[] = [];
  for (const candidate of ['file', 'one_shot_link', 'download'] as const) {
    if (candidate === strategy) continue;
    if (candidate === 'file' && !canFile) continue;
    if (candidate === 'one_shot_link' && !hasLink) continue;
    if (candidate === 'download' && !hasDownload && !hasFiles) continue;
    fallbacks.push(candidate);
  }

  return { strategy, fallbacks };
}

// ---------------------------------------------------------------------------
// Share attempt outcomes — cancel must NOT mark delivered
// ---------------------------------------------------------------------------

export type ShareAttemptResult =
  | { kind: 'shared' }
  | { kind: 'cancelled' }
  | { kind: 'failed'; reason: string }
  | { kind: 'unsupported' };

export type ShareDeliveryRecord = {
  /** Only true when user completed system share sheet (not cancel). */
  markDelivered: boolean;
  /** Event for ledger if any. */
  event: 'shared' | 'share_cancelled' | 'share_failed' | 'share_unsupported';
  /** User-facing message. */
  message: string;
  /** Whether platform publish is implied — always false. */
  platformPublished: false;
  /** Preserve panel position / focus after failure or cancel. */
  preservePanelState: boolean;
};

/**
 * Map a share attempt result to delivery bookkeeping.
 * Cancel / abort → markDelivered false (D-096 hard rule).
 * Shared → markDelivered true for "已交给系统分享" only — not 已发布.
 */
export function recordShareAttempt(
  result: ShareAttemptResult
): ShareDeliveryRecord {
  switch (result.kind) {
    case 'shared':
      return {
        markDelivered: true,
        event: 'shared',
        message: '已交给系统分享',
        platformPublished: false,
        preservePanelState: false,
      };
    case 'cancelled':
      return {
        markDelivered: false,
        event: 'share_cancelled',
        message: '分享已取消，可重试或改用下载',
        platformPublished: false,
        preservePanelState: true,
      };
    case 'failed':
      return {
        markDelivered: false,
        event: 'share_failed',
        message: '系统分享失败，请复制交接链接或下载',
        platformPublished: false,
        preservePanelState: true,
      };
    case 'unsupported':
      return {
        markDelivered: false,
        event: 'share_unsupported',
        message: '当前设备不支持系统分享，请复制交接链接或下载',
        platformPublished: false,
        preservePanelState: true,
      };
  }
}
