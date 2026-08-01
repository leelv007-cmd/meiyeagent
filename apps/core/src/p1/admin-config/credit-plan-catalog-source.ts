import {
  CREDIT_PLAN_IDS,
  type CreditAddOnOffer,
  type CreditPlanCatalog,
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
      plans: CREDIT_PLAN_IDS.map((id) => creditPlanFromConfig(
        id,
        configured[id]?.value,
      )),
      addOns: creditAddOnsFromConfig(addOns?.value),
      trialEnabled: creditTrialEnabledFromConfig(trialEnabled?.value),
    } satisfies CreditPlanCatalog;
  }

  async planFor(id: (typeof CREDIT_PLAN_IDS)[number]) {
    const catalog = await this.get();
    const plan = catalog.plans.find((candidate) => candidate.id === id);
    if (!plan) throw new Error(`Credit plan ${id} is not configured.`);
    return plan;
  }
}

function creditPlanFromConfig(
  id: (typeof CREDIT_PLAN_IDS)[number],
  value: unknown,
): CreditPlanOffer {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw missingCreditPlanConfig();
  }
  const plan = value as Omit<CreditPlanOffer, 'id'>;
  if (
    !positiveInteger(plan.credits) ||
    !positiveInteger(plan.storageMb) ||
    !positiveInteger(plan.concurrencyLimit) ||
    !positiveInteger(plan.queuePriority) ||
    (plan.supportLabel !== 'standard' && plan.supportLabel !== 'priority')
  ) {
    throw missingCreditPlanConfig();
  }
  return { ...plan, id };
}

function creditAddOnsFromConfig(value: unknown): CreditAddOnOffer[] {
  if (!Array.isArray(value)) throw missingCreditPlanConfig();
  const addOns = value as CreditAddOnOffer[];
  if (!addOns.every((offer) =>
    typeof offer.id === 'string' &&
    offer.id.trim().length > 0 &&
    positiveInteger(offer.credits) &&
    Number.isSafeInteger(offer.amountMicros) &&
    offer.amountMicros >= 0 &&
    /^[A-Z]{3}$/u.test(offer.currency) &&
    positiveInteger(offer.expireDays),
  )) {
    throw missingCreditPlanConfig();
  }
  return structuredClone(addOns);
}

function creditTrialEnabledFromConfig(value: unknown) {
  if (typeof value !== 'boolean') throw missingCreditPlanConfig();
  return value;
}

function positiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function missingCreditPlanConfig() {
  return new Error('Published credit plan configuration is incomplete or invalid.');
}
