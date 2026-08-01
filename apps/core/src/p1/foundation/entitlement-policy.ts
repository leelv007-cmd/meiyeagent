import type { GenerationOpeningEntitlement } from './application-service.js';
import type { UsageResource } from './domain.js';

/** Product-side quality / Auto selection preference (D-062). */
export type QualityTierPreference = 'auto' | 'quality' | 'balanced';

/** What happens when plan allowance is exhausted (product-side only). */
export type OverageMode = 'block' | 'allow_metered' | 'auto_top_up';

export interface OverageRule {
  mode: OverageMode;
}

export interface EntitlementValidityWindow {
  /** ISO timestamp; null = open start. */
  validFrom: string | null;
  /** ISO timestamp; null = open-ended. */
  validUntil: string | null;
}

/**
 * H1 extension fields for plan-bound EntitlementPolicy (D-063).
 * Optional on the wire so existing fixtures stay type-compatible; resolvers
 * always normalize via {@link normalizeProductEntitlementPolicy}.
 */
export interface ProductEntitlementPolicyExtension {
  /** CatalogModel ids the plan may use; empty = no plan-level model filter. */
  allowedCatalogModelIds: string[];
  /** Allowed quality tiers / Auto selection for the plan. */
  allowedQualityTiers: QualityTierPreference[];
  /** Product-side SupplyPool ids the plan may draw from. */
  availableSupplyPoolIds: string[];
  /** Overage behaviour when plan allowance is exhausted. */
  overage: OverageRule;
  /** Validity window of the published plan policy revision. */
  validity: EntitlementValidityWindow;
}

export const DEFAULT_ENTITLEMENT_POLICY_EXTENSION: ProductEntitlementPolicyExtension =
  {
    allowedCatalogModelIds: [],
    allowedQualityTiers: ['auto', 'quality', 'balanced'],
    availableSupplyPoolIds: [],
    overage: { mode: 'block' },
    validity: { validFrom: null, validUntil: null },
  };

export interface ProductEntitlementPolicy
  extends Partial<ProductEntitlementPolicyExtension>
{
  revision: string;
  tier: 'trial' | 'starter' | 'growth' | 'pro';
  /** Non-metered workspace storage ceiling; credit balance never changes it. */
  storageMb?: number;
  allowance: Record<UsageResource, number>;
  concurrencyLimit: number;
  queuePriority: number;
  supportLabel: 'standard' | 'priority';
  addOns: Array<{
    purchaseId: string;
    resource: UsageResource;
    quantity: number;
  }>;
  autoTopUp: {
    enabled: boolean;
    monthlyCapMicros: number;
    spentThisMonthMicros: number;
  };
}

/** Policy with H1 extension fields guaranteed present. */
export type NormalizedProductEntitlementPolicy = Omit<
  ProductEntitlementPolicy,
  keyof ProductEntitlementPolicyExtension
> &
  ProductEntitlementPolicyExtension;

/** Fill H1 extension defaults without dropping explicit values. */
export function normalizeProductEntitlementPolicy(
  policy: Omit<ProductEntitlementPolicy, keyof ProductEntitlementPolicyExtension> &
    Partial<ProductEntitlementPolicyExtension>
): NormalizedProductEntitlementPolicy {
  return {
    ...DEFAULT_ENTITLEMENT_POLICY_EXTENSION,
    ...policy,
    allowedCatalogModelIds: [
      ...(policy.allowedCatalogModelIds ??
        DEFAULT_ENTITLEMENT_POLICY_EXTENSION.allowedCatalogModelIds),
    ],
    allowedQualityTiers: [
      ...(policy.allowedQualityTiers ??
        DEFAULT_ENTITLEMENT_POLICY_EXTENSION.allowedQualityTiers),
    ],
    availableSupplyPoolIds: [
      ...(policy.availableSupplyPoolIds ??
        DEFAULT_ENTITLEMENT_POLICY_EXTENSION.availableSupplyPoolIds),
    ],
    overage: structuredClone(
      policy.overage ?? DEFAULT_ENTITLEMENT_POLICY_EXTENSION.overage
    ),
    validity: structuredClone(
      policy.validity ?? DEFAULT_ENTITLEMENT_POLICY_EXTENSION.validity
    ),
  };
}

