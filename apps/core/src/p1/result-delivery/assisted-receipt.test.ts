import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ASSISTED_RECEIPT_STATUS_LABEL,
  assertBindingFieldsComplete,
  consumeOneShotHandoffLink,
  createOneShotHandoffLink,
  handOverAssistedReceipt,
  isAssistedHandedOver,
  isAssistedPublished,
  markPendingManualPublish,
  ONE_SHOT_HANDOFF_LINK_TTL_MS,
  PENDING_CONFIRM_AFTER_MS,
  prepareAssistedMaterials,
  projectPendingConfirmInbox,
  recordAssistedPublishResult,
  type AssistedReceiptBinding,
  AssistedReceiptError,
} from './assisted-receipt.js';

const binding: AssistedReceiptBinding = {
  accountId: 'acct-xhs-1',
  approvalReceiptId: 'approval-receipt-1',
  contentPackageRevision: 5,
  costRange: {
    currency: 'CNY',
    maxAmount: 20,
    minAmount: 0,
  },
  packageId: 'pkg-1',
  platform: 'xiaohongshu',
  purpose: 'public_content',
  responsibilityRole: 'self_publish',
  scheduledAt: '2026-07-20T10:00:00.000Z',
  variantVersionId: 'variant-v1',
  workspaceId: 'ws-1',
};

test('prepare materials starts at 资料已准备 and is not published', () => {
  const receipt = prepareAssistedMaterials({
    actorId: 'owner-1',
    exportReceiptId: 'export-1',
    occurredAt: '2026-07-20T09:00:00.000Z',
    packageId: 'pkg-1',
    workspaceId: 'ws-1',
  });

  assert.equal(receipt.status, 'materials_ready');
  assert.equal(
    ASSISTED_RECEIPT_STATUS_LABEL[receipt.status],
    '资料已准备',
  );
  assert.equal(isAssistedPublished(receipt), false);
  assert.equal(isAssistedHandedOver(receipt), false);
});

test('hand over binds exact platform/account/revision/purpose/time/cost/approval', () => {
  const prepared = prepareAssistedMaterials({
    actorId: 'owner-1',
    occurredAt: '2026-07-20T09:00:00.000Z',
    packageId: 'pkg-1',
    workspaceId: 'ws-1',
  });

  const handed = handOverAssistedReceipt(prepared, {
    actorId: 'owner-1',
    binding,
    linkToken: 'a'.repeat(32),
    occurredAt: '2026-07-20T09:05:00.000Z',
  });

  assert.equal(handed.status, 'handed_over');
  assert.equal(ASSISTED_RECEIPT_STATUS_LABEL[handed.status], '已交接');
  assert.equal(isAssistedHandedOver(handed), true);
  assert.equal(isAssistedPublished(handed), false);
  assert.ok(handed.binding);
  assertBindingFieldsComplete(handed.binding!);
  assert.equal(handed.binding?.platform, 'xiaohongshu');
  assert.equal(handed.binding?.accountId, 'acct-xhs-1');
  assert.equal(handed.binding?.contentPackageRevision, 5);
  assert.equal(handed.binding?.purpose, 'public_content');
  assert.equal(handed.binding?.scheduledAt, '2026-07-20T10:00:00.000Z');
  assert.deepEqual(handed.binding?.costRange, {
    currency: 'CNY',
    maxAmount: 20,
    minAmount: 0,
  });
  assert.equal(handed.binding?.approvalReceiptId, 'approval-receipt-1');
  assert.ok(handed.handoffLink);
  assert.equal(handed.handoffLink?.token, 'a'.repeat(32));
});

