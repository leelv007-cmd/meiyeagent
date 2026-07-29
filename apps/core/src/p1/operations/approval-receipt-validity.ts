import { DEFAULT_APPROVAL_RECEIPT_TTL_MS } from '../admin-config/approval-receipt-settings.js';

export function approvalReceiptExpiresAt(
  issuedAt: string,
  notBefore?: string,
) {
  const issuedAtMs = Date.parse(issuedAt);
  const notBeforeMs = notBefore ? Date.parse(notBefore) : issuedAtMs;
  return new Date(
    Math.max(issuedAtMs, notBeforeMs) + DEFAULT_APPROVAL_RECEIPT_TTL_MS,
  ).toISOString();
}

export function isApprovalReceiptActiveAt(
  receipt: { expiresAt?: string; status: string },
  observedAt: string,
) {
  if (receipt.status !== 'approved' || !receipt.expiresAt) return false;
  const expiresAtMs = Date.parse(receipt.expiresAt);
  const observedAtMs = Date.parse(observedAt);
  return (
    Number.isFinite(expiresAtMs) &&
    Number.isFinite(observedAtMs) &&
    observedAtMs < expiresAtMs
  );
}
