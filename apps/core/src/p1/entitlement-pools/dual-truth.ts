import { P1DomainError } from '../foundation/domain.js';
import type { EffectiveEntitlement } from './contracts.js';
import {
  UPSTREAM_RESOURCE_KEYS,
  type ProductSideEntitlementProjection,
  type UpstreamResourceKey,
} from './contracts.js';
import type { ModelSelectionBoundary } from './model-selection-boundary.js';

/**
 * Project EffectiveEntitlement into the dual-truth product-side contract (D-061).
 * Never includes upstream tokens, accounts, or gateway balances.
 */
export function projectProductSideEntitlement(
  effective: EffectiveEntitlement,
  selectionBoundary: ModelSelectionBoundary
): ProductSideEntitlementProjection {
  const projection: ProductSideEntitlementProjection = {
    entitlement: {
      tier: effective.tier,
      revision: effective.planPolicyRevision,
      allowedCatalogModelIds: [...effective.allowedCatalogModelIds],
      allowedQualityTiers: [...effective.allowedQualityTiers],
    },
    usageAllowance: {
      allowance: structuredClone(effective.allowance),
      overage: structuredClone(effective.overage),
    },
    concurrencyPolicy: {
      concurrencyLimit: effective.concurrencyLimit,
      queuePriority: effective.queuePriority,
    },
    routePolicy: {
      availableSupplyPoolIds: [...effective.availableSupplyPoolIds],
      selectionBoundary:
        selectionBoundary.maySelectCatalogModel
          ? 'auto_catalog_and_deployment'
          : 'fixed_deployment_only',
    },
  };
  assertNoUpstreamResources(projection);
  return projection;
}

/**
 * Negative guard: product-side projections must never carry upstream resources.
 */
export function assertNoUpstreamResources(value: unknown): void {
  const offenders = collectUpstreamKeys(value, '');
  if (offenders.length > 0) {
    throw new P1DomainError(
      'INVALID_STATE',
      `Product-side entitlement projection must not include upstream resources: ${offenders.join(', ')}`
    );
  }
}

/**
 * Returns true when a proposed assignment would leak upstream resources to a user.
 * Used by negative tests for D-061 dual-truth.
 */
export function wouldAssignUpstreamResourceToUser(
  assignment: Record<string, unknown>
): boolean {
  return collectUpstreamKeys(assignment, '').length > 0;
}

function collectUpstreamKeys(value: unknown, path: string): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return value.flatMap((item, index) =>
      collectUpstreamKeys(item, `${path}[${index}]`)
    );
  }
  if (typeof value !== 'object') return [];
  const offenders: string[] = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const childPath = path ? `${path}.${key}` : key;
    if (isUpstreamKey(key)) {
      offenders.push(childPath);
      continue;
    }
    offenders.push(...collectUpstreamKeys(child, childPath));
  }
  return offenders;
}

function isUpstreamKey(key: string): key is UpstreamResourceKey {
  return (UPSTREAM_RESOURCE_KEYS as readonly string[]).includes(key);
}
