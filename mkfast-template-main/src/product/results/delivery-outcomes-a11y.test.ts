/**
 * Four outcome a11y / focus distinction tests (#101 acceptance).
 * 下载完成 / 分享完成 / 已交接 / 已发布
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DELIVERY_OUTCOME_ANNOUNCEMENT,
  DELIVERY_OUTCOMES,
  allDeliveryOutcomeProjections,
  assertDistinctOutcomeAnnouncements,
  outcomeFromDeliveryEvent,
  projectDeliveryOutcome,
} from './delivery-outcomes-a11y';

test('four outcomes have distinct announcements', () => {
  assert.equal(DELIVERY_OUTCOMES.length, 4);
  assert.equal(DELIVERY_OUTCOME_ANNOUNCEMENT.download_done, '下载已开始');
  assert.equal(DELIVERY_OUTCOME_ANNOUNCEMENT.share_done, '已交给系统分享');
  assert.equal(DELIVERY_OUTCOME_ANNOUNCEMENT.handed_over, '已交接');
  assert.equal(DELIVERY_OUTCOME_ANNOUNCEMENT.published, '已发布');

  assert.equal(assertDistinctOutcomeAnnouncements(), true);
});

test('four outcomes have distinct focus ids and test ids', () => {
  const projections = allDeliveryOutcomeProjections();
  assert.equal(projections.length, 4);

  const focusIds = new Set(projections.map((p) => p.focusId));
  const testIds = new Set(projections.map((p) => p.testId));
  const announcements = new Set(projections.map((p) => p.announcement));

  assert.equal(focusIds.size, 4);
  assert.equal(testIds.size, 4);
  assert.equal(announcements.size, 4);

  for (const p of projections) {
    assert.equal(p.ariaLive, 'polite');
    assert.equal(p.role, 'status');
    assert.ok(p.focusId.startsWith('delivery-outcome-'));
    assert.ok(p.testId.startsWith('delivery-outcome-'));
  }
});

test('only published outcome claims platformPublished', () => {
  for (const outcome of DELIVERY_OUTCOMES) {
    const projection = projectDeliveryOutcome(outcome);
    if (outcome === 'published') {
      assert.equal(projection.platformPublished, true);
      assert.equal(projection.announcement, '已发布');
    } else {
      assert.equal(projection.platformPublished, false);
      assert.notEqual(projection.announcement, '已发布');
    }
  }
});

test('share cancel produces no outcome (no delivered mark path)', () => {
  assert.equal(outcomeFromDeliveryEvent('share_cancelled'), null);
  assert.equal(outcomeFromDeliveryEvent('download_started'), 'download_done');
  assert.equal(outcomeFromDeliveryEvent('shared'), 'share_done');
  assert.equal(outcomeFromDeliveryEvent('handed_over'), 'handed_over');
  assert.equal(outcomeFromDeliveryEvent('published'), 'published');
});

test('announcements never collapse to a vague 完成', () => {
  for (const outcome of DELIVERY_OUTCOMES) {
    const text = projectDeliveryOutcome(outcome).announcement;
    assert.notEqual(text, '完成');
    assert.notEqual(text, '已完成');
    assert.ok(text.length > 0);
  }
});
