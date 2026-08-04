import {
  DEFAULT_ADD_ON_OFFERS,
  DEFAULT_PLAN_OFFERS,
  type AddOnOffer,
  type PlanOffer,
} from '../foundation/entitlement-module.js';
import type { AdminConfigRepository } from './foundation-module.js';
import type { PaymentMappingConfig } from '../foundation/payment-mapping.js';

const GLOBAL_WORKSPACE_ID = '__global__';

/**
 * Cutover-only entitlement catalogue projection.
 *
 * Merchant billing truth is `plan.credits.*` via CreditBillingService. This
 * source no longer hot-reads retired multi-bucket plan keys (#311 / credit
 * billing-spec §2, §8). It only supplies:
 * - static DEFAULT_PLAN_OFFERS seed (legacy modality scaffolding for provision)
 * - trial enabled flag
 * - payment product → tier mapping for settlement
 */
export class AdminConfigEntitlementCatalogSource {
  constructor(private readonly repository: AdminConfigRepository) {}

  async get(): Promise<{
    plans: PlanOffer[];
    addOns: AddOnOffer[];
    trialEnabled: boolean;
  }> {
    const [addOns, trialEnabled, trialCreditsEnabled] = await Promise.all([
      this.repository.get('global', GLOBAL_WORKSPACE_ID, 'plan.addons'),
      this.repository.get('global', GLOBAL_WORKSPACE_ID, 'plan.trial.enabled'),
      this.repository.get(
        'global',
        GLOBAL_WORKSPACE_ID,
        'plan.credits.trial.enabled',
      ),
    ]);
    const trialFlag =
      typeof trialCreditsEnabled?.value === 'boolean'
        ? trialCreditsEnabled.value
        : typeof trialEnabled?.value === 'boolean'
          ? trialEnabled.value
          : true;
    return {
      plans: structuredClone(DEFAULT_PLAN_OFFERS),
      addOns: structuredClone(
        (addOns?.value as AddOnOffer[] | undefined) ?? DEFAULT_ADD_ON_OFFERS,
      ),
      trialEnabled: trialFlag,
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
