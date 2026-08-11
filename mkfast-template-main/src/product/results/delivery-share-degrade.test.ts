/**
 * Share degrade matrix + cancel does not mark delivered (#101 acceptance).
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  recordShareAttempt,
  resolveShareDegrade,
  type ShareDeviceCapability,
  type SharePayload,
  type ShareStrategy,
} from './delivery-share-degrade';

const files = [
  { name: 'cover.jpg', mimeType: 'image/jpeg', sizeBytes: 1200 },
] as const;
const fullPayload: SharePayload = {
  files,
  oneShotLinkUrl: 'https://app.example/dashboard/handoff/tok123',
  downloadHref: '/api/export/pkg-1.zip',
};
const shareDegradeCases: Array<{
  label: string;
  payload: SharePayload;
  device: ShareDeviceCapability;
  expectStrategy: ShareStrategy;
}> = [
  {
    label: 'can share files → file',
    payload: fullPayload,
    device: {
      hasNavigatorShare: true,
      canShareFiles: true,
      canShareText: true,
    },
    expectStrategy: 'file',
  },
  {
    label: 'share API but files rejected → one_shot_link',
    payload: fullPayload,
    device: {
      hasNavigatorShare: true,
      canShareFiles: false,
      canShareText: true,
    },
    expectStrategy: 'one_shot_link',
  },
  {
    label: 'no share API → one_shot_link then download fallback',
    payload: fullPayload,
    device: {
      hasNavigatorShare: false,
      canShareFiles: false,
      canShareText: false,
    },
    expectStrategy: 'one_shot_link',
  },
  {
    label: 'no share, no link → download',
    payload: { files, downloadHref: '/api/export/pkg-1.zip' },
    device: {
      hasNavigatorShare: false,
      canShareFiles: false,
      canShareText: false,
    },
    expectStrategy: 'download',
  },
  {
    label: 'link-only payload → one_shot_link',
    payload: {
      oneShotLinkUrl: 'https://app.example/dashboard/handoff/tok999',
    },
    device: {
      hasNavigatorShare: true,
      canShareFiles: false,
      canShareText: true,
    },
    expectStrategy: 'one_shot_link',
  },
];

test('share degrade matrix: file → one_shot_link → download', () => {
  const rows = shareDegradeCases;
  assert.ok(rows.length >= 4);

  for (const row of rows) {
    const plan = resolveShareDegrade(row.payload, row.device);
    assert.equal(
      plan.strategy,
      row.expectStrategy,
      `strategy for ${row.label}`
    );
    // Cancel never marks delivered for every matrix row.
    const cancel = recordShareAttempt({ kind: 'cancelled' });
    assert.equal(cancel.markDelivered, false, `cancel for ${row.label}`);
    assert.equal(cancel.platformPublished, false);
    assert.equal(cancel.preservePanelState, true);
  }
});

test('file strategy preferred when canShareFiles', () => {
  const plan = resolveShareDegrade(
    {
      files: [{ name: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }],
      oneShotLinkUrl: 'https://app.example/handoff/t',
      downloadHref: '/dl.zip',
    },
    {
      hasNavigatorShare: true,
      canShareFiles: true,
      canShareText: true,
    }
  );
  assert.equal(plan.strategy, 'file');
  assert.ok(plan.fallbacks.includes('one_shot_link'));
  assert.ok(plan.fallbacks.includes('download'));
});

test('degrade to one_shot_link when files cannot be shared', () => {
  const plan = resolveShareDegrade(
    {
      files: [{ name: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }],
      oneShotLinkUrl: 'https://app.example/handoff/t',
      downloadHref: '/dl.zip',
    },
    {
      hasNavigatorShare: true,
      canShareFiles: false,
      canShareText: true,
    }
  );
  assert.equal(plan.strategy, 'one_shot_link');
});

test('degrade to download when no share API and no link', () => {
  const payload: SharePayload = {
    files: [{ name: 'a.jpg', mimeType: 'image/jpeg', sizeBytes: 10 }],
    downloadHref: '/dl.zip',
  };
  const plan = resolveShareDegrade(payload, {
    hasNavigatorShare: false,
    canShareFiles: false,
    canShareText: false,
  });
  assert.equal(plan.strategy, 'download');
  assert.deepEqual(plan.fallbacks, []);
});

test('cancel does NOT mark delivered; shared marks local share only', () => {
  const cancelled = recordShareAttempt({ kind: 'cancelled' });
  assert.equal(cancelled.markDelivered, false);
  assert.equal(cancelled.event, 'share_cancelled');
  assert.equal(cancelled.platformPublished, false);
  assert.equal(cancelled.preservePanelState, true);
  assert.match(cancelled.message, /取消/u);

  const shared = recordShareAttempt({ kind: 'shared' });
  assert.equal(shared.markDelivered, true);
  assert.equal(shared.event, 'shared');
  assert.equal(shared.platformPublished, false);
  assert.equal(shared.message, '已交给系统分享');

  const failed = recordShareAttempt({
    kind: 'failed',
    reason: 'network',
  });
  assert.equal(failed.markDelivered, false);
  assert.equal(failed.preservePanelState, true);

  const unsupported = recordShareAttempt({ kind: 'unsupported' });
  assert.equal(unsupported.markDelivered, false);
});

test('share success is never projected as platform published', () => {
  const shared = recordShareAttempt({ kind: 'shared' });
  assert.equal(shared.platformPublished, false);
  assert.notEqual(shared.message, '已发布');
});
