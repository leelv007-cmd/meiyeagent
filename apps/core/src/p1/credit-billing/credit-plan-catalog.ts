export const CREDIT_PLAN_IDS = ['trial', 'starter', 'growth', 'pro'] as const;
export type CreditPlanId = (typeof CREDIT_PLAN_IDS)[number];

export interface CreditPlanOffer {
  id: CreditPlanId;
  credits: number;
  concurrencyLimit: number;
  queuePriority: number;
  supportLabel: 'standard' | 'priority';
}

export interface CreditAddOnOffer {
  id: string;
  credits: number;
  amountMicros: number;
  currency: string;
  expireDays: number;
}

export interface CreditPlanCatalog {
  plans: CreditPlanOffer[];
  addOns: CreditAddOnOffer[];
  trialEnabled: boolean;
}

/**
 * Operator-managed defaults. Running values are read from `plan.credits.*`
 * admin-config revisions; this literal only makes an empty installation usable.
 */
export const DEFAULT_CREDIT_PLAN_CATALOG: CreditPlanCatalog = {
  plans: [
    {
      id: 'trial',
      credits: 100,
      concurrencyLimit: 1,
      queuePriority: 1,
      supportLabel: 'standard',
    },
    {
      id: 'starter',
      credits: 500,
      concurrencyLimit: 1,
      queuePriority: 1,
      supportLabel: 'standard',
    },
    {
      id: 'growth',
      credits: 1_300,
      concurrencyLimit: 4,
      queuePriority: 5,
      supportLabel: 'priority',
    },
    {
      id: 'pro',
      credits: 2_800,
      concurrencyLimit: 8,
      queuePriority: 10,
      supportLabel: 'priority',
    },
  ],
  addOns: [
    {
      id: 'credits-100',
      credits: 100,
      amountMicros: 49_000_000,
      currency: 'CNY',
      expireDays: 7,
    },
    {
      id: 'credits-300',
      credits: 300,
      amountMicros: 139_000_000,
      currency: 'CNY',
      expireDays: 7,
    },
    {
      id: 'credits-1000',
      credits: 1_000,
      amountMicros: 429_000_000,
      currency: 'CNY',
      expireDays: 7,
    },
  ],
  trialEnabled: true,
};

export function creditPlanConfigKey(plan: CreditPlanId) {
  return `plan.credits.${plan}` as const;
}
