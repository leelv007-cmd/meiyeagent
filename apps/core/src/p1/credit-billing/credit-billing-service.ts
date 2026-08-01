import { createHash } from 'node:crypto';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import {
  resolvePaymentTier,
  type PaymentMappingConfig,
  type PaymentMappingInterval,
} from '../foundation/payment-mapping.js';
import type { CreditPlanCatalog } from './credit-plan-catalog.js';
import type { CreditBalanceProjection, CreditGrantLot, GrantCreditsInput } from './credit-ledger.js';
import {
  creditSubscriptionIntervalForCycle,
  creditSubscriptionTierForCycle,
  currentCreditSubscriptionCycle,
  type CreditSubscription,
  type CreditSubscriptionInterval,
  type CreditSubscriptionStore,
} from './credit-subscription-scheduler.js';

export type CreditPaymentLifecycle =
  | 'activate'
  | 'renew'
  | 'resume'
  | 'past_due'
  | 'cancel_at_period_end'
  | 'expire';

export interface CreditPaymentSettlementInput {
  lifecycle: CreditPaymentLifecycle;
  paymentEventId: string;
  paymentProductId: string;
  interval?: PaymentMappingInterval | null;
  periodStartsAt?: string | null;
  subscriptionId?: string | null;
}

export interface CreditBillingLedgerPort {
  grant(input: GrantCreditsInput): Promise<CreditGrantLot> | CreditGrantLot;
  listLots(workspaceId: string): Promise<readonly CreditGrantLot[]> | readonly CreditGrantLot[];
  project(
    workspaceId: string,
    asOf?: string,
  ): Promise<CreditBalanceProjection> | CreditBalanceProjection;
  expireSubscriptionLots(input: {
    workspaceId: string;
    subscriptionId: string;
    actorId: string;
    correlationId: string;
    createdAt: string;
  }): Promise<unknown> | unknown;
}

export interface CreditPlanCatalogSource {
  get(): Promise<CreditPlanCatalog>;
}

export interface CreditPaymentMappingSource {
  getPaymentMapping(): Promise<PaymentMappingConfig | null>;
}

