/**
 * Same-origin one-time SPA memory handoff for platform credential rotation.
 *
 * Holds the short-lived secure-write receipt after the integrations page stages
 * a rotation so the supply page can prefill completion — without putting
 * receiptId into query, hash, Referer, storage, or analytics payloads.
 *
 * Record lives only in module memory for the current SPA session. Refresh loses
 * it; manual receipt entry remains the recovery path.
 */

/** Platform credentials are always bound to the global supply workspace. */
export const PLATFORM_CREDENTIAL_WORKSPACE_ID = '__global__';

export type CredentialRotationHandoffRecord = {
  workspaceId: string;
  accountId: string;
  receiptId: string;
  expiresAt: string;
};

export type CredentialRotationHandoffConsumeResult =
  | { status: 'ready'; record: CredentialRotationHandoffRecord }
  | { status: 'missing' }
  | { status: 'expired' }
  | { status: 'workspace_mismatch' }
  | { status: 'account_mismatch' };

let handoff: CredentialRotationHandoffRecord | null = null;

function isExpired(record: CredentialRotationHandoffRecord, nowMs: number) {
  const expiresMs = Date.parse(record.expiresAt);
  return !Number.isFinite(expiresMs) || expiresMs <= nowMs;
}

/** Stage a one-time handoff after integrations issues a secure-write receipt. */
export function stageCredentialRotationHandoff(
  record: CredentialRotationHandoffRecord
): void {
  handoff = {
    workspaceId: record.workspaceId,
    accountId: record.accountId,
    receiptId: record.receiptId,
    expiresAt: record.expiresAt,
  };
}

/**
 * Read the current handoff without consuming it.
 * Expired records are cleared immediately and return null.
 */
export function peekCredentialRotationHandoff(
  nowMs: number = Date.now()
): CredentialRotationHandoffRecord | null {
  if (!handoff) return null;
  if (isExpired(handoff, nowMs)) {
    handoff = null;
    return null;
  }
  return { ...handoff };
}

/**
 * Bind the handoff to a workspace + account before supply-page consumption.
 *
 * - expired / wrong workspace / wrong account: clear memory and return the reason
 * - ready: return a copy; clear when `clearOnReady` is true (default true for one-shot take)
 *
 * Use `clearOnReady: false` for form prefill, then clear after Core success or a
 * terminal Core rejection (expired, already consumed, binding mismatch).
 */
export function consumeCredentialRotationHandoff(
  binding: { workspaceId: string; accountId: string },
  options: { nowMs?: number; clearOnReady?: boolean } = {}
): CredentialRotationHandoffConsumeResult {
  const nowMs = options.nowMs ?? Date.now();
  const clearOnReady = options.clearOnReady ?? true;

  if (!handoff) return { status: 'missing' };

  if (isExpired(handoff, nowMs)) {
    handoff = null;
    return { status: 'expired' };
  }

  if (handoff.workspaceId !== binding.workspaceId) {
    handoff = null;
    return { status: 'workspace_mismatch' };
  }

  if (handoff.accountId !== binding.accountId) {
    handoff = null;
    return { status: 'account_mismatch' };
  }

  const record = { ...handoff };
  if (clearOnReady) {
    handoff = null;
  }
  return { status: 'ready', record };
}

/** Clear handoff, optionally only when receiptId matches. */
export function clearCredentialRotationHandoff(receiptId?: string): void {
  if (!handoff) return;
  if (receiptId !== undefined && handoff.receiptId !== receiptId) return;
  handoff = null;
}

/** Test-only reset so suites do not leak across cases. */
export function resetCredentialRotationHandoffForTests(): void {
  handoff = null;
}

/**
 * Core terminal failures that mean the staged receipt is no longer usable.
 * Callers clear handoff when the failed rotate used the staged receipt.
 */
export function isTerminalRotationReceiptError(error: unknown): boolean {
  const message =
    error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : '';
  return /secure-write receipt|already been consumed|has expired|not found for this credential|CredentialAccount changed after the secure-write/i.test(
    message
  );
}
