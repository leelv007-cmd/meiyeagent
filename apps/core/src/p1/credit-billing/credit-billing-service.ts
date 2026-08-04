import { createHash } from 'node:crypto';

import { P1DomainError, type P1Context } from '../foundation/domain.js';
import {
  resolvePaymentTier,
  type PaymentMappingConfig,
  type PaymentMappingInterval,
} from '../foundation/payment-mapping.js';
import type { CreditPlanCatalog } from './credit-plan-catalog.js';
import type {
  CreditBalanceProjection,
  CreditGrantLot,
  CreditLotTransaction,
  GrantCreditsInput,
} from './credit-ledger.js';
import {
  creditSubscriptionCycle,
  creditSubscriptionCycleIndexAt,
  creditSubscriptionIntervalForCycle,
  creditSubscriptionGrantKey,
  creditSubscriptionTierForCycle,
  currentCreditSubscriptionCycle,
  DeferredCreditPaymentEvent,
  type CreditSubscription,
  type CreditSubscriptionCoverage,
  type CreditSubscriptionInterval,
  type CreditSubscriptionStore,
} from './credit-subscription-scheduler.js';
import { currentPaidCreditSubscription } from './credit-entitlement-policy.js';

export type CreditPaymentLifecycle =
  | 'activate'
  | 'renew'
  | 'resume'
  | 'uncancel_at_period_end'
  | 'past_due'
  | 'cancel_at_period_end'
  | 'expire';

export interface CreditPaymentSettlementInput {
  lifecycle: CreditPaymentLifecycle;
  paymentEventId: string;
  paymentProductId: string;
  paymentProvider?: 'waffo';
  interval?: PaymentMappingInterval | null;
  periodStartsAt?: string | null;
  subscriptionId?: string | null;
  providerOccurredAt?: string | null;
}

