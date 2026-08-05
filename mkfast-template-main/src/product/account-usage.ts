import type { PublicCreditBalance } from '@meiye/contracts';

export type AccountUsageResource = 'copy' | 'image' | 'video' | 'audio';

interface AccountUsageBucket {
  allowance: number;
  available: number;
  committed: number;
  released: number;
  reserved: number;
}

/**
 * The `entitlements` / `projection` response as the browser receives it.
 *
 * `credits` is the merchant's billing truth (D-172). `usage` is not: it is a
 * frozen read-shape `entitlement-module.ts` still synthesises for cutover
 * consumers (`legacyCreditUsageProjection`), and its numbers do not move when a
 * run settles — they are `min(plan allowance, credit balance)` recomputed from
 * the credit balance every time. Physically retiring the field is a known
 * deferral (xcheck Rev 2, Out of Scope), so the boundary is enforced instead:
 *
 * RETIRED-METERING: `usage` is internal/cutover-only. No merchant surface may
 * read or render it — `merchant-language-audit.test.ts` fails the build if one
 * does. The operations console keeps the one legitimate read, in
 * `src/p1/merchant-support-diagnostic.ts`, where it explains a shop's ledger to
 * support staff rather than quoting it back to the shop.
 */
export interface AccountUsageProjection {
  plan: {
    tier: 'trial' | 'starter' | 'growth' | 'pro';
    periodEndsAt?: string;
  } | null;
  usage: Record<AccountUsageResource, AccountUsageBucket>;
  credits?: PublicCreditBalance;
}
