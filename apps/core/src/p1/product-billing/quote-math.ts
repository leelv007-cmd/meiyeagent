import type { ProductBillingMode } from '@meiye/contracts';

export function applyBillableSecondsRules(input: {
  rawSeconds: number;
  minChargeSeconds?: number;
  roundingStepSeconds?: number;
}): number {
  const min = input.minChargeSeconds ?? 0;
  const step = input.roundingStepSeconds ?? 1;
  const floored = Math.max(input.rawSeconds, min);
  if (step <= 1) return floored;
  return Math.ceil(floored / step) * step;
}

export function computeProductAmount(input: {
  billingMode: ProductBillingMode;
  unitRate: number;
  billableSeconds?: number;
}): number {
  if (input.billingMode === 'per_request') return input.unitRate;
  return input.unitRate * (input.billableSeconds ?? 0);
}
