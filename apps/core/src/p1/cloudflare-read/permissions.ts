/**
 * Minimum Cloudflare API token permission inventory (D-053).
 *
 * First version only holds purpose-split read credentials:
 * - inventory-read (deployments/versions/resources)
 * - analytics-read is DEFERRED with GraphQL broker (D-080 C3)
 * - optional billing-read not required for inventory v1
 *
 * Zero write permissions. Observability Query API is excluded because it
 * currently requires Workers Observability Write.
 */

/** Permissions the inventory-read token is allowed to request. */
export const CLOUDFLARE_MIN_READ_PERMISSIONS = [
  {
    id: 'workers_scripts_read',
    officialName: 'Workers Scripts Read',
    purpose: 'List worker scripts, deployments, versions, secret metadata',
    requiredFor: [
      'list_scripts',
      'list_deployments',
      'list_versions',
      'list_secret_metadata',
    ] as const,
  },
  {
    id: 'workers_r2_storage_read',
    officialName: 'Workers R2 Storage Read',
    purpose: 'List R2 buckets (names/jurisdiction/class only)',
    requiredFor: ['list_r2_buckets'] as const,
  },
  {
    id: 'hyperdrive_read',
    officialName: 'Hyperdrive Read',
    purpose: 'List Hyperdrive configs without origin credentials',
    requiredFor: ['list_hyperdrive_configs'] as const,
  },
  {
    id: 'workers_observability_read',
    officialName: 'Workers Observability Read',
    purpose: 'List OTel destination health only (no query API)',
    requiredFor: ['list_otel_destinations'] as const,
  },
] as const;

export type CloudflareMinReadPermissionId =
  (typeof CLOUDFLARE_MIN_READ_PERMISSIONS)[number]['id'];

/**
 * Permissions that must NEVER be present on product admin tokens.
 * Includes control-plane write and Observability Query (Write).
 */
export const CLOUDFLARE_FORBIDDEN_PERMISSIONS = [
  {
    id: 'workers_scripts_write',
    officialName: 'Workers Scripts Write',
    reason: 'Would allow deploy / version upload / bindings mutation',
  },
  {
    id: 'workers_scripts_edit',
    officialName: 'Workers Scripts Edit',
    reason: 'Would allow script edits and secret puts that create versions',
  },
  {
    id: 'workers_observability_write',
    officialName: 'Workers Observability Write',
    reason:
      'Required by Observability Query API; excluded so "query" cannot smuggle write',
  },
  {
    id: 'workers_r2_storage_write',
    officialName: 'Workers R2 Storage Write',
    reason: 'Would allow bucket policy / object control-plane writes',
  },
  {
    id: 'hyperdrive_write',
    officialName: 'Hyperdrive Write',
    reason: 'Would allow origin / pool config mutation',
  },
  {
    id: 'dns_write',
    officialName: 'DNS Write',
    reason: 'Would allow DNS record mutation',
  },
  {
    id: 'zone_waf_write',
    officialName: 'Zone WAF Write',
    reason: 'Would allow WAF / rate-limit rule mutation',
  },
  {
    id: 'account_settings_write',
    officialName: 'Account Settings Write',
    reason: 'Would allow account-level control plane mutation',
  },
  {
    id: 'billing_write',
    officialName: 'Billing Write',
    reason: 'Would allow payment / subscription mutation',
  },
  {
    id: 'queues_write',
    officialName: 'Queues Write',
    reason: 'Queues not used; write would invent control plane',
  },
] as const;

export type CloudflareForbiddenPermissionId =
  (typeof CLOUDFLARE_FORBIDDEN_PERMISSIONS)[number]['id'];

/** Product-side Cloudflare write verbs (mirrored in capability-permission). */
export const CLOUDFLARE_WRITE_ACTIONS = [
  'cloudflare_deploy',
  'cloudflare_rollback',
  'cloudflare_dns_write',
  'cloudflare_waf_write',
  'cloudflare_secret_put',
  'cloudflare_r2_write',
  'cloudflare_billing_write',
  'cloudflare_publish',
  'cloudflare_hyperdrive_write',
  'cloudflare_otel_destination_write',
] as const;

export type CloudflareWriteAction = (typeof CLOUDFLARE_WRITE_ACTIONS)[number];

/**
 * Assert a granted permission set is inventory-read only.
 * Returns violation ids (empty = compliant).
 */
export function assertReadOnlyPermissionSet(
  granted: readonly string[],
): CloudflareForbiddenPermissionId[] {
  const grantedSet = new Set(granted.map((g) => g.toLowerCase()));
  const violations: CloudflareForbiddenPermissionId[] = [];
  for (const forbidden of CLOUDFLARE_FORBIDDEN_PERMISSIONS) {
    const id = forbidden.id.toLowerCase();
    const name = forbidden.officialName.toLowerCase();
    if (grantedSet.has(id) || grantedSet.has(name)) {
      violations.push(forbidden.id);
    }
  }
  return violations;
}

/** True when every min-read permission is present (for readiness checks). */
export function hasMinimumInventoryPermissions(
  granted: readonly string[],
): boolean {
  const grantedSet = new Set(granted.map((g) => g.toLowerCase()));
  return CLOUDFLARE_MIN_READ_PERMISSIONS.every(
    (p) =>
      grantedSet.has(p.id.toLowerCase()) ||
      grantedSet.has(p.officialName.toLowerCase()),
  );
}

/** Permission ids required for the inventory-read token purpose. */
export function listMinReadPermissionIds(): CloudflareMinReadPermissionId[] {
  return CLOUDFLARE_MIN_READ_PERMISSIONS.map((p) => p.id);
}

/** Forbidden permission ids (for negative tests / policy docs). */
export function listForbiddenPermissionIds(): CloudflareForbiddenPermissionId[] {
  return CLOUDFLARE_FORBIDDEN_PERMISSIONS.map((p) => p.id);
}
