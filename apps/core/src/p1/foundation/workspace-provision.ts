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

/**
 * Canonical platform-default-model vocabulary (#240①).
 *
 * Which model a workspace starts on is an operations decision (D-044: catalog
 * 运营参数后台可换), so the *value* lives in admin config under
 * `platform.defaultModel.<configKey>` and nowhere else. What lives here is the
 * vocabulary around that value — the four config keys, the operation each one
 * answers for, and the admin-config key spelling — so that provisioning, the
 * supply registry, boot wiring and the preferences projection all read the same
 * table instead of each keeping a private copy. A second copy is how a default
 * silently diverges from the one operations actually edited.
 */
const PLATFORM_DEFAULT_MODEL_DEFINITIONS = [
  ['copy', 'copy.generate'],
  ['image', 'image.generate'],
  ['video', 'video.generate'],
  ['audio', 'audio.speech'],
] as const satisfies readonly (
  readonly [PlatformDefaultModelConfigKey, PlatformDefaultModelOperation]
)[];

export const PLATFORM_DEFAULT_MODEL_CONFIG_KEYS =
  PLATFORM_DEFAULT_MODEL_DEFINITIONS.map(([configKey]) => configKey);

export const PLATFORM_DEFAULT_MODEL_OPERATION_BY_CONFIG_KEY =
  Object.fromEntries(PLATFORM_DEFAULT_MODEL_DEFINITIONS) as Record<
    PlatformDefaultModelConfigKey,
    PlatformDefaultModelOperation
  >;

export const PLATFORM_DEFAULT_MODEL_CONFIG_KEY_BY_OPERATION =
  Object.fromEntries(
    PLATFORM_DEFAULT_MODEL_DEFINITIONS.map(([configKey, operation]) => [
      operation,
      configKey,
    ]),
  ) as Record<PlatformDefaultModelOperation, PlatformDefaultModelConfigKey>;

/** The single admin-config key spelling for a platform default model. */
export function platformDefaultModelConfigName(
  configKey: PlatformDefaultModelConfigKey,
): string {
  return `platform.defaultModel.${configKey}`;
}

/**
 * Narrow an arbitrary model operation to the config key that owns its platform
 * default, or `undefined` when no platform default is defined for it. Callers
 * must not invent one — an operation without a configured default has no
 * default, which is the whole point of #240①.
 */
export function platformDefaultModelConfigKeyForOperation(
  operation: string,
): PlatformDefaultModelConfigKey | undefined {
  return PLATFORM_DEFAULT_MODEL_CONFIG_KEY_BY_OPERATION[
    operation as PlatformDefaultModelOperation
  ];
}

/** Source of the platform-configured default model ids (admin config in prod). */
export interface PlatformDefaultModelBinding {
  catalogModelId: string;
  configRevision: string;
}

export type PlatformDefaultModelSnapshot = Partial<
  Record<PlatformDefaultModelConfigKey, PlatformDefaultModelBinding>
>;

export interface PlatformDefaultModelSourcePort {
  getSnapshot(): Promise<PlatformDefaultModelSnapshot>;
}

const PREFERENCE_OPERATION_BY_CONFIG_KEY =
  PLATFORM_DEFAULT_MODEL_OPERATION_BY_CONFIG_KEY;

export interface PlatformDefaultModelPort {
  /**
   * Resolve platform-configured default catalog model ids.
   * Must NOT copy tenant probe evidence or BYOK credentials (GL-16).
   */
  getSnapshot(): Promise<PlatformDefaultModelSnapshot>;
  validateDefault(
    operation: PlatformDefaultModelOperation,
    modelId: string
  ): Promise<void>;
  setWorkspaceDefault(
    workspaceId: string,
    operation: PlatformDefaultModelOperation,
    modelId: string,
    metadata: {
      origin: 'platform_default';
      platformConfigRevision: string;
    },
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
      catalog?: {
        get(): Promise<{ plans: PlanOffer[]; trialEnabled?: boolean }>;
      };
      modelDefaults?: PlatformDefaultModelPort;
      modelCatalogTenantAllowlist?: readonly string[];
      warn?: (message: string) => void;
    } = {}
  ) {}

  async provisionTrial(
    context: P1Context,
    idempotencyKey = WORKSPACE_PROVISION_TRIAL_KEY
  ): Promise<ProductEntitlementProjection> {
    const catalog = this.options.catalog
      ? await this.options.catalog.get()
      : { plans: DEFAULT_PLAN_OFFERS, trialEnabled: true };
    if (catalog.trialEnabled === false) {
      return this.entitlements.getProjection(context);
    }
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
    const tenantAllowlist = new Set(
      (this.options.modelCatalogTenantAllowlist ?? [])
        .map((workspaceId) => workspaceId.trim())
        .filter(Boolean),
    );
    if (
      tenantAllowlist.size > 0 &&
      !tenantAllowlist.has(context.workspaceId)
    ) {
      this.options.warn?.(
        `Platform model defaults were discarded because workspace ${context.workspaceId} is outside modelCatalogTenantAllowlist.`,
      );
      return { defaults: {}, applied: false };
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
    const snapshot = await this.options.modelDefaults.getSnapshot();
    const configured: Partial<Record<PlatformDefaultModelConfigKey, string>> =
      {};
    const configKeys = PLATFORM_DEFAULT_MODEL_CONFIG_KEYS;
    for (const configKey of configKeys) {
      const binding = snapshot[configKey];
      const modelId = binding?.catalogModelId.trim();
      const configRevision = binding?.configRevision.trim();
      if (modelId && configRevision) {
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
        {
          origin: 'platform_default',
          platformConfigRevision: snapshot[configKey]!.configRevision,
        },
      );
    }
    return { defaults: configured, applied: true };
  }
}
