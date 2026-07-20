import assert from 'node:assert/strict';
import test from 'node:test';

import {
  loadCanonicalHandoff,
  reportCanonicalHandoff,
  shareCanonicalHandoff,
  type CanonicalHandoffServerRecord,
} from './delivery-handoff-live';
import { handedOverReceiptFixture } from './delivery-assisted-model';

function serverRecord(): CanonicalHandoffServerRecord {
  const receipt = handedOverReceiptFixture({
    handoffLink: {
      token: 'canonical-live-token-1234',
      createdAt: '2026-07-20T09:00:00.000Z',
      expiresAt: '2026-07-23T09:00:00.000Z',
    },
  });
  return {
    assistedReceipt: receipt,
    body: '到店立减',
    checklist: ['核对价格'],
    contentPackageRevision: 4,
    conversionText: '私信预约',
    expiresAt: receipt.handoffLink!.expiresAt,
    exportReceiptId: 'export-1',
    fullPackageDownloadUrl: '/api/core/p1/assets?objectKey=package.zip&download=1',
    media: [
      {
        contentType: 'image/jpeg',
        downloadUrl: '/api/core/p1/assets?objectKey=cover.jpg&download=1',
        id: 'cover-1',
        kind: 'image',
        label: '封面',
      },
    ],
    packageId: 'pkg-1',
    platform: 'xiaohongshu',
    sharePath: '/dashboard/handoff/canonical-live-token-1234',
    title: '夏日美甲',
    token: 'canonical-live-token-1234',
    topics: ['美甲'],
    variantVersionId: 'variant-v1',
  };
}

test('handoff token loads the canonical server index and keeps durable receipt revision', async () => {
  const calls: unknown[] = [];
  const loaded = await loadCanonicalHandoff(
    'canonical-live-token-1234',
    async (action, payload) => {
      calls.push({ action, payload });
      return {
        handoff: serverRecord(),
        kind: 'ok' as const,
        receipt: serverRecord().assistedReceipt,
        revision: 2,
      };
    },
    { nowIso: '2026-07-20T10:00:00.000Z', origin: 'https://app.example' },
  );

  assert.deepEqual(calls, [
    {
      action: 'assisted_consume_handoff',
      payload: {
        now: '2026-07-20T10:00:00.000Z',
        token: 'canonical-live-token-1234',
      },
    },
  ]);
  assert.equal(loaded.resolve.kind, 'ready');
  assert.equal(loaded.receiptRevision, 2);
  if (loaded.resolve.kind === 'ready') {
    assert.equal(
      loaded.resolve.sections.share.shareUrl,
      'https://app.example/dashboard/handoff/canonical-live-token-1234',
    );
  }
});

test('handoff report is persisted through assisted_record_publish_result', async () => {
  const calls: unknown[] = [];
  await reportCanonicalHandoff(
    {
      outcome: 'published',
      platformUrl: 'https://xhs.example/p/1',
      receiptId: 'receipt-1',
      receiptRevision: 3,
      recordedAt: '2026-07-20T11:00:00.000Z',
    },
    async (action, payload) => {
      calls.push({ action, payload });
      return { revision: 4 };
    },
  );

  assert.equal((calls[0] as { action: string }).action, 'assisted_record_publish_result');
  assert.deepEqual(
    (calls[0] as { payload: { result: unknown } }).payload.result,
    {
      platformUrl: 'https://xhs.example/p/1',
      recordedAt: '2026-07-20T11:00:00.000Z',
      source: 'manual_record',
      status: 'published',
    },
  );
});

test('system share degrades from real files to one-shot link and then download', async () => {
  const source = serverRecord();
  const sharedPayloads: Array<{ files?: File[]; url?: string }> = [];
  const downloaded: string[] = [];

  const fileResult = await shareCanonicalHandoff(source, {
    canShare: (payload) => Boolean(payload.files?.length),
    fetchFile: async () => new File(['image'], 'cover.jpg', { type: 'image/jpeg' }),
    share: async (payload) => {
      sharedPayloads.push(payload);
    },
    download: (href) => downloaded.push(href),
    origin: 'https://app.example',
  });
  assert.equal(fileResult, 'shared');
  assert.equal(sharedPayloads[0]?.files?.length, 1);
  assert.equal(sharedPayloads[0]?.url, undefined);

  const linkResult = await shareCanonicalHandoff(source, {
    canShare: () => false,
    fetchFile: async () => new File(['image'], 'cover.jpg', { type: 'image/jpeg' }),
    share: async (payload) => {
      sharedPayloads.push(payload);
    },
    download: (href) => downloaded.push(href),
    origin: 'https://app.example',
  });
  assert.equal(linkResult, 'shared');
  assert.equal(
    sharedPayloads.at(-1)?.url,
    'https://app.example/dashboard/handoff/canonical-live-token-1234',
  );

  const downloadResult = await shareCanonicalHandoff(
    { ...source, sharePath: '' },
    {
      canShare: () => false,
      fetchFile: async () => {
        throw new Error('unavailable');
      },
      share: undefined,
      download: (href) => downloaded.push(href),
      origin: 'https://app.example',
    },
  );
  assert.equal(downloadResult, 'downloaded');
  assert.equal(downloaded.at(-1), source.fullPackageDownloadUrl);
});
