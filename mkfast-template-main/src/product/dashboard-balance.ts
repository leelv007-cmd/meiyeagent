import {
  publicBillingBalanceSchema,
  type PublicBillingBalance,
} from '@meiye/contracts';

import { queryP1 } from '@/p1/client';

const BUCKETS = [
  { id: 'copy', label: '文案' },
  { id: 'image', label: '图片' },
  { id: 'video', label: '视频' },
] as const;

export function parseDashboardBalance(value: unknown): PublicBillingBalance {
  return publicBillingBalanceSchema.parse(value);
}

export function dashboardBalanceRows(balance: PublicBillingBalance) {
  return BUCKETS.map(({ id, label }) => ({
    allowance: balance[id].allowance,
    available: balance[id].available,
    id,
    label,
    reserved: balance[id].reserved,
  }));
}

export async function readDashboardBalance(signal?: AbortSignal) {
  const value = await queryP1<unknown>(
    'entitlements',
    { action: 'balance', payload: {} },
    signal
  );
  return parseDashboardBalance(value);
}
