/**
 * Opening values for the governed `plan.credits.*` configuration revision set.
 * Runtime reads still come exclusively from admin-config; these values are used
 * only to create the first revision and to make an empty admin form truthful.
 */
export const CREDIT_PLAN_CONFIG_DEFAULTS = {
  'plan.credits.trial': {
    concurrencyLimit: 1,
    credits: 100,
    currency: 'CNY',
    monthlyPriceMicros: 0,
    queuePriority: 1,
    storageMb: 512,
    supportLabel: 'standard',
  },
  'plan.credits.starter': {
    concurrencyLimit: 1,
    credits: 500,
    currency: 'CNY',
    monthlyPriceMicros: 199_000_000,
    queuePriority: 1,
    storageMb: 1_024,
    supportLabel: 'standard',
  },
  'plan.credits.growth': {
    concurrencyLimit: 4,
    credits: 1_300,
    currency: 'CNY',
    monthlyPriceMicros: 499_000_000,
    queuePriority: 5,
    storageMb: 5_120,
    supportLabel: 'priority',
  },
  'plan.credits.pro': {
    concurrencyLimit: 8,
    credits: 2_800,
    currency: 'CNY',
    monthlyPriceMicros: 899_000_000,
    queuePriority: 10,
    storageMb: 20_480,
    supportLabel: 'priority',
  },
  'plan.credits.addons': [
    {
      amountMicros: 49_000_000,
      credits: 100,
      currency: 'CNY',
      expireDays: 7,
      id: 'credits-100',
    },
    {
      amountMicros: 139_000_000,
      credits: 300,
      currency: 'CNY',
      expireDays: 7,
      id: 'credits-300',
    },
    {
      amountMicros: 429_000_000,
      credits: 1_000,
      currency: 'CNY',
      expireDays: 7,
      id: 'credits-1000',
    },
  ],
  'plan.credits.cycle_coefficients': {
    monthly: 9_000,
    single_month: 10_000,
    yearly: 7_500,
  },
  'plan.credits.reference_numbers': {
    referenceModels: {
      copy: 'deepseek-v4-pro',
      image: 'seedream-5-pro',
      video: 'seedance-2',
    },
    published: {
      trial: { copy: 100, image: 20, video: 2 },
      starter: { copy: 500, image: 100, video: 10 },
      growth: { copy: 1_300, image: 260, video: 26 },
      pro: { copy: 2_800, image: 560, video: 56 },
    },
  },
  'plan.credits.trial.enabled': true,
} as const;

export const CREDIT_PLAN_CONFIG_KEYS = Object.keys(
  CREDIT_PLAN_CONFIG_DEFAULTS,
) as Array<keyof typeof CREDIT_PLAN_CONFIG_DEFAULTS>;
