import type {
  ProductEntitlementPolicy,
  ProductEntitlementPolicyPort,
} from '../foundation/entitlement-policy.js';
import type { CreditPlanCatalog } from './credit-plan-catalog.js';
import {
  CREDIT_SUBSCRIPTION_GRACE_PERIOD_MS,
  currentCreditSubscriptionCycle,
  creditSubscriptionTierForCycle,
  type CreditSubscription,
  type CreditSubscriptionStore,
} from './credit-subscription-scheduler.js';

/** Resolves only non-credit product rights from the current paid subscription. */
export class CreditSubscriptionEntitlementPolicy
  implements ProductEntitlementPolicyPort
{
  constructor(
    private readonly subscriptions: Pick<
      CreditSubscriptionStore,
      'listForWorkspace'
    >,
    private readonly plans: { get(): Promise<CreditPlanCatalog> },
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async resolve(workspaceId: string): Promise<ProductEntitlementPolicy | null> {
    const now = this.clock();
    const subscription = (await this.subscriptions.listForWorkspace(workspaceId))
      .filter((candidate) => hasCurrentPaidRights(candidate, now))
      .sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || right.id.localeCompare(left.id)
      )[0];
    const tier = subscription
      ? creditSubscriptionTierForCycle(
          subscription,
          subscription.status === 'past_due'
            ? Math.max(0, subscription.paidThroughCycle - 1)
            : currentCreditSubscriptionCycle(
                subscription,
                now.toISOString(),
              )!.cycleIndex,
        )
      : 'trial';
    const plan = (await this.plans.get()).plans.find(
      (candidate) => candidate.id === tier,
    );
    if (!plan) return null;

    return {
      addOns: [],
      allowance: { audio: 0, copy: 0, image: 0, video: 0 },
      autoTopUp: {
        enabled: false,
        monthlyCapMicros: 0,
        spentThisMonthMicros: 0,
      },
      concurrencyLimit: plan.concurrencyLimit,
      queuePriority: plan.queuePriority,
      revision: subscription
        ? `credit-entitlement:${subscription.id}:${subscription.updatedAt}`
        : `credit-entitlement:default:${workspaceId}`,
      supportLabel: plan.supportLabel,
      storageMb: plan.storageMb,
      tier,
    };
  }
}

function hasCurrentPaidRights(subscription: CreditSubscription, now: Date) {
  const nowMs = now.getTime();
  if (subscription.status === 'past_due') {
    return Boolean(
      subscription.pastDueAt &&
        nowMs <
          Date.parse(subscription.pastDueAt) +
            CREDIT_SUBSCRIPTION_GRACE_PERIOD_MS,
    );
  }
  if (subscription.status !== 'active' || subscription.paidThroughCycle < 1) {
    return false;
  }
  return currentCreditSubscriptionCycle(subscription, now.toISOString()) !== null;
}
