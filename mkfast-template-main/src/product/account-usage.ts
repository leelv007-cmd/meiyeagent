import type { PublicCreditBalance } from '@meiye/contracts';

export type AccountUsageResource = 'copy' | 'image' | 'video' | 'audio';

interface AccountUsageBucket {
  allowance: number;
  available: number;
  committed: number;
  released: number;
  reserved: number;
}

export interface AccountUsageProjection {
  plan: {
    tier: 'trial' | 'starter' | 'growth' | 'pro';
    periodEndsAt?: string;
  } | null;
  usage: Record<AccountUsageResource, AccountUsageBucket>;
  /** Credit balance is authoritative; usage remains a cutover read shape. */
  credits?: PublicCreditBalance;
}

export function projectAccountUsage(projection: AccountUsageProjection) {
  return {
    summary: {
      expiresAt: projection.plan?.periodEndsAt ?? null,
      tier: projection.plan?.tier ?? null,
    },
    resources: (['copy', 'image', 'video', 'audio'] as const).map(
      (resource) => ({
        resource,
        allowance: projection.usage[resource].allowance,
        available: projection.usage[resource].available,
        reserved: projection.usage[resource].reserved,
        settled: projection.usage[resource].committed,
        released: projection.usage[resource].released,
      })
    ),
  };
}