export interface CreditBillingLedgerPort {
  grant(input: GrantCreditsInput): Promise<CreditGrantLot> | CreditGrantLot;
  listLots(workspaceId: string): Promise<readonly CreditGrantLot[]> | readonly CreditGrantLot[];
  listTransactions?(
    workspaceId: string,
  ): Promise<readonly CreditLotTransaction[]> | readonly CreditLotTransaction[];
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

export interface CreditBillingSummary {
  creditsThisPeriod: number;
  interval: CreditSubscriptionInterval;
  periodEndsAt: string;
  tier: CreditSubscription['tier'];
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
      paymentProvider: input.paymentProvider,
    });
    if (tier === 'trial') {
      throw new P1DomainError('INVALID_STATE', 'Payment cannot grant the trial credit plan.');
    }
    const interval = creditInterval(input.interval);
    const now = this.clock().toISOString();
    return this.subscriptions.withPaymentEvent(
      {
        workspaceId: context.workspaceId,
        paymentEventId: input.paymentEventId,
        payloadHash: paymentSettlementHash(context.workspaceId, input),
        compatiblePayloadHashes: legacyWaffoPaymentSettlementHashes(
          context.workspaceId,
          input,
        ),
        createdAt: now,
      },
      async (subscriptions) =>
        this.settlePaymentEvent(
          context,
          input,
          tier,
          paidCoverageForPlan(await this.plans.get(), tier, interval),
          now,
          subscriptions,
        ),
    );
  }

  private async settlePaymentEvent(
    context: P1Context,
    input: CreditPaymentSettlementInput,
    tier: CreditSubscription['tier'],
    coverage: CreditSubscriptionCoverage,
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
      assertExistingSubscription(active, input.lifecycle);
      assertText(input.periodStartsAt ?? '', 'periodStartsAt');
      if (
        await staleTerminalPeriod(subscriptions, active.id, input, {
          allowEqualPeriod: input.providerOccurredAt != null,
        })
      ) {
        return ignoredStale(active);
      }
      return subscriptions.markPastDue(active.id, now);
    }
    if (input.lifecycle === 'cancel_at_period_end') {
      assertExistingSubscription(active, input.lifecycle);
      if (
        await staleTerminalPeriod(subscriptions, active.id, input, {
          allowEqualPeriod: true,
        })
      ) {
        return ignoredStale(active);
      }
      return subscriptions.scheduleChange({
        subscriptionId: active.id,
        tier: currentTier!,
        interval: currentInterval!,
        effectiveCycle: active.paidThroughCycle,
        at: now,
      });
    }
    if (input.lifecycle === 'expire') {
      assertExistingSubscription(active, input.lifecycle);
      if (await staleTerminalPeriod(subscriptions, active.id, input)) {
        return ignoredStale(active);
      }
      return subscriptions.cancel(active.id, now);
    }

    if (input.lifecycle === 'resume') {
      if (!active) {
        throw new P1DomainError(
          'NOT_FOUND',
          'Credit subscription cannot resume before activation.',
        );
      }
      if (active.status !== 'past_due') {
        throw new P1DomainError(
          'INVALID_STATE',
          'Only a past-due credit subscription can resume after payment.',
        );
      }
      assertText(input.periodStartsAt ?? '', 'periodStartsAt');
      if (Date.parse(input.periodStartsAt!) > Date.parse(now)) {
        throw new DeferredCreditPaymentEvent(
          'Credit resume is waiting for its paid billing period to start.',
        );
      }
      if (await staleTerminalPeriod(subscriptions, active.id, input)) {
        return ignoredStale(active);
      }
      const resumeCycle = creditSubscriptionCycleIndexAt(
        active.anchorAt,
        input.periodStartsAt!,
      );
      const frozenTier = creditSubscriptionTierForCycle(active, resumeCycle);
      const frozenInterval = creditSubscriptionIntervalForCycle(
        active,
        resumeCycle,
      );
      if (tier !== frozenTier || interval !== frozenInterval) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Credit resume does not match the frozen credit subscription tier and interval.',
        );
      }
      const paid = await subscriptions.recordPaidPeriod({
        subscriptionId: active.id,
        periodStartsAt: input.periodStartsAt!,
        coverageCycles: paidCycleCoverage(interval),
        coverage,
        at: now,
      });
      // A catch-up payment that leaves an earlier cycle unpaid does not advance
      // contiguous coverage, so recordPaidPeriod returns without clearing
      // past_due. The payment still settled: restore status without granting a
      // cycle, otherwise the grace sweeper cancels a paid subscription.
      if (paid.status === 'past_due') {
        return subscriptions.resume(active.id, now);
      }
      return paid;
    }

    if (input.lifecycle === 'uncancel_at_period_end') {
      assertExistingSubscription(active, input.lifecycle);
      return subscriptions.uncancel(active.id, now);
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
      if (Date.parse(input.periodStartsAt!) > Date.parse(now)) {
        throw new DeferredCreditPaymentEvent(
          'Credit renewal is waiting for its billing period to start.',
        );
      }
      const renewalCycle = creditSubscriptionCycleIndexAt(
        active.anchorAt,
        input.periodStartsAt!,
      );
      const frozenTier = creditSubscriptionTierForCycle(active, renewalCycle);
      const frozenInterval = creditSubscriptionIntervalForCycle(
        active,
        renewalCycle,
      );
      if (tier !== frozenTier || interval !== frozenInterval) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Credit renewal does not match the frozen credit subscription tier and interval.',
        );
      }
      return subscriptions.recordPaidPeriod({
        subscriptionId: active.id,
        periodStartsAt: input.periodStartsAt!,
        coverageCycles: paidCycleCoverage(interval),
        coverage,
        at: now,
      });
    }

    if (!active) {
      return this.openSubscription(context, subscriptions, {
        id: subscriptionIdFor(input, context.workspaceId),
        interval,
        paidThroughCycle: paidCycleCoverage(interval),
        tier,
        coverage,
        anchorAt,
        now,
      });
    }

    if (
      input.lifecycle === 'activate' &&
      requestedSubscription &&
      requestedSubscription.grantLineageId !== requestedSubscription.id &&
      input.periodStartsAt
    ) {
      if (Date.parse(input.periodStartsAt) > Date.parse(now)) {
        throw new DeferredCreditPaymentEvent(
          'Credit replacement is waiting for its billing period to start.',
        );
      }
      const activationCycle = creditSubscriptionCycleIndexAt(
        active.anchorAt,
        input.periodStartsAt,
      );
      const frozenTier = creditSubscriptionTierForCycle(active, activationCycle);
      const frozenInterval = creditSubscriptionIntervalForCycle(
        active,
        activationCycle,
      );
      if (tier !== frozenTier || interval !== frozenInterval) {
        throw new P1DomainError(
          'INVALID_STATE',
          'Credit replacement does not match the frozen credit subscription tier and interval.',
        );
      }
      return subscriptions.recordPaidPeriod({
        subscriptionId: active.id,
        periodStartsAt: input.periodStartsAt,
        coverageCycles: paidCycleCoverage(interval),
        coverage,
        at: now,
      });
    }

    const requestedSubscriptionId = subscriptionIdFor(
      input,
      context.workspaceId,
    );
    const comparison = planRank(tier) - planRank(currentTier!);
    const replacesSubscription = active.id !== requestedSubscriptionId;
    if (replacesSubscription && comparison <= 0) {
      const deferred = Date.parse(anchorAt) > Date.parse(now);
      const effectiveCycle = active.paidThroughCycle;
      const replacement = await subscriptions.replaceSubscription({
        sourceSubscriptionId: active.id,
        targetSubscriptionId: requestedSubscriptionId,
        at: now,
      });
      if (comparison < 0 || interval !== currentInterval) {
        const scheduled = await subscriptions.scheduleChange({
          subscriptionId: replacement.id,
          tier,
          interval,
          effectiveCycle,
          at: now,
        });
        if (deferred) {
          throw new DeferredCreditPaymentEvent(
            'Credit replacement is waiting for its billing period to start.',
          );
        }
        return subscriptions.recordPaidPeriod({
          subscriptionId: scheduled.id,
          periodStartsAt: anchorAt,
          coverageCycles: paidCycleCoverage(interval),
          coverage,
          at: now,
        });
      }
      const paid = await subscriptions.recordPaidPeriod({
        subscriptionId: replacement.id,
        periodStartsAt: anchorAt,
        coverageCycles: paidCycleCoverage(interval),
        coverage,
        at: now,
      });
      if (deferred) {
        throw new DeferredCreditPaymentEvent(
          'Credit replacement is waiting for its billing period to start.',
        );
      }
      return paid;
    }
    if (comparison > 0 || replacesSubscription) {
      await this.ledger.expireSubscriptionLots({
        workspaceId: context.workspaceId,
        subscriptionId: active.grantLineageId,
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
        coverage,
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

  async detail(workspaceId: string) {
    if (!this.ledger.listTransactions) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Credit ledger detail reader is not configured.',
      );
    }
    // Read transactions first. A newly committed grant cannot then surface a
    // transaction whose source lot is absent from the following lot read.
    const transactions = await this.ledger.listTransactions(workspaceId);
    const lots = await this.ledger.listLots(workspaceId);
    const billing = await this.billingFromLots(workspaceId, lots);
    return { billing, lots, transactions };
  }

  async billing(workspaceId: string): Promise<CreditBillingSummary | null> {
    return this.billingFromLots(
      workspaceId,
      await this.ledger.listLots(workspaceId),
    );
  }

  private async billingFromLots(
    workspaceId: string,
    lots: readonly CreditGrantLot[],
  ): Promise<CreditBillingSummary | null> {
    const now = this.clock();
    const subscription = currentPaidCreditSubscription(
      await this.subscriptions.listForWorkspace(workspaceId),
      now,
    );
    if (!subscription) return null;

    const currentCycle = currentCreditSubscriptionCycle(
      subscription,
      now.toISOString(),
    );
    const cycleIndex =
      currentCycle?.cycleIndex ??
      Math.max(0, subscription.paidThroughCycle - 1);
    const coverage = await this.subscriptions.paidCoverageForCycle(
      subscription.id,
      cycleIndex,
    );
    const grantKey = creditSubscriptionGrantKey(
      subscription.grantLineageId,
      subscription.grantCycleOffset + cycleIndex,
    );
    const issuedLot = lots.find(
      (lot) => lot.grantIdempotencyKey === grantKey,
    );
    // Paid coverage is frozen with the verified payment. A row from before the
    // immutable snapshot migration can truthfully degrade until it has a lot;
    // new payment rows never read today's mutable plan configuration here.
    if (!issuedLot && !coverage) return null;
    return {
      creditsThisPeriod: issuedLot?.originalCredits ?? coverage!.creditsPerCycle,
      interval: coverage?.interval ?? creditSubscriptionIntervalForCycle(subscription, cycleIndex),
      periodEndsAt:
        currentCycle?.endsAt ??
        creditSubscriptionCycle(subscription.anchorAt, cycleIndex).endsAt,
      tier: coverage?.tier ?? creditSubscriptionTierForCycle(subscription, cycleIndex),
    };
  }

  async grantAddOn(
    context: P1Context,
    input: {
      offerId: string;
      paymentEventId: string;
      credits: number;
      expireDays: number;
    },
  ) {
    assertText(input.offerId, 'offerId');
    assertText(input.paymentEventId, 'paymentEventId');
    if (!Number.isSafeInteger(input.credits) || input.credits <= 0) {
      throw new P1DomainError('INVALID_STATE', 'credits must be a positive integer.');
    }
    if (!Number.isSafeInteger(input.expireDays) || input.expireDays <= 0) {
      throw new P1DomainError('INVALID_STATE', 'expireDays must be a positive integer.');
    }
    const createdAt = this.clock().toISOString();
    const expirationDate = new Date(
      this.clock().getTime() + input.expireDays * 24 * 60 * 60 * 1_000,
    ).toISOString();
    return this.ledger.grant({
      id: `package:${input.paymentEventId}`,
      workspaceId: context.workspaceId,
      credits: input.credits,
      expirationDate,
      transactionType: 'PURCHASE_PACKAGE',
      sourceRef: input.offerId,
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
      coverage: CreditSubscriptionCoverage;
      interval: CreditSubscriptionInterval;
      paidThroughCycle: number;
      now: string;
      anchorAt: string;
      grantCycleOffset?: number;
    },
  ) {
    const subscription = await subscriptions.upsert({
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
    await subscriptions.recordInitialPaidPeriod({
      subscriptionId: subscription.id,
      periodStartsAt: input.anchorAt,
      coverageCycles: input.paidThroughCycle,
      coverage: input.coverage,
      at: input.now,
    });
    return subscription;
  }
}

async function staleTerminalPeriod(
  subscriptions: CreditSubscriptionStore,
  subscriptionId: string,
  input: CreditPaymentSettlementInput,
  options: { allowEqualPeriod?: boolean } = {},
) {
  if (!input.periodStartsAt) return false;
  const latest = await subscriptions.latestPaidPeriodStartsAt(subscriptionId);
  if (!latest) return false;
  const incoming = new Date(input.periodStartsAt);
  if (Number.isNaN(incoming.getTime())) {
    throw new P1DomainError('INVALID_STATE', 'periodStartsAt must be an ISO timestamp.');
  }
  return options.allowEqualPeriod
    ? incoming.toISOString() < latest
    : incoming.toISOString() <= latest;
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
  normalizePaidPeriodLifecycle = true,
) {
  return createHash('sha256')
    .update(
      JSON.stringify({
        workspaceId,
        lifecycle: normalizePaidPeriodLifecycle
          ? paidPeriodLifecycle(input.lifecycle)
          : input.lifecycle,
        paymentProductId: input.paymentProductId,
        interval: input.interval ?? null,
        periodStartsAt: input.periodStartsAt ?? null,
        subscriptionId: input.subscriptionId?.trim() ?? null,
      }),
    )
    .digest('hex');
}

function legacyWaffoPaymentSettlementHashes(
  workspaceId: string,
  input: CreditPaymentSettlementInput,
) {
  if (
    input.paymentProvider !== 'waffo' ||
    (input.lifecycle !== 'activate' && input.lifecycle !== 'renew') ||
    !input.subscriptionId?.trim()
  ) {
    return [];
  }
  // Before the paid-period canonical hash, activation and renewal receipts
  // used their individual lifecycle names. A delivery can legitimately
  // replay either legacy spelling for the same subscription period, so accept
  // both hashes while keeping all other facts strict.
  const hashes = new Set<string>();
  for (const lifecycle of ['activate', 'renew'] as const) {
    hashes.add(
      paymentSettlementHash(
        workspaceId,
        { ...input, lifecycle },
        false,
      ),
    );
  }
  return [...hashes];
}

function paidPeriodLifecycle(lifecycle: CreditPaymentLifecycle) {
  return lifecycle === 'activate' || lifecycle === 'renew'
    ? 'paid_period'
    : lifecycle;
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
  if (interval === 'year' || interval === 'yearly') return 'yearly';
  if (interval === 'one_time' || interval === 'single_month') {
    return 'single_month';
  }
  return 'monthly';
}

function paidCycleCoverage(interval: CreditSubscriptionInterval) {
  return interval === 'yearly' ? 12 : 1;
}

function paidCoverageForPlan(
  catalog: CreditPlanCatalog,
  tier: Exclude<CreditSubscription['tier'], 'trial'>,
  interval: CreditSubscriptionInterval,
): CreditSubscriptionCoverage {
  const plan = catalog.plans.find((candidate) => candidate.id === tier);
  if (!plan || !Number.isSafeInteger(plan.credits) || plan.credits <= 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Credit plan ${tier} must provide a positive integer credit amount.`,
    );
  }
  return { creditsPerCycle: plan.credits, interval, tier };
}

function planRank(tier: Exclude<CreditSubscription['tier'], 'trial'>) {
  return { starter: 1, growth: 2, pro: 3 }[tier];
}

function assertText(value: string, field: string) {
  if (!value.trim()) {
    throw new P1DomainError('INVALID_STATE', `${field} is required.`);
  }
}

function assertExistingSubscription(
  subscription: CreditSubscription | null,
  lifecycle: CreditPaymentLifecycle,
): asserts subscription is CreditSubscription {
  if (!subscription) {
    throw new P1DomainError(
      'NOT_FOUND',
      `Credit subscription ${lifecycle} cannot settle before activation.`,
    );
  }
}

function ignoredStale(subscription: CreditSubscription) {
  return { ...subscription, settlementStatus: 'ignored_stale' as const };
}