test('已交接 ≠ 已发布 — publish requires external receipt or manual record', () => {
  const prepared = prepareAssistedMaterials({
    actorId: 'owner-1',
    occurredAt: '2026-07-20T09:00:00.000Z',
    packageId: 'pkg-1',
    workspaceId: 'ws-1',
  });
  const handed = handOverAssistedReceipt(prepared, {
    actorId: 'owner-1',
    binding,
    issueHandoffLink: false,
    occurredAt: '2026-07-20T09:05:00.000Z',
  });

  assert.equal(handed.status, 'handed_over');
  assert.equal(isAssistedPublished(handed), false);

  const pending = markPendingManualPublish(handed, {
    actorId: 'owner-1',
    occurredAt: '2026-07-20T09:06:00.000Z',
  });
  assert.equal(pending.status, 'pending_manual_publish');
  assert.equal(
    ASSISTED_RECEIPT_STATUS_LABEL[pending.status],
    '待人工发布',
  );
  assert.equal(isAssistedPublished(pending), false);

  const recorded = recordAssistedPublishResult(pending, {
    actorId: 'owner-1',
    result: {
      platformUrl: 'https://www.xiaohongshu.com/explore/abc',
      recordedAt: '2026-07-20T11:00:00.000Z',
      source: 'manual_record',
      status: 'published',
    },
  });
  assert.equal(recorded.status, 'publish_result_recorded');
  assert.equal(
    ASSISTED_RECEIPT_STATUS_LABEL[recorded.status],
    '已记录发布结果',
  );
  assert.equal(isAssistedPublished(recorded), true);
  assert.equal(recorded.publishResult?.source, 'manual_record');

  const external = recordAssistedPublishResult(handed, {
    actorId: 'owner-1',
    result: {
      recordedAt: '2026-07-20T11:30:00.000Z',
      source: 'external_receipt',
      status: 'published',
    },
  });
  assert.equal(isAssistedPublished(external), true);
  assert.equal(external.publishResult?.source, 'external_receipt');
});

test('cannot record publish result before hand-over', () => {
  const prepared = prepareAssistedMaterials({
    actorId: 'owner-1',
    occurredAt: '2026-07-20T09:00:00.000Z',
    packageId: 'pkg-1',
    workspaceId: 'ws-1',
  });
  assert.throws(
    () =>
      recordAssistedPublishResult(prepared, {
        actorId: 'owner-1',
        result: {
          recordedAt: '2026-07-20T11:00:00.000Z',
          source: 'manual_record',
          status: 'published',
        },
      }),
    (error: unknown) =>
      error instanceof AssistedReceiptError &&
      error.code === 'INVALID_TRANSITION',
  );
});

test('external owner binding requires ownerId instead of accountId', () => {
  const prepared = prepareAssistedMaterials({
    actorId: 'owner-1',
    occurredAt: '2026-07-20T09:00:00.000Z',
    packageId: 'pkg-1',
    workspaceId: 'ws-1',
  });
  assert.throws(
    () =>
      handOverAssistedReceipt(prepared, {
        actorId: 'owner-1',
        binding: {
          ...binding,
          accountId: undefined,
          ownerId: undefined,
          responsibilityRole: 'external_owner',
        },
        issueHandoffLink: false,
        occurredAt: '2026-07-20T09:05:00.000Z',
      }),
    /ownerId|Binding/,
  );

  const handed = handOverAssistedReceipt(prepared, {
    actorId: 'owner-1',
    binding: {
      approvalReceiptId: 'approval-receipt-2',
      contentPackageRevision: 5,
      costRange: { currency: 'CNY', maxAmount: 0, minAmount: 0 },
      ownerId: 'external-editor-9',
      packageId: 'pkg-1',
      platform: 'douyin',
      purpose: 'public_content',
      responsibilityRole: 'external_owner',
      scheduledAt: '2026-07-20T12:00:00.000Z',
      variantVersionId: 'variant-v1',
      workspaceId: 'ws-1',
    },
    issueHandoffLink: false,
    occurredAt: '2026-07-20T09:05:00.000Z',
  });
  assert.equal(handed.binding?.ownerId, 'external-editor-9');
  assert.equal(handed.binding?.responsibilityRole, 'external_owner');
});

