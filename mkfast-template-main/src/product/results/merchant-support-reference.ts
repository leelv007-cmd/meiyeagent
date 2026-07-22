/**
 * Merchant-safe support reference (P0-E1 / #144).
 *
 * Merchants never see Work/Job UUIDs. Support staff resolve the short code
 * through a permission-isolated diagnostic view.
 */

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';

/** Stable FNV-1a 32-bit hash — deterministic across sessions, no crypto needed. */
function fnv1a32(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * Build a short support reference from a stable internal id.
 * Output never contains the source id characters verbatim.
 */
export function formatMerchantSupportReference(internalId: string): string {
  const seed = internalId.trim();
  if (!seed) return 'MY-000000';

  let value = fnv1a32(`meiye-support:${seed}`);
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += ALPHABET[value % ALPHABET.length];
    value = Math.floor(value / ALPHABET.length);
    if (value === 0) value = fnv1a32(`${seed}:${i}`);
  }
  return `MY-${code}`;
}

/** True when text looks like a full Work/Job UUID rather than a support code. */
export function looksLikeInternalUuid(value: string): boolean {
  return /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu.test(
    value
  );
}
