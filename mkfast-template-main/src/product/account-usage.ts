import type { PublicCreditBalance } from '@meiye/contracts';

/**
 * The `entitlements` / `projection` response as the browser receives it.
 *
 * Credits are the only merchant billing truth (D-172). Retired resource-bucket
 * allowances are deliberately absent; support reads the canonical credit-detail
 * projection instead of synthesizing a second ledger.
 */
export interface AccountUsageProjection {
  credits: PublicCreditBalance;
  plan: {
    tier: 'trial' | 'starter' | 'growth' | 'pro';
  };
}
