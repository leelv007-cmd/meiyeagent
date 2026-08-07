/**
 * Entitlement / pool status surfaces for admin (J4 consuming H1 contracts).
 *
 * Presentation only: EntitlementPolicy revision, AccountAllocation list,
 * SupplyPool status. Does not re-implement H1 resolvers — projects provided
 * records into operator language.
 */
import type { SupplyPool } from '@meiye/contracts';

import type {
  AccountAllocationStatus,
  AccountAllocationStatusRecord,
  EntitlementPolicyStage,
  EntitlementPolicyStatusRecord,
  SupplyControlSnapshot,
} from './admin-supply-types';
import {
  admin_entitlement_draft_0f436818,
  admin_entitlement_effective_4de07ee0,
  admin_entitlement_expired_1354374f,
  admin_entitlement_product_concurrency,
  admin_entitlement_product_side_only_shows_entitlements_quo_266852c3,
  admin_entitlement_published_176a2eb4,
  admin_entitlement_rolled_back_c4ab8c16,
  admin_entitlement_superseded_d424f501,
  admin_entitlement_supply_concurrency,
} from '@/locale/paraglide/messages';

export type {
  AccountAllocationStatus,
  AccountAllocationStatusRecord,
  EntitlementPolicyStage,
  EntitlementPolicyStatusRecord,
} from './admin-supply-types';

export interface SupplyPoolStatusRecord {
  id: string;
  displayName: string;
  kind: SupplyPool['kind'];
  revisionId: string;
  deploymentCount: number;
  credentialCount: number;
  capacityLabel: string;
  status: 'healthy' | 'constrained' | 'unknown';
}

export type EntitlementCountEnvelope =
  | { status: 'known'; value: number }
  | { status: 'unknown'; reason: string };

export interface EntitlementStatusView {
  policies: EntitlementPolicyStatusRecord[];
  allocations: AccountAllocationStatusRecord[];
  pools: SupplyPoolStatusRecord[];
  /** Product-side surfaces only — never upstream token/balance keys. */
  dualTruthNote: string;
  publishedPolicyCount: EntitlementCountEnvelope;
  activeAllocationCount: EntitlementCountEnvelope;
  supplyPoolCount: EntitlementCountEnvelope;
}

export interface EntitlementStatusInput {
  policies?: EntitlementPolicyStatusRecord[];
  allocations?: AccountAllocationStatusRecord[];
  pools?: SupplyPool[];
  snapshot?: SupplyControlSnapshot;
}

function poolCapacityLabel(pool: SupplyPool): string {
  const s = pool.capacity?.supplyAccount;
  const p = pool.capacity?.productAccount;
  const parts: string[] = [];
  if (s?.concurrency != null)
    parts.push(admin_entitlement_supply_concurrency({ count: s.concurrency }));
  if (p?.concurrency != null)
    parts.push(admin_entitlement_product_concurrency({ count: p.concurrency }));
  if (s?.rpm != null) parts.push(`rpm ${s.rpm}`);
  return parts.length > 0 ? parts.join(' · ') : 'unknown (capacity_absent)';
}

function projectPools(pools: SupplyPool[]): SupplyPoolStatusRecord[] {
  return pools.map((pool) => {
    const concurrency = pool.capacity?.supplyAccount?.concurrency;
    let status: SupplyPoolStatusRecord['status'] = 'unknown';
    if (typeof concurrency === 'number') {
      status = concurrency > 0 ? 'healthy' : 'constrained';
    }
    return {
      id: pool.id,
      displayName: pool.displayName,
      kind: pool.kind,
      revisionId: pool.revisionId,
      deploymentCount: pool.deploymentIds.length,
      credentialCount: pool.credentialAccountIds.length,
      capacityLabel: poolCapacityLabel(pool),
      status,
    };
  });
}

export function buildEntitlementStatusView(
  input: EntitlementStatusInput = {}
): EntitlementStatusView {
  const sourcePolicies = input.policies ?? input.snapshot?.entitlementPolicies;
  const sourceAllocations =
    input.allocations ?? input.snapshot?.accountAllocations;
  const policies = sourcePolicies ?? [];
  const allocations = sourceAllocations ?? [];
  const sourcePools = input.pools ?? input.snapshot?.pools;
  const pools = projectPools(sourcePools ?? []);

  return {
    policies,
    allocations,
    pools,
    dualTruthNote:
      admin_entitlement_product_side_only_shows_entitlements_quo_266852c3(),
    publishedPolicyCount: sourcePolicies
      ? {
          status: 'known',
          value: policies.filter((p) => p.stage === 'published').length,
        }
      : {
          status: 'unknown',
          reason: 'entitlement_policy_reporter_not_wired',
        },
    activeAllocationCount: sourceAllocations
      ? {
          status: 'known',
          value: allocations.filter((a) => a.status === 'active').length,
        }
      : {
          status: 'unknown',
          reason: 'account_allocation_reporter_not_wired',
        },
    supplyPoolCount: sourcePools
      ? { status: 'known', value: pools.length }
      : {
          status: 'unknown',
          reason: 'supply_pool_snapshot_not_available',
        },
  };
}

export function entitlementPolicyStageLabel(
  stage: EntitlementPolicyStage
): string {
  switch (stage) {
    case 'draft':
      return admin_entitlement_draft_0f436818();
    case 'published':
      return admin_entitlement_published_176a2eb4();
    case 'superseded':
      return admin_entitlement_superseded_d424f501();
    case 'rolled_back':
      return admin_entitlement_rolled_back_c4ab8c16();
    default:
      return stage;
  }
}

export function allocationStatusLabel(status: AccountAllocationStatus): string {
  switch (status) {
    case 'active':
      return admin_entitlement_effective_4de07ee0();
    case 'expired':
      return admin_entitlement_expired_1354374f();
    case 'rolled_back':
      return admin_entitlement_rolled_back_c4ab8c16();
    default:
      return status;
  }
}
