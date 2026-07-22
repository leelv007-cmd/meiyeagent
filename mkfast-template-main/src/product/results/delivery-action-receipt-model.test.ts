import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  dedupeDeliveryActionReceipts,
  deliveryActionReceiptIdempotencyKey,
  projectDeliveryActionReceiptPanel,
  projectShareAttemptReceipt,
  projectShareDegradeExplanations,
  receiptKindFromDeliveryEvent,
  type DeliveryActionReceiptFact,
} from './delivery-action-receipt-model';

function receipt(
  overrides: Partial<DeliveryActionReceiptFact> &
    Pick<DeliveryActionReceiptFact, 'id' | 'kind'>
): DeliveryActionReceiptFact {
  return {
    id: overrides.id,
    kind: overrides.kind,
    idempotencyKey:
      overrides.idempotencyKey ??
      deliveryActionReceiptIdempotencyKey({
        contentPackageId: 'pkg-a',
        contentPackageRevision: 3,
        kind: overrides.kind,
        platform: 'xiaohongshu',
        purpose: 'organic_post',
      }),
    binding: overrides.binding ?? {
      contentPackageId: 'pkg-a',
      contentPackageRevision: 3,
      platform: 'xiaohongshu',
      accountOrOwnerLabel: '本店小红书',
      purpose: 'organic_post',
      actorId: 'actor-a',
      occurredAt: '2026-07-20T10:00:00.000Z',
      variantVersionId: 'xhs-v1',
    },
    ...(overrides.failureReason
      ? { failureReason: overrides.failureReason }
      : {}),
  };
}

describe('delivery-action-receipt-model', () => {
  it('fails closed without package revision', () => {
    const view = projectDeliveryActionReceiptPanel({});
    assert.equal(view.kind, 'fail_closed');
    if (view.kind !== 'fail_closed') return;
    assert.equal(view.reason, 'missing_package_revision');
  });

  it('fails closed with honest empty when no receipts yet', () => {
    const view = projectDeliveryActionReceiptPanel({
      contentPackageId: 'pkg-a',
      contentPackageRevision: 1,
    });
    assert.equal(view.kind, 'fail_closed');
    if (view.kind !== 'fail_closed') return;
    assert.equal(view.reason, 'no_receipts_yet');
  });

  it('never claims published for shared or handed_off receipts', () => {
    const view = projectDeliveryActionReceiptPanel({
      contentPackageId: 'pkg-a',
      contentPackageRevision: 3,
      hasPublicationRecord: false,
      receipts: [
        receipt({ id: 'r1', kind: 'shared' }),
        receipt({
          id: 'r2',
          kind: 'handed_off',
          binding: {
            contentPackageId: 'pkg-a',
            contentPackageRevision: 3,
            platform: 'xiaohongshu',
            accountOrOwnerLabel: '外协运营',
            purpose: 'organic_post',
            actorId: 'actor-a',
            occurredAt: '2026-07-20T11:00:00.000Z',
          },
        }),
      ],
    });
    assert.equal(view.kind, 'ready');
    if (view.kind !== 'ready') return;
    assert.equal(view.handedOffIsNotPublished, true);
    assert.ok(view.receipts.every((r) => r.claimsPublished === false));
    assert.equal(view.latestKind, 'handed_off');
  });

  it('share cancel does not write a success receipt', () => {
    const cancelled = projectShareAttemptReceipt({ kind: 'cancelled' });
    assert.equal(cancelled.writesReceipt, false);
    assert.equal(cancelled.receiptKind, null);
    assert.equal(cancelled.platformPublished, false);
    assert.equal(receiptKindFromDeliveryEvent('share_cancelled'), null);

    const shared = projectShareAttemptReceipt({ kind: 'shared' });
    assert.equal(shared.writesReceipt, true);
    assert.equal(shared.receiptKind, 'shared');
    assert.equal(shared.platformPublished, false);
  });

  it('explains file → one-shot link → download degrade order', () => {
    const steps = projectShareDegradeExplanations({
      canShareFiles: false,
      hasOneShotLink: true,
      hasDownload: true,
    });
    assert.deepEqual(
      steps.map((s) => s.strategy),
      ['one_shot_link', 'download']
    );
    assert.match(steps[0]?.explanation ?? '', /一次性链接/);
  });

  it('dedupes by idempotency key', () => {
    const key = deliveryActionReceiptIdempotencyKey({
      contentPackageId: 'pkg-a',
      contentPackageRevision: 3,
      kind: 'downloaded',
      platform: 'xiaohongshu',
      purpose: 'organic_post',
    });
    const deduped = dedupeDeliveryActionReceipts([
      receipt({ id: 'a', kind: 'downloaded', idempotencyKey: key }),
      receipt({ id: 'b', kind: 'downloaded', idempotencyKey: key }),
    ]);
    assert.equal(deduped.length, 1);
    assert.equal(deduped[0]?.id, 'a');
  });
});
