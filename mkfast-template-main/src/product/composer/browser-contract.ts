/**
 * Browser serialization boundary for Composer drafts / settings (D-062 / D-081).
 *
 * Channel-side supply truth must NEVER appear in the browser contract:
 * Provider, Deployment, Credential, fallback order, New API / Sub2API fingerprints.
 * Users only see CatalogModel product names.
 */

/** Keys forbidden on any browser-facing composer payload. */
export const FORBIDDEN_BROWSER_COMPOSER_KEYS = [
  'provider',
  'Provider',
  'providerProfile',
  'ProviderProfile',
  'providerProfileId',
  'deployment',
  'Deployment',
  'deploymentId',
  'credential',
  'Credential',
  'credentialId',
  'credentialRef',
  'CredentialAccount',
  'fallback',
  'fallbackOrder',
  'fallbackCandidates',
  'executionChannel',
  'ExecutionChannel',
  'executionChannelId',
  'newApi',
  'sub2api',
  'gatewayFingerprint',
  'supplierPrice',
  'routeCandidates',
] as const;

const FORBIDDEN_SET = new Set<string>(FORBIDDEN_BROWSER_COMPOSER_KEYS);

/**
 * Deep-scan a value for forbidden channel/supply keys.
 * Returns the first forbidden key path, or null if clean.
 */
export function findForbiddenBrowserComposerKey(
  value: unknown,
  path = '$'
): string | null {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      const hit = findForbiddenBrowserComposerKey(value[i], `${path}[${i}]`);
      if (hit) return hit;
    }
    return null;
  }
  if (typeof value !== 'object') return null;
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_SET.has(key)) {
      return `${path}.${key}`;
    }
    // Case-insensitive catch for common supply terms in nested bags.
    const lower = key.toLowerCase();
    if (
      lower === 'provider' ||
      lower === 'deployment' ||
      lower === 'credential' ||
      lower === 'fallback' ||
      lower === 'fallbackorder' ||
      lower.includes('credentialref')
    ) {
      return `${path}.${key}`;
    }
    const hit = findForbiddenBrowserComposerKey(child, `${path}.${key}`);
    if (hit) return hit;
  }
  return null;
}

/**
 * Project a settings / draft bag into a browser-safe payload by stripping
 * forbidden keys. CatalogModel product fields are kept.
 */
export function projectBrowserComposerPayload<
  T extends Record<string, unknown>,
>(source: T): Record<string, unknown> {
  return stripForbidden(source) as Record<string, unknown>;
}

function stripForbidden(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(stripForbidden);
  if (typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_SET.has(key)) continue;
    const lower = key.toLowerCase();
    if (
      lower === 'provider' ||
      lower === 'deployment' ||
      lower === 'credential' ||
      lower === 'fallback' ||
      lower === 'fallbackorder' ||
      lower.includes('credentialref')
    ) {
      continue;
    }
    out[key] = stripForbidden(child);
  }
  return out;
}

/** Stable JSON serialization for snapshot tests. */
export function serializeBrowserComposerPayload(value: unknown): string {
  return JSON.stringify(value);
}
