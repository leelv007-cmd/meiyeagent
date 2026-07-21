/**
 * System share degrade matrix (D-096 / #101).
 *
 * Capability order: file → one-shot link → download.
 * Cancel does NOT mark delivered. System accept ≠ platform published.
 */

export type SharePayloadKind = 'text' | 'files' | 'mixed';

export type SharePayload = {
  kind: SharePayloadKind;
  title?: string;
  text?: string;
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
  /** Payload fields to pass to navigator.share when strategy is file/text. */
  shareFields: {
    title?: string;
    text?: string;
    url?: string;
    includeFiles: boolean;
  };
  /** Alternative actions shown after failure / cancel. */
  alternativeActions: Array<'copy_link' | 'download'>;
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
  const hasText = Boolean(payload.text || payload.title);

  const canFile = device.hasNavigatorShare && device.canShareFiles && hasFiles;
  const canLinkShare =
    device.hasNavigatorShare &&
    device.canShareText &&
    hasLink &&
    // Prefer link when files cannot be shared.
    !canFile;
  const canTextOnly =
    device.hasNavigatorShare &&
    device.canShareText &&
    hasText &&
    !canFile &&
    !hasLink;

  let strategy: ShareStrategy;
  if (canFile) {
    strategy = 'file';
  } else if (hasLink && (canLinkShare || !device.hasNavigatorShare)) {
    // Even without navigator.share, one-shot link is the intermediate degrade
    // before pure download (copy-link UI path).
    strategy = 'one_shot_link';
  } else if (canTextOnly) {
    // Pure text still goes through share API when available; treat as file-less
    // share — degrade target remains one_shot_link if present, else download.
    strategy = hasLink
      ? 'one_shot_link'
      : hasDownload
        ? 'download'
        : 'download';
  } else {
    strategy = hasDownload || hasFiles ? 'download' : 'download';
  }

  // When text-only share is available and no files/link, use share with text
  // via one_shot_link slot empty → still surface download if available.
  if (
    strategy === 'download' &&
    device.hasNavigatorShare &&
    device.canShareText &&
    hasText &&
    !hasFiles
  ) {
    // Text share without files: model as one_shot_link only if URL present;
    // otherwise keep download but allow shareFields for text.
  }

  const fallbacks: ShareStrategy[] = [];
  for (const candidate of ['file', 'one_shot_link', 'download'] as const) {
    if (candidate === strategy) continue;
    if (candidate === 'file' && !canFile) continue;
    if (candidate === 'one_shot_link' && !hasLink) continue;
    if (candidate === 'download' && !hasDownload && !hasFiles) continue;
    fallbacks.push(candidate);
  }

  const includeFiles = strategy === 'file';
  const shareFields = {
    ...(payload.title ? { title: payload.title } : {}),
    ...(payload.text && !includeFiles ? { text: payload.text } : {}),
    // Never attach both files and link (D-096).
    ...(strategy === 'one_shot_link' && payload.oneShotLinkUrl
      ? { url: payload.oneShotLinkUrl }
      : {}),
    // Text-only share path when no files.
    ...(strategy === 'file' ? {} : {}),
    includeFiles,
  };

  // For pure text with share API and no link, put text into shareFields.
  if (
    !includeFiles &&
    !shareFields.url &&
    device.hasNavigatorShare &&
    hasText
  ) {
    if (payload.text) shareFields.text = payload.text;
    if (payload.title) shareFields.title = payload.title;
  }

  const alternativeActions: Array<'copy_link' | 'download'> = [];
  if (hasLink) alternativeActions.push('copy_link');
  if (hasDownload || hasFiles) alternativeActions.push('download');

  return {
    strategy,
    fallbacks,
    shareFields,
    alternativeActions,
  };
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

/**
 * Pure matrix of degrade decisions for fixture tests.
 * Rows: device capability scenarios × payload kinds.
 */
export function shareDegradeMatrixFixture(): Array<{
  label: string;
  payload: SharePayload;
  device: ShareDeviceCapability;
  expectStrategy: ShareStrategy;
  expectMarkDeliveredOnCancel: false;
}> {
  const baseFiles = [
    { name: 'cover.jpg', mimeType: 'image/jpeg', sizeBytes: 1200 },
  ] as const;
  const basePayload: SharePayload = {
    kind: 'files',
    title: '发布包',
    text: '夏日美甲',
    files: [...baseFiles],
    oneShotLinkUrl: 'https://app.example/dashboard/handoff/tok123',
    downloadHref: '/api/export/pkg-1.zip',
  };

  return [
    {
      label: 'can share files → file',
      payload: basePayload,
      device: {
        hasNavigatorShare: true,
        canShareFiles: true,
        canShareText: true,
      },
      expectStrategy: 'file',
      expectMarkDeliveredOnCancel: false,
    },
    {
      label: 'share API but files rejected → one_shot_link',
      payload: basePayload,
      device: {
        hasNavigatorShare: true,
        canShareFiles: false,
        canShareText: true,
      },
      expectStrategy: 'one_shot_link',
      expectMarkDeliveredOnCancel: false,
    },
    {
      label: 'no share API → one_shot_link then download fallback',
      payload: basePayload,
      device: {
        hasNavigatorShare: false,
        canShareFiles: false,
        canShareText: false,
      },
      expectStrategy: 'one_shot_link',
      expectMarkDeliveredOnCancel: false,
    },
    {
      label: 'no share, no link → download',
      payload: {
        kind: 'files',
        files: [...baseFiles],
        downloadHref: '/api/export/pkg-1.zip',
      },
      device: {
        hasNavigatorShare: false,
        canShareFiles: false,
        canShareText: false,
      },
      expectStrategy: 'download',
      expectMarkDeliveredOnCancel: false,
    },
    {
      label: 'text only with share → one_shot_link if present',
      payload: {
        kind: 'text',
        title: '文案',
        text: '到店立减',
        oneShotLinkUrl: 'https://app.example/dashboard/handoff/tok999',
      },
      device: {
        hasNavigatorShare: true,
        canShareFiles: false,
        canShareText: true,
      },
      expectStrategy: 'one_shot_link',
      expectMarkDeliveredOnCancel: false,
    },
  ];
}
