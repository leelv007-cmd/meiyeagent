import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  activeOutcomeObservations,
  isUnsafeOutcomeNote,
  mapLegacyResultSignalKind,
  observationsFromResultSignals,
  projectOutcomeLadder,
  projectOutcomeObservationPanel,
  type OutcomeObservationFact,
} from './outcome-observation-model';

function obs(
  partial: Partial<OutcomeObservationFact> &
    Pick<OutcomeObservationFact, 'id' | 'kind'>
): OutcomeObservationFact {
  return {
    id: partial.id,
    kind: partial.kind,
    workspaceId: partial.workspaceId ?? 'ws-a',
    contentPackageId: partial.contentPackageId ?? 'pkg-a',
    contentPackageRevision: partial.contentPackageRevision ?? 2,
    publicationRecordId: partial.publicationRecordId ?? 'pub-1',
    occurredAt: partial.occurredAt ?? '2026-07-20T10:00:00.000Z',
    recordedAt: partial.recordedAt ?? '2026-07-20T10:05:00.000Z',
    actorId: partial.actorId ?? 'actor-a',
    sourceTier: partial.sourceTier ?? 'merchant_recorded',
    ...(partial.quantity !== undefined ? { quantity: partial.quantity } : {}),
    ...(partial.note ? { note: partial.note } : {}),
    ...(partial.supersedesObservationId
      ? { supersedesObservationId: partial.supersedesObservationId }
      : {}),
  };
}

describe('outcome-observation-model', () => {
  it('fails closed until publication exists', () => {
    const view = projectOutcomeObservationPanel({
      contentPackageId: 'pkg-a',
      contentPackageRevision: 2,
      hasPublicationRecord: false,
    });
    assert.equal(view.kind, 'fail_closed');
    if (view.kind !== 'fail_closed') return;
    assert.equal(view.reason, 'not_published');
    assert.ok(view.chips.every((c) => c.enabled === false));
    assert.ok(view.chips.every((c) => c.minHitAreaPx === 44));
  });

  it('maps ladder with unknown (not zero) for unreached steps', () => {
    const ladder = projectOutcomeLadder({
      hasPublicationRecord: true,
      activeObservations: [obs({ id: 'o1', kind: 'inquiry' })],
    });
    assert.deepEqual(
      ladder.filter((s) => s.reached).map((s) => s.id),
      ['published', 'attention', 'consultation']
    );
    const unreached = ladder.filter((s) => !s.reached);
    assert.ok(unreached.every((s) => s.state === 'unknown'));
  });

  it('supersede hides original from active set and marks trail', () => {
    const original = obs({ id: 'o1', kind: 'store_visit', quantity: 1 });
    const correction = obs({
      id: 'o2',
      kind: 'store_visit',
      quantity: 2,
      supersedesObservationId: 'o1',
      recordedAt: '2026-07-21T10:00:00.000Z',
    });
    const active = activeOutcomeObservations([original, correction]);
    assert.deepEqual(
      active.map((o) => o.id),
      ['o2']
    );

    const view = projectOutcomeObservationPanel({
      workspaceId: 'ws-a',
      contentPackageId: 'pkg-a',
      contentPackageRevision: 2,
      hasPublicationRecord: true,
      observations: [original, correction],
    });
    assert.equal(view.kind, 'ready');
    if (view.kind !== 'ready') return;
    assert.equal(view.inferredUsesCausalLanguage, false);
    const merchant = view.groups.find(
      (g) => g.sourceTier === 'merchant_recorded'
    );
    assert.equal(merchant?.observations[0]?.isSuperseded, true);
    assert.ok(merchant?.observations[1]?.supersedesLabel);
    assert.equal(
      view.ladder.find((s) => s.id === 'redeemed_or_visited')?.reached,
      true
    );
  });

  it('maps legacy signals and rejects unsafe notes', () => {
    assert.equal(mapLegacyResultSignalKind('private_message'), 'inquiry');
    assert.equal(mapLegacyResultSignalKind('wechat_added'), 'contact_added');
    assert.equal(
      mapLegacyResultSignalKind('voucher_purchased'),
      'voucher_purchase'
    );

    const mapped = observationsFromResultSignals({
      workspaceId: 'ws-a',
      contentPackageId: 'pkg-a',
      contentPackageRevision: 3,
      publicationRecordId: 'pub-1',
      signals: [
        {
          id: 's1',
          kind: 'private_message',
          source: 'merchant_recorded',
          actorId: 'a',
          occurredAt: '2026-07-20T10:00:00.000Z',
        },
        {
          id: 's2',
          kind: 'unknown_kind',
          source: 'merchant_recorded',
          actorId: 'a',
          occurredAt: '2026-07-20T10:00:00.000Z',
        },
      ],
    });
    assert.equal(mapped.length, 1);
    assert.equal(mapped[0]?.kind, 'inquiry');

    assert.equal(isUnsafeOutcomeNote('今天到店 2 人'), false);
    assert.equal(isUnsafeOutcomeNote('微信 13800138000'), true);
    assert.equal(isUnsafeOutcomeNote('a'.repeat(200)), true);
  });

  it('missing quantity displays as unknown not zero', () => {
    const view = projectOutcomeObservationPanel({
      contentPackageId: 'pkg-a',
      contentPackageRevision: 2,
      hasPublicationRecord: true,
      observations: [obs({ id: 'o1', kind: 'attention' })],
    });
    assert.equal(view.kind, 'ready');
    if (view.kind !== 'ready') return;
    const merchant = view.groups.find(
      (g) => g.sourceTier === 'merchant_recorded'
    );
    assert.equal(merchant?.observations[0]?.quantityLabel, '未知');
  });
});
