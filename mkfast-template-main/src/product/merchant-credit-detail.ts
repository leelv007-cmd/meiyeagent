import type { MerchantCreditDetail } from '@meiye/contracts';

type MerchantCreditTransaction = MerchantCreditDetail['transactions'][number];

export function creditDetailBilling(detail: MerchantCreditDetail) {
  return detail.billing;
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
