import {
  DEFAULT_ADD_ON_OFFERS,
  DEFAULT_PLAN_OFFERS,
  type AddOnOffer,
  type PlanOffer,
} from '../foundation/entitlement-module.js';
import type { AdminConfigRepository } from './foundation-module.js';
import type { PaymentMappingConfig } from '../foundation/payment-mapping.js';

const GLOBAL_WORKSPACE_ID = '__global__';
const PLAN_IDS = ['trial', 'starter', 'growth', 'pro'] as const;

export class AdminConfigEntitlementCatalogSource {
  constructor(private readonly repository: AdminConfigRepository) {}

  async get(): Promise<{ plans: PlanOffer[]; addOns: AddOnOffer[] }> {
    const [trial, starter, growth, pro, addOns] = await Promise.all([
      this.repository.get(
        'global',
        GLOBAL_WORKSPACE_ID,
        'plan.allowances.trial',
      ),
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
    const revisions: Record<(typeof PLAN_IDS)[number], typeof trial> = {
      trial,
      starter,
      growth,
      pro,
    };
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

  async getPaymentMapping(): Promise<PaymentMappingConfig | null> {
    const revision = await this.repository.get(
      'global',
      GLOBAL_WORKSPACE_ID,
      'plan.payment-mapping',
    );
    return (revision?.value as PaymentMappingConfig | undefined) ?? null;
  }
}
