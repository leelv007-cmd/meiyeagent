import type { MerchantCreditDetail } from '@meiye/contracts';

type MerchantCreditTransaction = MerchantCreditDetail['transactions'][number];

export function creditDetailBilling(detail: MerchantCreditDetail) {
  return detail.billing;
}

export function creditDetailEmptyFallback(detail: MerchantCreditDetail) {
  if (detail.batches.length > 0 || detail.transactions.length > 0) {
    return null;
  }
  return '还没有积分批次和流水。买加油包或开通套餐后会出现在这里。';
}

export function expiredUncreditedRefund(
  transaction: MerchantCreditTransaction
) {
  if (
    transaction.type !== 'refund' ||
    transaction.refundDisposition !== 'expired_uncredited'
  ) {
    return null;
  }
  return { credits: transaction.credits };
}
