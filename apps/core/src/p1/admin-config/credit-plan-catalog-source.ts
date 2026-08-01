import {
  CREDIT_PLAN_IDS,
  DEFAULT_CREDIT_PLAN_CATALOG,
  type CreditAddOnOffer,
  type CreditPlanOffer,
} from '../credit-billing/credit-plan-catalog.js';

const GLOBAL_WORKSPACE_ID = '__global__';

export interface CreditPlanConfigRepository {
  get(
    scope: 'global',
    workspaceId: string,
    key: string,
  ): Promise<{ value: unknown } | null>;
}

/**
 * Credit billing reads only these revisioned admin-config keys. The former
 * resource allowance catalogue intentionally has no fallback in this source.
 */
export class AdminConfigCreditPlanCatalogSource {
  constructor(private readonly repository: CreditPlanConfigRepository) {}

  async get() {
    const [trial, starter, growth, pro, addOns, trialEnabled] =
      await Promise.all([
        this.repository.get('global', GLOBAL_WORKSPACE_ID, 'plan.credits.trial'),
        this.repository.get('global', GLOBAL_WORKSPACE_ID, 'plan.credits.starter'),
        this.repository.get('global', GLOBAL_WORKSPACE_ID, 'plan.credits.growth'),
        this.repository.get('global', GLOBAL_WORKSPACE_ID, 'plan.credits.pro'),
        this.repository.get('global', GLOBAL_WORKSPACE_ID, 'plan.credits.addons'),
        this.repository.get(
          'global',
          GLOBAL_WORKSPACE_ID,
          'plan.credits.trial.enabled',
        ),
      ]);
    const configured = { trial, starter, growth, pro } as const;
    return {
      plans: DEFAULT_CREDIT_PLAN_CATALOG.plans.map((fallback) => ({
        ...fallback,
        ...(configured[fallback.id]?.value as
          | Omit<CreditPlanOffer, 'id'>
          | undefined),
        id: fallback.id,
      })),
      addOns: structuredClone(
        (addOns?.value as CreditAddOnOffer[] | undefined) ??
          DEFAULT_CREDIT_PLAN_CATALOG.addOns,
      ),
      trialEnabled:
        typeof trialEnabled?.value === 'boolean'
          ? trialEnabled.value
          : DEFAULT_CREDIT_PLAN_CATALOG.trialEnabled,
    };
  }

  async planFor(id: (typeof CREDIT_PLAN_IDS)[number]) {
    const catalog = await this.get();
    const plan = catalog.plans.find((candidate) => candidate.id === id);
    if (!plan) throw new Error(`Credit plan ${id} is not configured.`);
    return plan;
  }
}
