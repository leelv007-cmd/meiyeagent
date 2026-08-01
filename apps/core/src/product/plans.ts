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

/** Historical defaults used only to normalize legacy ProductState reads. */
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
