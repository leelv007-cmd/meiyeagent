/**
 * V31-17: handoff ZIP uses result_export channel (not a second export path).
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  exportAndDownloadFullPackage,
  resolveZipExportPlatform,
  withAssetDownloadParam,
} from './export-full-package-download';

test('resolveZipExportPlatform accepts ZIP platforms only', () => {
  assert.equal(resolveZipExportPlatform('xiaohongshu'), 'xiaohongshu');
  assert.equal(resolveZipExportPlatform('douyin'), 'douyin');
  assert.equal(resolveZipExportPlatform('video_account'), 'video_account');
  assert.equal(resolveZipExportPlatform('wechat_moments'), null);
});

test('withAssetDownloadParam mirrors result-center download=1', () => {
  assert.equal(
    withAssetDownloadParam('/api/core/p1/assets?objectKey=a%2Fb.zip'),
    '/api/core/p1/assets?objectKey=a%2Fb.zip&download=1',
  );
  assert.equal(
    withAssetDownloadParam('/api/core/p1/assets?objectKey=x&download=1'),
    '/api/core/p1/assets?objectKey=x&download=1',
  );
});

test('exportAndDownloadFullPackage calls result_export then starts download', async () => {
  const calls: Array<{
    module: string;
    action: string;
    payload: Record<string, unknown>;
    key?: string;
  }> = [];
  const downloads: Array<{ url: string; fileName?: string }> = [];

  const result = await exportAndDownloadFullPackage({
    packageId: 'pkg-1',
    expectedRevision: 4,
    platform: 'xiaohongshu',
    fileName: 'store-note-xhs-r4.zip',
    transport: async (module, call, key) => {
      calls.push({
        module,
        action: call.action,
        payload: (call.payload ?? {}) as Record<string, unknown>,
        key,
      });
      return {
        downloadUrl: '/api/core/p1/assets?objectKey=ws%2Fexports%2Fa.zip',
        receiptId: 'receipt-1',
      };
    },
    startDownload: (url, fileName) => {
      downloads.push({ url, fileName });
    },
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.module, 'result-delivery');
  assert.equal(calls[0]?.action, 'result_export');
  assert.deepEqual(calls[0]?.payload, {
    expectedRevision: 4,
    packageId: 'pkg-1',
    platform: 'xiaohongshu',
  });
  assert.equal(
    calls[0]?.key,
    'export:pkg-1:4:xiaohongshu',
  );
  assert.equal(downloads.length, 1);
  assert.equal(
    downloads[0]?.url,
    '/api/core/p1/assets?objectKey=ws%2Fexports%2Fa.zip&download=1',
  );
  assert.equal(downloads[0]?.fileName, 'store-note-xhs-r4.zip');
  assert.equal(result.receiptId, 'receipt-1');
});

test('exportAndDownloadFullPackage rejects non-ZIP platforms', async () => {
  await assert.rejects(
    exportAndDownloadFullPackage({
      packageId: 'pkg-1',
      expectedRevision: 1,
      platform: 'wechat_moments',
      transport: async () => ({ downloadUrl: '/x' }),
    }),
    /xiaohongshu|douyin|video_account/iu,
  );
});
