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
  starter: PlanAllowances;
  growth: PlanAllowances;
  pro: PlanAllowances;
}

export const defaultProductPlanConfig: ProductPlanConfig = {
  starter: {
    content: 30,
    image: 10,
    video: 5,
    package: 20,
    storageMb: 1024,
    concurrencyLimit: 1,
    queuePriority: 1,
    supportLabel: 'standard',
  },
  growth: {
    content: 100,
    image: 40,
    video: 20,
    package: 80,
    storageMb: 5120,
    concurrencyLimit: 4,
    queuePriority: 5,
    supportLabel: 'priority',
  },
  pro: {
    content: 300,
    image: 120,
    video: 60,
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
  prefix: 'STARTER' | 'GROWTH' | 'PRO',
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
    starter: planFromEnv(env, 'STARTER', defaultProductPlanConfig.starter),
    growth: planFromEnv(env, 'GROWTH', defaultProductPlanConfig.growth),
    pro: planFromEnv(env, 'PRO', defaultProductPlanConfig.pro),
  };
}
