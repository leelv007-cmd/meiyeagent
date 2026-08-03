import assert from 'node:assert/strict';
import test from 'node:test';
import {
  compareWaffoPaymentOrder,
  waffoLifecycleRank,
} from './plan-checkout-bindings';
import type { PlanSettlementIntent } from './plan-commerce';
import type { VerifiedPaymentWebhookEvent } from './types';

test('Waffo lifecycle ranks make terminal transitions monotonic for equal timestamps', () => {
  const event: VerifiedPaymentWebhookEvent = {
    eventType: 'checkout.completed',
    provider: 'waffo',
    providerEventId: 'event-1',
    reference: { id: 'subscription-1', kind: 'subscription' },
  };
  const lifecycles: PlanSettlementIntent['lifecycle'][] = [
    'activate',
    'renew',
    'past_due',
    'cancel_at_period_end',
    'uncancel_at_period_end',
    'expire',
  ];

  const ranks = lifecycles.map((lifecycle) =>
    waffoLifecycleRank(event, {
      interval: 'monthly',
      lifecycle,
      ownerUserId: 'owner-1',
      paymentEventId: `payment-${lifecycle}`,
      periodEndsAt: '2026-09-03T00:00:00.000Z',
      periodStartsAt: '2026-08-03T00:00:00.000Z',
      priceId: 'PROD_STARTER_MONTHLY',
      provider: 'waffo',
      providerEventId: `event-${lifecycle}`,
      subscriptionId: 'subscription-1',
      workspaceId: 'workspace-1',
    })
  );

  assert.deepEqual(ranks, [10, 20, 30, 40, 50, 60]);
});

const AUG_3 = '2026-08-03T00:00:00.000Z';
const AUG_10 = '2026-08-10T00:00:00.000Z';
const SEP_3 = '2026-09-03T00:00:00.000Z';

function incomingEvent(input: {
  eventId?: string;
  eventRank: number;
  occurredAt?: string | null;
  periodStartsAt?: string | null;
}) {
  return {
    eventId: input.eventId ?? 'event-incoming',
    eventRank: input.eventRank,
    periodStartsAt: input.periodStartsAt ?? null,
    providerOccurredAt: input.occurredAt ?? null,
  };
}

function persistedRow(input: {
  eventId?: string | null;
  eventRank: number | null;
  occurredAt?: string | null;
  periodStart?: string | null;
}) {
  return {
    eventId: input.eventId ?? 'event-persisted',
    eventRank: input.eventRank,
    periodStart: input.periodStart ?? null,
    providerOccurredAt: input.occurredAt ?? null,
  };
}

test('a replayed Waffo business event id is a duplicate, never a new mutation', () => {
  assert.equal(
    compareWaffoPaymentOrder(
      incomingEvent({ eventId: 'event-1', eventRank: 20, occurredAt: AUG_10 }),
      persistedRow({ eventId: 'event-1', eventRank: 60, occurredAt: AUG_3 })
    ),
    'duplicate'
  );
});

test('a late lifecycle event after a newer terminal state is ignored as stale', () => {
  // canceled persisted at Aug 10; a delayed canceling from Aug 3 arrives late.
  assert.equal(
    compareWaffoPaymentOrder(
      incomingEvent({ eventRank: 40, occurredAt: AUG_3 }),
      persistedRow({ eventRank: 60, occurredAt: AUG_10 })
    ),
    'ignored_stale'
  );
});

test('equal provider timestamps tie-break on lifecycle rank toward the terminal state', () => {
  assert.equal(
    compareWaffoPaymentOrder(
      incomingEvent({ eventRank: 60, occurredAt: AUG_3 }),
      persistedRow({ eventRank: 40, occurredAt: AUG_3 })
    ),
    'applied'
  );
  assert.equal(
    compareWaffoPaymentOrder(
      incomingEvent({ eventRank: 40, occurredAt: AUG_3 }),
      persistedRow({ eventRank: 60, occurredAt: AUG_3 })
    ),
    'ignored_stale'
  );
  // uncanceled outranks canceling at the same instant, so cancel→uncancel
  // converges instead of regressing.
  assert.equal(
    compareWaffoPaymentOrder(
      incomingEvent({ eventRank: 50, occurredAt: AUG_3 }),
      persistedRow({ eventRank: 40, occurredAt: AUG_3 })
    ),
    'applied'
  );
});

test('a next-period renewal advances past the previous period without a provider timestamp', () => {
  assert.equal(
    compareWaffoPaymentOrder(
      incomingEvent({ eventRank: 20, periodStartsAt: SEP_3 }),
      persistedRow({ eventRank: 20, periodStart: AUG_3 })
    ),
    'applied'
  );
  // A replayed activation from the previous period never rolls the row back.
  assert.equal(
    compareWaffoPaymentOrder(
      incomingEvent({ eventRank: 10, periodStartsAt: AUG_3 }),
      persistedRow({ eventRank: 20, periodStart: SEP_3 })
    ),
    'ignored_stale'
  );
});

test('an activate replay with the same period and no newer facts is stale, not a regression', () => {
  assert.equal(
    compareWaffoPaymentOrder(
      incomingEvent({ eventId: 'event-2', eventRank: 10, occurredAt: AUG_3 }),
      persistedRow({ eventId: 'event-1', eventRank: 20, occurredAt: AUG_3 })
    ),
    'ignored_stale'
  );
});