/** Actor-independent read seam shared by managed and strict-BYOK execution. */
export interface ProductEntitlementPolicyPort {
  resolve(workspaceId: string): Promise<ProductEntitlementPolicy | null>;
}

export interface ProductEntitlementSupplement {
  revision: string;
  policy: ProductEntitlementPolicy | null;
  planState: 'none' | 'active' | 'expired';
  addOns: ProductEntitlementPolicy['addOns'];
  autoTopUp: ProductEntitlementPolicy['autoTopUp'];
}

export interface ProductEntitlementSupplementPort {
  resolveSupplement(
    workspaceId: string
  ): Promise<ProductEntitlementSupplement>;
}

export class CompositeProductEntitlementPolicy
  implements ProductEntitlementPolicyPort
{
  constructor(
    private readonly productState: ProductEntitlementPolicyPort,
    private readonly foundation: ProductEntitlementSupplementPort,
    private readonly options: {
      allowFoundationPlan?: boolean;
      allowFoundationSupplements?: boolean;
    } = {}
  ) {}

  async resolve(workspaceId: string): Promise<ProductEntitlementPolicy | null> {
    const [productPolicy, supplement] = await Promise.all([
      this.productState.resolve(workspaceId),
      this.foundation.resolveSupplement(workspaceId),
    ]);
    const productIsBootstrap =
      productPolicy?.revision.endsWith(':bootstrap') ?? false;
    const foundationPlan =
      supplement.policy?.tier === 'trial' || this.options.allowFoundationPlan
        ? supplement.policy
        : null;
    const base =
      productPolicy && !productIsBootstrap
        ? productPolicy
        : supplement.planState === 'expired'
          ? null
          : (foundationPlan ?? productPolicy);
    if (!base) return null;
    const useFoundationSupplements =
      this.options.allowFoundationSupplements === true;
    return normalizeProductEntitlementPolicy({
      ...structuredClone(base),
      addOns: structuredClone(
        useFoundationSupplements ? supplement.addOns : base.addOns
      ),
      autoTopUp: structuredClone(
        useFoundationSupplements ? supplement.autoTopUp : base.autoTopUp
      ),
      revision: `composite:${base.revision}:${
        useFoundationSupplements
          ? supplement.revision
          : 'foundation-supplements-disabled'
      }`,
    });
  }
}

export async function resolveGenerationOpeningEntitlement(
  policyPort: ProductEntitlementPolicyPort | undefined,
  workspaceId: string,
  resource: UsageResource,
): Promise<GenerationOpeningEntitlement | undefined> {
  const policy = await policyPort?.resolve(workspaceId);
  if (!policy) return undefined;
  const uniqueAddOns = new Map(
    policy.addOns
      .filter((addOn) => addOn.resource === resource)
      .map((addOn) => [addOn.purchaseId, addOn] as const),
  );
  const addOnQuantity = [...uniqueAddOns.values()].reduce(
    (sum, addOn) => sum + addOn.quantity,
    0,
  );
  const planAllowance = policy.allowance[resource];
  const amount = planAllowance + addOnQuantity;
  if (!Number.isInteger(amount) || amount <= 0) return undefined;
  return {
    id: `opening:${policy.revision}:${resource}`,
    amount,
    reason: [
      `plan_opening:${policy.tier}:${policy.revision}`,
      `plan_allowance=${planAllowance}`,
      `addons=${[...uniqueAddOns.keys()].sort().join(',') || 'none'}`,
      `addon_quantity=${addOnQuantity}`,
      `auto_top_up=${policy.autoTopUp.enabled ? 'owner_enabled' : 'disabled'}`,
      `monthly_cap_micros=${policy.autoTopUp.monthlyCapMicros}`,
    ].join(';'),
  };
}
