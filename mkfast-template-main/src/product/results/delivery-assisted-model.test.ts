/**
 * Assisted handoff UI: dual roles, binding, 24h pending, 已交接≠已发布.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assistedResponsibilityRoleOptions,
  handedOverReceiptFixture,
  materialsReadyReceiptFixture,
  projectAssistedHandoffUi,
  projectPendingConfirm,
} from './delivery-assisted-model';
import type { AssistedReceipt } from './delivery-b3-types';

test('dual responsibility roles are self_publish and external_owner', () => {
  const options = assistedResponsibilityRoleOptions();
  assert.equal(options.length, 2);
  assert.deepEqual(
    options.map((o) => o.role).sort(),
    ['external_owner', 'self_publish'],
  );
  assert.equal(
    options.find((o) => o.role === 'self_publish')?.requires,
    'accountId',
  );
  assert.equal(
    options.find((o) => o.role === 'external_owner')?.requires,
    'ownerId',
  );
});

test('materials_ready is not handed over and not published', () => {
  const ui = projectAssistedHandoffUi(
    materialsReadyReceiptFixture(),
    '2026-07-20T10:00:00.000Z',
  );
  assert.equal(ui.statusLabel, '资料已准备');
  assert.equal(ui.isHandedOver, false);
  assert.equal(ui.isPublished, false);
  assert.equal(ui.handedOverIsNotPublished, true);
  assert.equal(ui.primaryCta.id, 'hand_over');
});

test('已交接 ≠ 已发布 after hand over', () => {
  const ui = projectAssistedHandoffUi(
    handedOverReceiptFixture(),
    '2026-07-20T10:00:00.000Z',
  );
  assert.equal(ui.statusLabel, '已交接');
  assert.equal(ui.isHandedOver, true);
  assert.equal(ui.isPublished, false);
  assert.equal(ui.handedOverIsNotPublished, true);
  assert.equal(ui.bindingComplete, true);
  assert.equal(ui.responsibilityRole, 'self_publish');
  assert.ok(ui.oneShotLinkToken);
});

test('24h pending confirm appears after threshold', () => {
  const receipt = handedOverReceiptFixture();
  // handed_over at 2026-07-20T09:05:00Z
  const before = projectPendingConfirm(receipt, '2026-07-20T20:00:00.000Z');
  assert.equal(before, null);

  const after = projectPendingConfirm(receipt, '2026-07-21T10:00:00.000Z');
  assert.ok(after);
  assert.equal(after!.visible, true);
  assert.equal(after!.reason, 'awaiting_confirm_24h');
  assert.match(after!.message, /24 小时/u);

  const ui = projectAssistedHandoffUi(receipt, '2026-07-21T10:00:00.000Z');
  assert.ok(ui.pendingConfirm?.visible);
});

test('published only after publish_result_recorded with published status', () => {
  const receipt: AssistedReceipt = {
    ...handedOverReceiptFixture(),
    status: 'publish_result_recorded',
    publishResult: {
      recordedAt: '2026-07-21T12:00:00.000Z',
      source: 'manual_record',
      status: 'published',
    },
    events: [
      ...handedOverReceiptFixture().events,
      {
        actorId: 'owner-1',
        occurredAt: '2026-07-21T12:00:00.000Z',
        type: 'publish_result_recorded',
        result: {
          recordedAt: '2026-07-21T12:00:00.000Z',
          source: 'manual_record',
          status: 'published',
        },
      },
    ],
  };

  const ui = projectAssistedHandoffUi(receipt, '2026-07-21T13:00:00.000Z');
  assert.equal(ui.isPublished, true);
  assert.equal(ui.statusLabel, '已记录发布结果');
  assert.equal(ui.publishResultLabel, '已发布');
  assert.equal(ui.handedOverIsNotPublished, false);
  assert.equal(ui.pendingConfirm, null);
});

test('receipt binding fields required for hand_over CTA', () => {
  const withoutBinding = projectAssistedHandoffUi(
    materialsReadyReceiptFixture(),
    '2026-07-20T10:00:00.000Z',
  );
  assert.equal(withoutBinding.bindingComplete, false);
  assert.equal(withoutBinding.primaryCta.enabled, false);

  const withBinding = projectAssistedHandoffUi(
    materialsReadyReceiptFixture({
      binding: handedOverReceiptFixture().binding,
    }),
    '2026-07-20T10:00:00.000Z',
  );
  assert.equal(withBinding.bindingComplete, true);
  assert.equal(withBinding.primaryCta.enabled, true);
});