test('one-shot handoff link expires after 72h and fails closed after use', () => {
  const createdAt = '2026-07-20T00:00:00.000Z';
  const link = createOneShotHandoffLink({
    createdAt,
    token: 'b'.repeat(32),
  });
  assert.equal(
    Date.parse(link.expiresAt) - Date.parse(link.createdAt),
    ONE_SHOT_HANDOFF_LINK_TTL_MS,
  );

  const prepared = prepareAssistedMaterials({
    actorId: 'owner-1',
    occurredAt: createdAt,
    packageId: 'pkg-1',
    workspaceId: 'ws-1',
  });
  const handed = handOverAssistedReceipt(prepared, {
    actorId: 'owner-1',
    binding,
    linkToken: 'b'.repeat(32),
    occurredAt: createdAt,
  });

  const first = consumeOneShotHandoffLink(handed, {
    now: '2026-07-20T01:00:00.000Z',
    token: 'b'.repeat(32),
  });
  assert.equal(first.kind, 'ok');
  if (first.kind !== 'ok') return;

  const replay = consumeOneShotHandoffLink(first.receipt, {
    now: '2026-07-20T02:00:00.000Z',
    token: 'b'.repeat(32),
  });
  assert.deepEqual(replay, { kind: 'consumed' });

  const expired = consumeOneShotHandoffLink(handed, {
    now: new Date(
      Date.parse(createdAt) + ONE_SHOT_HANDOFF_LINK_TTL_MS + 1,
    ).toISOString(),
    token: 'b'.repeat(32),
  });
  assert.equal(expired.kind, 'expired');

  const missing = consumeOneShotHandoffLink(handed, {
    now: '2026-07-20T01:00:00.000Z',
    token: 'c'.repeat(32),
  });
  assert.equal(missing.kind, 'not_found');
});

test('24h pending confirm is a passive inbox projection', () => {
  const prepared = prepareAssistedMaterials({
    actorId: 'owner-1',
    occurredAt: '2026-07-20T00:00:00.000Z',
    packageId: 'pkg-1',
    workspaceId: 'ws-1',
  });
  const handed = handOverAssistedReceipt(prepared, {
    actorId: 'owner-1',
    binding,
    issueHandoffLink: false,
    occurredAt: '2026-07-20T00:00:00.000Z',
  });

  const before24h = projectPendingConfirmInbox(
    [handed],
    new Date(
      Date.parse('2026-07-20T00:00:00.000Z') + PENDING_CONFIRM_AFTER_MS - 1,
    ).toISOString(),
  );
  assert.equal(before24h.length, 0);

  const after24h = projectPendingConfirmInbox(
    [handed],
    new Date(
      Date.parse('2026-07-20T00:00:00.000Z') + PENDING_CONFIRM_AFTER_MS,
    ).toISOString(),
  );
  assert.equal(after24h.length, 1);
  assert.equal(after24h[0]?.reason, 'awaiting_confirm_24h');
  assert.equal(after24h[0]?.assistedReceiptId, handed.id);
  assert.equal(after24h[0]?.platform, 'xiaohongshu');
  assert.equal(after24h[0]?.status, 'handed_over');

  const published = recordAssistedPublishResult(handed, {
    actorId: 'owner-1',
    result: {
      recordedAt: '2026-07-21T01:00:00.000Z',
      source: 'manual_record',
      status: 'published',
    },
  });
  const afterPublish = projectPendingConfirmInbox(
    [published],
    '2026-07-22T00:00:00.000Z',
  );
  assert.equal(afterPublish.length, 0);
});

test('receipt binding fields completeness assertion', () => {
  assert.doesNotThrow(() => assertBindingFieldsComplete(binding));
  assert.throws(() =>
    assertBindingFieldsComplete({
      ...binding,
      approvalReceiptId: '',
    }),
  );
});
