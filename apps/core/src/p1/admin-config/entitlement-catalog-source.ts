import {
  DEFAULT_ADD_ON_OFFERS,
  DEFAULT_PLAN_OFFERS,
  type AddOnOffer,
  type PlanOffer,
} from '../foundation/entitlement-module.js';
import type { AdminConfigRepository } from './foundation-module.js';

const GLOBAL_WORKSPACE_ID = '__global__';

export class AdminConfigEntitlementCatalogSource {
  constructor(private readonly repository: AdminConfigRepository) {}

  async get(): Promise<{ plans: PlanOffer[]; addOns: AddOnOffer[] }> {
    const [starter, growth, pro, addOns] = await Promise.all([
      this.repository.get(
        'global',
        GLOBAL_WORKSPACE_ID,
        'plan.allowances.starter',
      ),
      this.repository.get(
        'global',
        GLOBAL_WORKSPACE_ID,
        'plan.allowances.growth',
      ),
      this.repository.get(
        'global',
        GLOBAL_WORKSPACE_ID,
        'plan.allowances.pro',
      ),
      this.repository.get('global', GLOBAL_WORKSPACE_ID, 'plan.addons'),
    ]);
    const revisions = { starter, growth, pro };
    return {
      plans: DEFAULT_PLAN_OFFERS.map((fallback) => {
        const configured = revisions[fallback.id]?.value as
          | Omit<PlanOffer, 'id'>
          | undefined;
        return {
          ...fallback,
          ...configured,
          allowance: {
            ...fallback.allowance,
            ...configured?.allowance,
          },
          id: fallback.id,
        };
      }),
      addOns: structuredClone(
        (addOns?.value as AddOnOffer[] | undefined) ?? DEFAULT_ADD_ON_OFFERS,
      ),
    };
  }
}
