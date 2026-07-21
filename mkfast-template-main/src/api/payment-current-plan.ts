import type { PricePlan } from '@/payment/types';

export type CurrentPlanProjection = Pick<
  PricePlan,
  'id' | 'isFree' | 'isLifetime'
>;

export function projectCurrentPlan(
  plan: PricePlan | null
): CurrentPlanProjection | null {
  if (!plan) return null;
  return {
    id: plan.id,
    isFree: plan.isFree,
    isLifetime: plan.isLifetime,
  };
}
