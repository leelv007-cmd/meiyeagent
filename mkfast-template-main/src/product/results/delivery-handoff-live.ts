import {
  projectCanonicalHandoffPage,
  type CanonicalDeliveryHandoff,
  type CanonicalHandoffResolveResult,
} from './delivery-handoff-canonical';
import type {
  AssistedReceipt,
  DeliveryPanelTarget,
} from './delivery-b3-types';

export type CanonicalHandoffServerRecord = {
  assistedReceipt: AssistedReceipt;
  body: string;
  checklist: string[];
  contentPackageRevision: number;
  conversionText: string;
  expiresAt: string;
  exportReceiptId: string;
  fullPackageDownloadUrl?: string;
  media: Array<{
    contentType: string;
    downloadUrl: string;
    id: string;
    kind: 'image' | 'video' | 'file';
    label: string;
  }>;
  packageId: string;
  platform: Exclude<DeliveryPanelTarget, 'wechat_moments'>;
  sharePath: string;
  title: string;
  token: string;
  topics: string[];
  variantVersionId: string;
};

export type CanonicalHandoffServerResult =
  | {
      handoff: CanonicalHandoffServerRecord;
      kind: 'ok' | 'replay';
      receipt: AssistedReceipt;
      revision: number;
    }
  | { kind: 'expired' | 'not_found' };

type Submit = (
  action: string,
  payload: Record<string, unknown>,
) => Promise<unknown>;

function extensionFor(contentType: string) {
  if (contentType === 'image/jpeg') return 'jpg';
  if (contentType === 'image/png') return 'png';
  if (contentType === 'image/webp') return 'webp';
  if (contentType === 'video/mp4') return 'mp4';
  return 'bin';
}

export function canonicalHandoffFromServer(
  source: CanonicalHandoffServerRecord,
  origin: string,
): CanonicalDeliveryHandoff {
  return {
    token: source.token,
    expiresAt: source.expiresAt,
    packageId: source.packageId,
    contentPackageRevision: source.contentPackageRevision,
    variantVersionId: source.variantVersionId,
    platform: source.platform,
    title: source.title,
    body: source.body,
    topics: [...source.topics],
    conversionText: source.conversionText,
    checklist: [...source.checklist],
    media: source.media.map((media) => ({
      downloadName: `${media.id}.${extensionFor(media.contentType)}`,
      href: media.downloadUrl,
      id: media.id,
      kind: media.kind,
      label: media.label,
      mimeType: media.contentType,
    })),
    shareUrl: new URL(source.sharePath, origin).toString(),
    ...(source.fullPackageDownloadUrl
      ? { fullPackageDownloadHref: source.fullPackageDownloadUrl }
      : {}),
    fullPackageFileName: `${source.packageId}-${source.platform}-r${source.contentPackageRevision}.zip`,
    assistedReceipt: source.assistedReceipt,
  };
}

export async function loadCanonicalHandoff(
  token: string,
  submit: Submit,
  options: { nowIso: string; origin: string; canShareFiles?: boolean },
): Promise<{
  resolve: CanonicalHandoffResolveResult;
  receiptRevision?: number;
  serverRecord?: CanonicalHandoffServerRecord;
}> {
  const result = (await submit('assisted_consume_handoff', {
    now: options.nowIso,
    token,
  })) as CanonicalHandoffServerResult;
  if (!('handoff' in result)) {
    return result.kind === 'not_found'
      ? { resolve: { kind: 'not_found' } }
      : { resolve: { kind: 'expired', token } };
  }
  const source = canonicalHandoffFromServer(result.handoff, options.origin);
  return {
    receiptRevision: result.revision,
    resolve: projectCanonicalHandoffPage(source, {
      nowIso: options.nowIso,
      canShareFiles: options.canShareFiles,
    }),
    serverRecord: result.handoff,
  };
}

export async function reportCanonicalHandoff(
  input: {
    note?: string;
    outcome: 'published' | 'not_published' | 'failed';
    platformUrl?: string;
    receiptId: string;
    receiptRevision: number;
    recordedAt: string;
  },
  submit: Submit,
) {
  return (await submit('assisted_record_publish_result', {
    expectedRevision: input.receiptRevision,
    receiptId: input.receiptId,
    result: {
      ...(input.note ? { note: input.note } : {}),
      ...(input.platformUrl ? { platformUrl: input.platformUrl } : {}),
      recordedAt: input.recordedAt,
      source: 'manual_record',
      status: input.outcome,
    },
  })) as { revision: number };
}

export type CanonicalShareResult =
  | 'shared'
  | 'cancelled'
  | 'downloaded'
  | 'failed'
  | 'unsupported';

type CanonicalShareSource = Pick<
  CanonicalHandoffServerRecord,
  'fullPackageDownloadUrl' | 'media' | 'sharePath' | 'title'
>;

export async function shareCanonicalHandoff(
  source: CanonicalShareSource,
  boundary: {
    canShare(payload: { files?: File[]; title?: string; url?: string }): boolean;
    download(href: string): void;
    fetchFile(media: CanonicalHandoffServerRecord['media'][number]): Promise<File>;
    origin: string;
    share?: (payload: {
      files?: File[];
      title?: string;
      url?: string;
    }) => Promise<void>;
  },
): Promise<CanonicalShareResult> {
  if (boundary.share && source.media.length > 0) {
    try {
      const files = await Promise.all(source.media.map(boundary.fetchFile));
      const payload = { files, title: source.title };
      if (boundary.canShare(payload)) {
        await boundary.share(payload);
        return 'shared';
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled';
      }
    }
  }

  if (boundary.share && source.sharePath) {
    try {
      await boundary.share({
        title: source.title,
        url: new URL(source.sharePath, boundary.origin).toString(),
      });
      return 'shared';
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        return 'cancelled';
      }
    }
  }

  if (source.fullPackageDownloadUrl) {
    boundary.download(source.fullPackageDownloadUrl);
    return 'downloaded';
  }
  return boundary.share ? 'failed' : 'unsupported';
}
