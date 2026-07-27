export interface PlanAllowances {
  content: number;
  image: number;
  video: number;
  package: number;
  storageMb: number;
  concurrencyLimit: number;
  queuePriority: number;
  supportLabel: 'standard' | 'priority';
}

export interface ProductPlanConfig {
  trial: PlanAllowances;
  starter: PlanAllowances;
  growth: PlanAllowances;
  pro: PlanAllowances;
}

/**
 * P0 ProductState quotas. Kept in step with the D-123 seed the P1 entitlement
 * catalogue publishes (`DEFAULT_PLAN_OFFERS`) so the two layers never state
 * different 文案/图片/视频 numbers about the same plan — the merchant-visible
 * truth is the `plan.allowances.*` admin-config key either way (D-143).
 * `package`/`storageMb` have no D-123 counterpart and stay as they were.
 */
export const defaultProductPlanConfig: ProductPlanConfig = {
  trial: {
    content: 5,
    image: 5,
    video: 1,
    package: 10,
    storageMb: 512,
    concurrencyLimit: 1,
    queuePriority: 0,
    supportLabel: 'standard',
  },
  starter: {
    content: 100,
    image: 40,
    video: 3,
    package: 20,
    storageMb: 1024,
    concurrencyLimit: 1,
    queuePriority: 1,
    supportLabel: 'standard',
  },
  growth: {
    content: 300,
    image: 100,
    video: 6,
    package: 80,
    storageMb: 5120,
    concurrencyLimit: 4,
    queuePriority: 5,
    supportLabel: 'priority',
  },
  pro: {
    content: 600,
    image: 180,
    video: 9,
    package: 240,
    storageMb: 20480,
    concurrencyLimit: 8,
    queuePriority: 10,
    supportLabel: 'priority',
  },
};

function allowance(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function planFromEnv(
  env: NodeJS.ProcessEnv,
  prefix: 'TRIAL' | 'STARTER' | 'GROWTH' | 'PRO',
  fallback: PlanAllowances,
): PlanAllowances {
  return {
    content: allowance(env[`${prefix}_CONTENT_ALLOWANCE`], fallback.content),
    image: allowance(env[`${prefix}_IMAGE_ALLOWANCE`], fallback.image),
    video: allowance(env[`${prefix}_VIDEO_ALLOWANCE`], fallback.video),
    package: allowance(env[`${prefix}_PACKAGE_ALLOWANCE`], fallback.package),
    storageMb: allowance(env[`${prefix}_STORAGE_MB`], fallback.storageMb),
    concurrencyLimit: allowance(
      env[`${prefix}_CONCURRENCY_LIMIT`],
      fallback.concurrencyLimit,
    ),
    queuePriority: allowance(
      env[`${prefix}_QUEUE_PRIORITY`],
      fallback.queuePriority,
    ),
    supportLabel: fallback.supportLabel,
  };
}

export function productPlanConfigFromEnv(env: NodeJS.ProcessEnv): ProductPlanConfig {
  return {
    trial: planFromEnv(env, 'TRIAL', defaultProductPlanConfig.trial),
    starter: planFromEnv(env, 'STARTER', defaultProductPlanConfig.starter),
    growth: planFromEnv(env, 'GROWTH', defaultProductPlanConfig.growth),
    pro: planFromEnv(env, 'PRO', defaultProductPlanConfig.pro),
  };
}
