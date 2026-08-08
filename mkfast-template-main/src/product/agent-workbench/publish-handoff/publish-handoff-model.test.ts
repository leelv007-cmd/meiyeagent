/**
 * V31-17 publish handoff pure model tests.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  evaluateDrivenPublishFromQr,
  projectPublishHandoffPanel,
  projectSelfReportJourney,
} from './publish-handoff-model';

test('assisted/unavailable hide direct publish CTA', () => {
  for (const mode of ['assisted', 'unavailable'] as const) {
    const view = projectPublishHandoffPanel({
      contentPackageId: 'pkg-1',
      contentPackageRevision: 3,
      platform: 'xiaohongshu',
      title: 'T',
      body: 'B',
      topics: ['美甲'],
      cta: '预约',
      orderedAssetCount: 2,
      capabilityMode: mode,
    });
    assert.equal(view.showDirectPublishCta, false);
    assert.equal(view.publicationBindingRevision, 3);
    assert.deepEqual(
      view.copyBlocks.map((b) => b.role),
      ['title', 'body', 'topics', 'cta'],
    );
    assert.deepEqual(view.orderedImagePaths, ['images/01.jpg', 'images/02.jpg']);
  }
});

test('automatic_verified may show direct publish', () => {
  const view = projectPublishHandoffPanel({
    contentPackageId: 'pkg-1',
    contentPackageRevision: 1,
    platform: 'douyin',
    capabilityMode: 'automatic_verified',
  });
  assert.equal(view.showDirectPublishCta, true);
});

test('A19 driven publish from QR is rejected', () => {
  const reject = evaluateDrivenPublishFromQr('system_driven_publish');
  assert.equal(reject.ok, false);
  if (!reject.ok) {
    assert.equal(reject.authority, 'A19');
  }
  const allow = evaluateDrivenPublishFromQr('merchant_self_publish');
  assert.equal(allow.ok, true);
});

test('self-report journey next-day ask with chips', () => {
  const decision = projectSelfReportJourney({
    workId: 'work-1',
    contentPackageId: 'pkg-1',
    contentPackageRevision: 2,
    publishHandoffCompletedAt: '2026-08-07T10:00:00.000Z',
    now: '2026-08-08T09:00:00.000Z',
    workAskHistory: [],
    storeConsecutiveIgnores: 0,
  });
  assert.equal(decision.kind, 'ask');
  if (decision.kind === 'ask') {
    assert.ok(decision.chips.includes('no_activity'));
    assert.match(decision.prompt, /有人来问/);
  }
});
