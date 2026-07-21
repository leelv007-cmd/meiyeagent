/**
 * Canonical handoff page four-section e2e-style unit tests (#101).
 * Proves legacy handoffPackages data source is retired.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertFourSectionParity,
  assertNotLegacyHandoffSource,
  canonicalHandoffFixture,
  projectCanonicalHandoffPage,
  resolveCanonicalHandoffByToken,
  type CanonicalDeliveryHandoff,
} from './delivery-handoff-canonical';
import type { AssistedReceipt } from './delivery-b3-types';

const NOW = '2026-07-20T12:00:00.000Z';

test('canonical handoff projects four sections: share/download/copy/report', () => {
  const source = canonicalHandoffFixture();
  const view = projectCanonicalHandoffPage(source, {
    nowIso: NOW,
    canShareFiles: true,
  });

  assert.equal(view.kind, 'ready');
  if (view.kind !== 'ready') return;

  const parity = assertFourSectionParity(view);
  assert.equal(parity.share, true);
  assert.equal(parity.download, true);
  assert.equal(parity.copy, true);
  assert.equal(parity.report, true);

  assert.equal(view.sections.share.id, 'share');
  assert.ok(view.sections.share.shareUrl.includes(source.token));

  assert.equal(view.sections.download.id, 'download');
  assert.ok(view.sections.download.media.length >= 1);
  assert.ok(view.sections.download.fullPackageHref);

  assert.equal(view.sections.copy.id, 'copy');
  const fieldIds = view.sections.copy.fields.map((f) => f.id);
  assert.ok(fieldIds.includes('title'));
  assert.ok(fieldIds.includes('body'));

  assert.equal(view.sections.report.id, 'report');
  assert.equal(view.sections.report.isPublished, false);
  assert.equal(view.sections.report.isHandedOver, true);
  assert.equal(view.sections.report.handedOverIsNotPublished, true);
  assert.equal(view.sections.report.awaitingReport, true);
  assert.notEqual(view.sections.report.statusLabel, '已发布');
});

test('resolve by token from canonical index only', () => {
  const a = canonicalHandoffFixture({ token: 'token-aaa' });
  const b = canonicalHandoffFixture({
    token: 'token-bbb',
    platform: 'douyin',
    title: '抖音成片',
  });
  const index = [a, b];

  const hit = resolveCanonicalHandoffByToken('token-bbb', index, {
    nowIso: NOW,
  });
  assert.equal(hit.kind, 'ready');
  if (hit.kind === 'ready') {
    assert.equal(hit.platform, 'douyin');
    assert.equal(hit.sections.copy.fields[0]?.value, '抖音成片');
  }

  const miss = resolveCanonicalHandoffByToken('missing', index, {
    nowIso: NOW,
  });
  assert.equal(miss.kind, 'not_found');
});

test('expired token returns expired, not ready', () => {
  const source = canonicalHandoffFixture({
    expiresAt: '2026-07-19T00:00:00.000Z',
  });
  const view = projectCanonicalHandoffPage(source, { nowIso: NOW });
  assert.equal(view.kind, 'expired');
});

test('legacy handoffPackages source is refused', () => {
  const legacy = {
    id: 'legacy-1',
    route: 'L3_HANDOFF_PACKAGE',
    token: 'legacy-token',
    title: '旧包',
  };
  assert.throws(
    () => assertNotLegacyHandoffSource(legacy),
    /LEGACY_HANDOFF_SOURCE_RETIRED/
  );

  // Canonical source passes.
  assert.doesNotThrow(() =>
    assertNotLegacyHandoffSource(canonicalHandoffFixture())
  );
});

test('report section: published only when assisted receipt is published', () => {
  const publishedReceipt: AssistedReceipt = {
    id: 'ar-pub',
    packageId: 'pkg-handoff-1',
    workspaceId: 'ws-1',
    status: 'publish_result_recorded',
    binding: {
      accountId: 'acct-1',
      approvalReceiptId: 'approval-1',
      contentPackageRevision: 4,
      costRange: { currency: 'CNY', maxAmount: 0, minAmount: 0 },
      packageId: 'pkg-handoff-1',
      platform: 'xiaohongshu',
      purpose: 'public_content',
      responsibilityRole: 'self_publish',
      scheduledAt: '2026-07-20T12:00:00.000Z',
      variantVersionId: 'v1',
      workspaceId: 'ws-1',
    },
    publishResult: {
      recordedAt: '2026-07-20T13:00:00.000Z',
      source: 'manual_record',
      status: 'published',
      platformUrl: 'https://xhs.example/p/1',
    },
    events: [
      {
        actorId: 'u1',
        occurredAt: '2026-07-20T09:00:00.000Z',
        type: 'materials_prepared',
      },
      {
        actorId: 'u1',
        occurredAt: '2026-07-20T09:05:00.000Z',
        type: 'handed_over',
      },
      {
        actorId: 'u1',
        occurredAt: '2026-07-20T13:00:00.000Z',
        type: 'publish_result_recorded',
        result: {
          recordedAt: '2026-07-20T13:00:00.000Z',
          source: 'manual_record',
          status: 'published',
        },
      },
    ],
  };

  const source: CanonicalDeliveryHandoff = canonicalHandoffFixture({
    assistedReceipt: publishedReceipt,
  });
  const view = projectCanonicalHandoffPage(source, { nowIso: NOW });
  assert.equal(view.kind, 'ready');
  if (view.kind !== 'ready') return;

  assert.equal(view.sections.report.isPublished, true);
  assert.equal(view.sections.report.statusLabel, '已发布');
  assert.equal(view.sections.report.awaitingReport, false);
  assert.equal(view.sections.report.handedOverIsNotPublished, false);
});

test('handed_over status never surfaces as 已发布 in report section', () => {
  const view = projectCanonicalHandoffPage(canonicalHandoffFixture(), {
    nowIso: NOW,
  });
  assert.equal(view.kind, 'ready');
  if (view.kind !== 'ready') return;
  assert.equal(view.sections.report.statusLabel, '已交接');
  assert.equal(view.sections.report.isPublished, false);
  assert.equal(view.sections.report.handedOverIsNotPublished, true);
});
