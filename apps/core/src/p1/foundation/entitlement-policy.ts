import type { GenerationOpeningEntitlement } from './application-service.js';
import type { UsageResource } from './domain.js';

export interface ProductEntitlementPolicy {
  revision: string;
  tier: 'starter' | 'growth' | 'pro';
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

/** Actor-independent read seam shared by managed and strict-BYOK execution. */
export interface ProductEntitlementPolicyPort {
  resolve(workspaceId: string): Promise<ProductEntitlementPolicy | null>;
}

export interface ProductEntitlementSupplement {
  revision: string;
  policy: ProductEntitlementPolicy | null;
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
    const base =
      productPolicy && !productIsBootstrap
        ? productPolicy
        : ((this.options.allowFoundationPlan ? supplement.policy : null) ??
          productPolicy);
    if (!base) return null;
    const useFoundationSupplements =
      this.options.allowFoundationSupplements === true;
    return {
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
    };
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
