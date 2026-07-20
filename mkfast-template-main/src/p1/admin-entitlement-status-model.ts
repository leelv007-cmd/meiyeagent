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
  if (s?.concurrency != null) parts.push(`supply并发 ${s.concurrency}`);
  if (p?.concurrency != null) parts.push(`产品并发 ${p.concurrency}`);
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
      '产品侧只展示权益/额度/并发/可选池；上游 token、账号余额、RPM 不出现在用户投影。',
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
      return '草稿';
    case 'published':
      return '已发布';
    case 'superseded':
      return '已替代';
    case 'rolled_back':
      return '已回滚';
    default:
      return stage;
  }
}

export function allocationStatusLabel(status: AccountAllocationStatus): string {
  switch (status) {
    case 'active':
      return '生效中';
    case 'expired':
      return '已过期';
    case 'rolled_back':
      return '已回滚';
    default:
      return status;
  }
}
