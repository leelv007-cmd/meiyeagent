import {
  P1DomainError,
  REGISTER_GIFT_GRANT_KEY,
  type P1Context,
  type ProductEntitlementProjection,
  type UsageResource,
} from './domain.js';
import type { ProductEntitlementApplicationService } from './entitlement-service.js';
import {
  DEFAULT_PLAN_OFFERS,
  WORKSPACE_PROVISION_TRIAL_KEY,
  periodForOffer,
  type PlanOffer,
} from './entitlement-module.js';

export type PlatformDefaultModelConfigKey = UsageResource;
export type PlatformDefaultModelOperation =
  | 'copy.generate'
  | 'image.generate'
  | 'video.generate'
  | 'audio.speech';

const PREFERENCE_OPERATION_BY_CONFIG_KEY: Record<
  PlatformDefaultModelConfigKey,
  PlatformDefaultModelOperation
> = {
  audio: 'audio.speech',
  copy: 'copy.generate',
  image: 'image.generate',
  video: 'video.generate',
};

export interface PlatformDefaultModelPort {
  /**
   * Resolve platform-configured default catalog model ids.
   * Must NOT copy tenant probe evidence or BYOK credentials (GL-16).
   */
  getDefaults(): Promise<
    Partial<Record<PlatformDefaultModelConfigKey, string>>
  >;
  validateDefault(
    operation: PlatformDefaultModelOperation,
    modelId: string
  ): Promise<void>;
  setWorkspaceDefault(
    workspaceId: string,
    operation: PlatformDefaultModelOperation,
    modelId: string
  ): Promise<void>;
}

/**
 * Trusted workspace bootstrap provisioning (Tb).
 * Trial and model defaults use separate stable idempotency keys so either step
 * can retry independently without half-open tenants.
 */
export class WorkspaceProvisionService {
  constructor(
    private readonly entitlements: ProductEntitlementApplicationService,
    private readonly options: {
      clock?: () => Date;
      catalog?: { get(): Promise<{ plans: PlanOffer[] }> };
      modelDefaults?: PlatformDefaultModelPort;
    } = {}
  ) {}

  async provisionTrial(
    context: P1Context,
    idempotencyKey = WORKSPACE_PROVISION_TRIAL_KEY
  ): Promise<ProductEntitlementProjection> {
    const catalog = this.options.catalog
      ? await this.options.catalog.get()
      : { plans: DEFAULT_PLAN_OFFERS };
    const trialOffer = catalog.plans.find((plan) => plan.id === 'trial');
    if (!trialOffer) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Trial plan offer is not configured.'
      );
    }
    const period = periodForOffer(
      trialOffer,
      this.options.clock ?? (() => new Date())
    );
    const { id: tier, expireDays: _e, periodStrategy: _s, ...definition } =
      trialOffer;
    return this.entitlements.activatePlan(
      context,
      {
        paymentEventId: `register-gift-${context.workspaceId}`,
        grantKey: REGISTER_GIFT_GRANT_KEY,
        policy: {
          ...structuredClone(definition),
          tier,
          revision: `register-gift-${tier}-${period.periodId}`,
          periodId: period.periodId,
          periodStartsAt: period.periodStartsAt,
          periodEndsAt: period.periodEndsAt,
          periodStrategy: period.periodStrategy,
        },
      },
      idempotencyKey
    );
  }

  async provisionModelDefaults(context: P1Context): Promise<{
    defaults: Partial<Record<PlatformDefaultModelConfigKey, string>>;
    applied: boolean;
  }> {
    if (!this.options.modelDefaults) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Platform default models are not configured.',
      );
    }
    const catalog = this.options.catalog
      ? await this.options.catalog.get()
      : { plans: DEFAULT_PLAN_OFFERS };
    const trialOffer = catalog.plans.find((plan) => plan.id === 'trial');
    if (!trialOffer) {
      throw new P1DomainError(
        'INVALID_STATE',
        'Trial plan offer is not configured.',
      );
    }
    const defaults = await this.options.modelDefaults.getDefaults();
    const configured: Partial<Record<PlatformDefaultModelConfigKey, string>> =
      {};
    const configKeys = ['copy', 'image', 'video', 'audio'] as const;
    for (const configKey of configKeys) {
      const modelId = defaults[configKey]?.trim();
      if (modelId) {
        configured[configKey] = modelId;
        continue;
      }
      // A modality without trial allowance must not block Day-0 provisioning
      // when the platform has no default configured for it (e.g. audio: 0).
      if (trialOffer.allowance[configKey] > 0) {
        throw new P1DomainError(
          'INVALID_STATE',
          `Platform default model ${configKey} is not configured.`,
        );
      }
    }
    const configuredKeys = configKeys.filter(
      (configKey) => configured[configKey] !== undefined,
    );
    for (const configKey of configuredKeys) {
      await this.options.modelDefaults.validateDefault(
        PREFERENCE_OPERATION_BY_CONFIG_KEY[configKey],
        configured[configKey]!,
      );
    }
    for (const configKey of configuredKeys) {
      await this.options.modelDefaults.setWorkspaceDefault(
        context.workspaceId,
        PREFERENCE_OPERATION_BY_CONFIG_KEY[configKey],
        configured[configKey]!,
      );
    }
    return { defaults: configured, applied: true };
  }
}
