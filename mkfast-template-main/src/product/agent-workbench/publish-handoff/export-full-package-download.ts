/**
 * V31-17: bind handoff ZIP download to the existing result-delivery export path.
 *
 * Same channel as result-center full_package:
 *   commandP1('result-delivery', { action: 'result_export', ... })
 *   → downloadUrl on /api/core/p1/assets?objectKey=...
 *   → browser download with &download=1
 *
 * Does not introduce a second export chain (ContentPackageZipExportAdapter stays
 * behind operations.exportContentPackage via result_export).
 */

import type { commandP1 } from '@/p1/client';

export type ResultExportPlatform = 'xiaohongshu' | 'douyin' | 'video_account';

export type ExportFullPackageTransport = (
  module: Parameters<typeof commandP1>[0],
  call: Parameters<typeof commandP1>[1],
  idempotencyKey?: string,
) => Promise<unknown>;

export type ExportFullPackageResult = {
  downloadUrl: string;
  receiptId?: string;
};

/**
 * Map handoff platform onto result_export enum. wechat_moments is segment-only
 * in result-center (no ZIP) — returns null so callers fail closed.
 */
export function resolveZipExportPlatform(
  platform: string,
): ResultExportPlatform | null {
  if (
    platform === 'xiaohongshu' ||
    platform === 'douyin' ||
    platform === 'video_account'
  ) {
    return platform;
  }
  return null;
}

/** Mirror result-center: always force download disposition on the asset URL. */
export function withAssetDownloadParam(downloadUrl: string): string {
  if (/[?&]download=/u.test(downloadUrl)) return downloadUrl;
  return downloadUrl.includes('?')
    ? `${downloadUrl}&download=1`
    : `${downloadUrl}?download=1`;
}

/**
 * Trigger the same <a download> pattern as use-result-center-view startDownload.
 */
export function startBrowserDownload(url: string, fileName?: string): void {
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName ?? '';
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
}

/**
 * Call result_export and start the browser download of the ZIP artifact.
 */
export async function exportAndDownloadFullPackage(input: {
  packageId: string;
  expectedRevision: number;
  platform: string;
  fileName?: string;
  transport: ExportFullPackageTransport;
  startDownload?: (url: string, fileName?: string) => void;
}): Promise<ExportFullPackageResult> {
  const platform = resolveZipExportPlatform(input.platform);
  if (!platform) {
    throw new Error(
      'Full package ZIP export is only available for xiaohongshu / douyin / video_account.',
    );
  }
  const result = (await input.transport(
    'result-delivery',
    {
      action: 'result_export',
      payload: {
        expectedRevision: input.expectedRevision,
        packageId: input.packageId,
        platform,
      },
    },
    `export:${input.packageId}:${input.expectedRevision}:${platform}`,
  )) as ExportFullPackageResult;

  if (!result?.downloadUrl || typeof result.downloadUrl !== 'string') {
    throw new Error('The export completed without a downloadable URL.');
  }

  const downloadUrl = withAssetDownloadParam(result.downloadUrl);
  const start = input.startDownload ?? startBrowserDownload;
  start(downloadUrl, input.fileName);
  return { ...result, downloadUrl };
}
