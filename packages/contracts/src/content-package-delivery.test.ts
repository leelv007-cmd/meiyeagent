import assert from 'node:assert/strict';
import test from 'node:test';

import {
  contentPackageDeliveryAttemptId,
  contentPackageDeliveryEventSchema,
} from './content-package.js';

const assistedEvent = {
  actorId: 'owner-a',
  artifactReceiptId: 'export-receipt-a',
  id: 'delivery-event-a',
  occurredAt: '2026-07-18T07:00:00.000Z',
  platform: 'douyin' as const,
  source: 'native' as const,
  type: 'assisted_handoff_prepared' as const,
  variantVersionId: 'douyin-v1',
};

test('historical native delivery events remain readable without a strong identity', () => {
  assert.equal(contentPackageDeliveryEventSchema.safeParse(assistedEvent).success, true);
});

test('approval_receipt_v1 binds a delivery attempt to its exact receipt', () => {
  const approvalReceiptId = 'approval-receipt-a';
  assert.equal(
    contentPackageDeliveryEventSchema.safeParse({
      ...assistedEvent,
      deliveryIdentity: {
        approvalReceiptId,
        deliveryAttemptId: contentPackageDeliveryAttemptId(approvalReceiptId),
        schema: 'approval_receipt_v1',
      },
    }).success,
    true
  );
  assert.equal(
    contentPackageDeliveryEventSchema.safeParse({
      ...assistedEvent,
      deliveryIdentity: {
        approvalReceiptId,
        deliveryAttemptId: 'content-package-delivery:another-receipt',
        schema: 'approval_receipt_v1',
      },
    }).success,
    false
  );
});
