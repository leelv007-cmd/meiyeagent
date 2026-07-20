/**
 * Entitlement / pool status surfaces for admin (J4 consuming H1 contracts).
 *
 * Presentation only: EntitlementPolicy revision, AccountAllocation list,
 * SupplyPool status. Does not re-implement H1 resolvers — projects provided
 * (or fixture) records into operator language.
 */
import type { SupplyPool } from '@meiye/contracts';

import { buildDefaultSupplyControlSnapshot } from './admin-supply-fixture';
import type { SupplyControlSnapshot } from './admin-supply-types';

/** H1-shaped presentation records (frontend-local; Core owns persistence). */
export type EntitlementPolicyStage =
  | 'draft'
  | 'published'
  | 'superseded'
  | 'rolled_back';

export interface EntitlementPolicyStatusRecord {
  id: string;
  tier: string;
  revision: number;
  stage: EntitlementPolicyStage;
  revisionId: string;
  concurrencyLimit: number;
  queuePriority: number;
  supportLabel: 'standard' | 'priority';
  allowanceSummary: string;
  publishedAt?: string;
  actorId?: string;
  reason?: string;
}

export type AccountAllocationStatus = 'active' | 'expired' | 'rolled_back';

export interface AccountAllocationStatusRecord {
  id: string;
  accountId: string;
  workspaceId: string;
  kind: 'grant' | 'restrict';
  targetLabel: string;
  source: string;
  status: AccountAllocationStatus;
  reason: string;
  startsAt: string;
  endsAt: string | null;
}

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

export interface EntitlementStatusView {
  policies: EntitlementPolicyStatusRecord[];
  allocations: AccountAllocationStatusRecord[];
  pools: SupplyPoolStatusRecord[];
  /** Product-side surfaces only — never upstream token/balance keys. */
  dualTruthNote: string;
  publishedPolicyCount: number;
  activeAllocationCount: number;
}

export interface EntitlementStatusInput {
  policies?: EntitlementPolicyStatusRecord[];
  allocations?: AccountAllocationStatusRecord[];
  pools?: SupplyPool[];
  snapshot?: SupplyControlSnapshot;
}

const DEFAULT_POLICIES: EntitlementPolicyStatusRecord[] = [
  {
    id: 'policy-pro',
    tier: 'pro',
    revision: 4,
    stage: 'published',
    revisionId: 'entitlement-policy-pro:r4',
    concurrencyLimit: 8,
    queuePriority: 50,
    supportLabel: 'priority',
    allowanceSummary: 'copy 2000 · image 400 · video 60s',
    publishedAt: '2026-07-10T00:00:00.000Z',
    actorId: 'admin-1',
    reason: 'Q3 plan publish',
  },
  {
    id: 'policy-starter',
    tier: 'starter',
    revision: 2,
    stage: 'published',
    revisionId: 'entitlement-policy-starter:r2',
    concurrencyLimit: 2,
    queuePriority: 10,
    supportLabel: 'standard',
    allowanceSummary: 'copy 300 · image 40 · video 0',
    publishedAt: '2026-06-01T00:00:00.000Z',
  },
  {
    id: 'policy-pro-draft',
    tier: 'pro',
    revision: 5,
    stage: 'draft',
    revisionId: 'entitlement-policy-pro:r5-draft',
    concurrencyLimit: 10,
    queuePriority: 60,
    supportLabel: 'priority',
    allowanceSummary: 'copy 2500 · image 500 · video 90s',
  },
];

const DEFAULT_ALLOCATIONS: AccountAllocationStatusRecord[] = [
  {
    id: 'alloc-1',
    accountId: 'acct-pro',
    workspaceId: 'ws-pro',
    kind: 'grant',
    targetLabel: 'supply_pool:pool-shared-default',
    source: 'enterprise_contract',
    status: 'active',
    reason: 'enterprise reserved concurrency',
    startsAt: '2026-07-01T00:00:00.000Z',
    endsAt: null,
  },
  {
    id: 'alloc-2',
    accountId: 'acct-demo',
    workspaceId: 'ws-demo',
    kind: 'restrict',
    targetLabel: 'catalog_model:model-image-single',
    source: 'risk_control',
    status: 'active',
    reason: 'single-channel image temporary restrict',
    startsAt: '2026-07-18T00:00:00.000Z',
    endsAt: '2026-08-18T00:00:00.000Z',
  },
  {
    id: 'alloc-3',
    accountId: 'acct-old',
    workspaceId: 'ws-old',
    kind: 'grant',
    targetLabel: 'allowance:image',
    source: 'campaign',
    status: 'expired',
    reason: 'summer campaign expired',
    startsAt: '2026-05-01T00:00:00.000Z',
    endsAt: '2026-06-01T00:00:00.000Z',
  },
];

function poolCapacityLabel(pool: SupplyPool): string {
  const s = pool.capacity?.supplyAccount;
  const p = pool.capacity?.productAccount;
  const parts: string[] = [];
  if (s?.concurrency != null) parts.push(`supply并发 ${s.concurrency}`);
  if (p?.concurrency != null) parts.push(`产品并发 ${p.concurrency}`);
  if (s?.rpm != null) parts.push(`rpm ${s.rpm}`);
  return parts.length > 0 ? parts.join(' · ') : 'unknown (capacity_absent)';
}

function projectPools(
  pools: SupplyPool[],
): SupplyPoolStatusRecord[] {
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
  input: EntitlementStatusInput = {},
): EntitlementStatusView {
  const snapshot = input.snapshot ?? buildDefaultSupplyControlSnapshot();
  const policies = input.policies ?? DEFAULT_POLICIES;
  const allocations = input.allocations ?? DEFAULT_ALLOCATIONS;
  const pools = projectPools(input.pools ?? snapshot.pools);

  return {
    policies,
    allocations,
    pools,
    dualTruthNote:
      '产品侧只展示权益/额度/并发/可选池；上游 token、账号余额、RPM 不出现在用户投影。',
    publishedPolicyCount: policies.filter((p) => p.stage === 'published')
      .length,
    activeAllocationCount: allocations.filter((a) => a.status === 'active')
      .length,
  };
}

export function entitlementPolicyStageLabel(
  stage: EntitlementPolicyStage,
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

export function allocationStatusLabel(
  status: AccountAllocationStatus,
): string {
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