export class CreditBillingService {
  constructor(
    private readonly ledger: CreditBillingLedgerPort,
    private readonly subscriptions: CreditSubscriptionStore,
    private readonly plans: CreditPlanCatalogSource,
    private readonly paymentMappings: CreditPaymentMappingSource,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async grantTrial(context: P1Context) {
    const catalog = await this.plans.get();
    if (!catalog.trialEnabled) return this.balance(context.workspaceId);
    const trial = catalog.plans.find((plan) => plan.id === 'trial');
    if (!trial) {
      throw new P1DomainError('INVALID_STATE', 'Trial credit plan is not configured.');
    }
    if (!Number.isSafeInteger(trial.credits) || trial.credits <= 0) {
      throw new P1DomainError('INVALID_STATE', 'Trial credits must be a positive integer.');
    }
    const createdAt = this.clock().toISOString();
    await this.ledger.grant({
      id: `trial:${context.workspaceId}`,
      workspaceId: context.workspaceId,
      credits: trial.credits,
      expirationDate: null,
      transactionType: 'REGISTER_GIFT',
      sourceRef: 'trial',
      grantIdempotencyKey: `grant:trial:${context.workspaceId}`,
      actorId: context.userId,
      correlationId: context.correlationId,
      createdAt,
    });
    return this.balance(context.workspaceId);
  }

  async settlePayment(
    context: P1Context,
    input: CreditPaymentSettlementInput,
  ) {
    assertText(input.paymentEventId, 'paymentEventId');
    assertText(input.paymentProductId, 'paymentProductId');
    assertText(input.subscriptionId ?? '', 'subscriptionId');
    const tier = resolvePaymentTier({
      paymentProductId: input.paymentProductId,
      interval: input.interval,
      config: await this.paymentMappings.getPaymentMapping(),
    });
    if (tier === 'trial') {
      throw new P1DomainError('INVALID_STATE', 'Payment cannot grant the trial credit plan.');
    }
    const now = this.clock().toISOString();
    return this.subscriptions.withPaymentEvent(
      {
        workspaceId: context.workspaceId,
        paymentEventId: input.paymentEventId,
        payloadHash: paymentSettlementHash(context.workspaceId, input),
        createdAt: now,
      },
      (subscriptions) =>
        this.settlePaymentEvent(context, input, tier, now, subscriptions),
    );
  }

  private async settlePaymentEvent(
    context: P1Context,
    input: CreditPaymentSettlementInput,
    tier: CreditSubscription['tier'],
    now: string,
    subscriptions: CreditSubscriptionStore,
  ) {
    const anchorAt = input.periodStartsAt ?? now;
    const interval = creditInterval(input.interval);
    const workspaceSubscriptions = await subscriptions.listForWorkspace(
      context.workspaceId,
    );
    const requestedSubscription = subscriptionForPayment(
      workspaceSubscriptions,
      input.subscriptionId,
    );
    const workspaceActive = workspaceSubscriptions.find(
      (subscription) => subscription.status !== 'cancelled',
    ) ?? null;
    const active =
      requestedSubscription ??
      (input.lifecycle === 'activate' ? workspaceActive : null);
    const currentCycleIndex = active
      ? currentCreditSubscriptionCycle(active, now)?.cycleIndex ??
        Math.max(0, active.paidThroughCycle - 1)
      : 0;
    const currentTier = active
      ? creditSubscriptionTierForCycle(active, currentCycleIndex)
      : null;
    const currentInterval = active
      ? creditSubscriptionIntervalForCycle(active, currentCycleIndex)
      : null;
    if (input.lifecycle === 'past_due') {
      if (!active) return null;
      return subscriptions.markPastDue(active.id, now);
    }
    if (input.lifecycle === 'cancel_at_period_end') {
      if (!active) return null;
      return subscriptions.scheduleChange({
        subscriptionId: active.id,
        tier: currentTier!,
        interval: currentInterval!,
        effectiveCycle: active.paidThroughCycle,
        at: now,
      });
    }
    if (input.lifecycle === 'expire') {
      if (!active) return null;
      return subscriptions.cancel(active.id, now);
    }

    if (input.lifecycle === 'resume') {
      if (!active) {
        throw new P1DomainError(
          'NOT_FOUND',
          'Credit subscription cannot resume before activation.',
        );
      }
      return subscriptions.resume(active.id, now);
    }

    if (input.lifecycle === 'renew') {
      if (!active) {
        throw new P1DomainError(
          'NOT_FOUND',
          'Credit subscription cannot renew before activation.',
        );
      }
      if (
        currentInterval === 'single_month' &&
        active.pendingInterval === null
      ) {
        throw new P1DomainError(
          'INVALID_STATE',
          'A single-month credit subscription has no renewable coverage.',
        );
      }
      assertText(input.periodStartsAt ?? '', 'periodStartsAt');
      return subscriptions.recordPaidPeriod({
        subscriptionId: active.id,
        periodStartsAt: input.periodStartsAt!,
        coverageCycles: paidCycleCoverage(interval),
        at: now,
      });
    }

    if (!active) {
      return this.openSubscription(context, subscriptions, {
        id: subscriptionIdFor(input, context.workspaceId),
        interval,
        paidThroughCycle: paidCycleCoverage(interval),
        tier,
        anchorAt,
        now,
      });
    }

    const requestedSubscriptionId = subscriptionIdFor(
      input,
      context.workspaceId,
    );
    const comparison = planRank(tier) - planRank(currentTier!);
    const replacesSubscription = active.id !== requestedSubscriptionId;
    if (replacesSubscription && comparison < 0) {
      throw new P1DomainError(
        'INVALID_STATE',
        'A replacement subscription cannot apply a downgrade before the next cycle.',
      );
    }
    if (comparison > 0 || replacesSubscription) {
      await this.ledger.expireSubscriptionLots({
        workspaceId: context.workspaceId,
        subscriptionId: active.id,
        actorId: context.userId,
        correlationId: context.correlationId,
        createdAt: now,
      });
      await subscriptions.cancel(active.id, now);
      return this.openSubscription(context, subscriptions, {
        id: requestedSubscriptionId,
        interval,
        paidThroughCycle: paidCycleCoverage(interval),
        tier,
        anchorAt,
        grantCycleOffset: replacesSubscription
          ? 0
          : active.grantCycleOffset + active.paidThroughCycle,
        now,
      });
    }

    const effectiveCycle = active.paidThroughCycle;
    return subscriptions.scheduleChange({
      subscriptionId: active.id,
      tier,
      interval,
      effectiveCycle,
      at: now,
    });
  }

  async balance(workspaceId: string) {
    return this.ledger.project(workspaceId, this.clock().toISOString());
  }

  async grantAddOn(
    context: P1Context,
    input: { offerId: string; paymentEventId: string },
  ) {
    assertText(input.offerId, 'offerId');
    assertText(input.paymentEventId, 'paymentEventId');
    const offer = (await this.plans.get()).addOns.find(
      (candidate) => candidate.id === input.offerId,
    );
    if (!offer) {
      throw new P1DomainError('INVALID_STATE', 'Credit add-on offer is not configured.');
    }
    const createdAt = this.clock().toISOString();
    const expirationDate = new Date(
      this.clock().getTime() + offer.expireDays * 24 * 60 * 60 * 1_000,
    ).toISOString();
    return this.ledger.grant({
      id: `package:${input.paymentEventId}`,
      workspaceId: context.workspaceId,
      credits: offer.credits,
      expirationDate,
      transactionType: 'PURCHASE_PACKAGE',
      sourceRef: offer.id,
      grantIdempotencyKey: `grant:package:${input.paymentEventId}`,
      actorId: context.userId,
      correlationId: context.correlationId,
      createdAt,
    });
  }

  catalog() {
    return this.plans.get();
  }

  private async openSubscription(
    context: P1Context,
    subscriptions: CreditSubscriptionStore,
    input: {
      id: string;
      tier: Exclude<CreditSubscription['tier'], 'trial'>;
      interval: CreditSubscriptionInterval;
      paidThroughCycle: number;
      now: string;
      anchorAt: string;
      grantCycleOffset?: number;
    },
  ) {
    return subscriptions.upsert({
      id: input.id,
      workspaceId: context.workspaceId,
      tier: input.tier,
      interval: input.interval,
      anchorAt: input.anchorAt,
      paidThroughCycle: input.paidThroughCycle,
      grantCycleOffset: input.grantCycleOffset,
      createdAt: input.now,
      updatedAt: input.now,
    });
  }
}

function subscriptionForPayment(
  subscriptions: CreditSubscription[],
  subscriptionId: string | null | undefined,
) {
  const requested = subscriptionId?.trim();
  return requested
    ? subscriptions.find((subscription) => subscription.id === requested) ?? null
    : null;
}

function paymentSettlementHash(
  workspaceId: string,
  input: CreditPaymentSettlementInput,
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        workspaceId,
        lifecycle: input.lifecycle,
        paymentProductId: input.paymentProductId,
        interval: input.interval ?? null,
        periodStartsAt: input.periodStartsAt ?? null,
        subscriptionId: input.subscriptionId?.trim() ?? null,
      }),
    )
    .digest('hex');
}

function subscriptionIdFor(
  input: { paymentEventId: string; subscriptionId?: string | null },
  _workspaceId: string,
) {
  const requested = input.subscriptionId?.trim();
  if (!requested) {
    throw new P1DomainError('INVALID_STATE', 'subscriptionId is required.');
  }
  return requested;
}

function creditInterval(
  interval: PaymentMappingInterval | null | undefined,
): CreditSubscriptionInterval {
  if (interval === 'year') return 'yearly';
  if (interval === 'one_time') return 'single_month';
  return 'monthly';
}

function paidCycleCoverage(interval: CreditSubscriptionInterval) {
  return interval === 'yearly' ? 12 : 1;
}

function planRank(tier: Exclude<CreditSubscription['tier'], 'trial'>) {
  return { starter: 1, growth: 2, pro: 3 }[tier];
}

function assertText(value: string, field: string) {
  if (!value.trim()) {
    throw new P1DomainError('INVALID_STATE', `${field} is required.`);
  }
}
