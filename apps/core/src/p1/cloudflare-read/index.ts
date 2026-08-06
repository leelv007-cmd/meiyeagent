/**
 * Cloudflare read-only adapter surface (D-052 / D-053 / D-080 C3).
 *
 * Pure domain module — no main.ts / HTTP route wiring (Z2-WIRING owns that).
 * GraphQL analytics trend broker is DEFERRED and intentionally not exported.
 */

export {
  CLOUDFLARE_MIN_READ_PERMISSIONS,
  CLOUDFLARE_FORBIDDEN_PERMISSIONS,
  CLOUDFLARE_WRITE_ACTIONS,
  assertReadOnlyPermissionSet,
  hasMinimumInventoryPermissions,
  listMinReadPermissionIds,
  listForbiddenPermissionIds,
  type CloudflareMinReadPermissionId,
  type CloudflareForbiddenPermissionId,
  type CloudflareWriteAction,
} from './permissions.js';

export {
  CLOUDFLARE_HANDOFF_TTL_MS,
  DEFAULT_ADMIN_CLOUDFLARE_DEEP_LINK_KINDS,
  CloudflareDeepLinkError,
  isAllowedDeepLinkResourceKind,
  assertNoSensitiveDeepLinkFields,
  buildCloudflareDeepLinkEnvelope,
  resolveCloudflareDeepLink,
  resolveDefaultAdminCloudflareDeepLinks,
  type AdminCloudflareDeepLinkView,
  type BuildDeepLinkEnvelopeInput,
} from './deep-link.js';

export {
  HYPERDRIVE_PLACEHOLDER_ID,
  isHyperdrivePlaceholder,
  projectCloudflareConfigRisks,
  defaultRepoConfigRisks,
  shouldShowCloudflareQueueCard,
  type CloudflareLocalConfigSnapshot,
} from './config-risk.js';

export {
  runShellHttpProbe,
  runDatabaseConnectivityProbe,
  runObjectStorageProbe,
  runMappingReadinessProbe,
  runCloudflareSelfProbes,
  type SelfProbePorts,
  type ProbeFetch,
} from './self-probe.js';

export {
  CLOUDFLARE_INVENTORY_CACHE_TTL_MS,
  CLOUDFLARE_API_BASE,
  CLOUDFLARE_INVENTORY_READ_METHODS,
  CLOUDFLARE_INVENTORY_FORBIDDEN_METHODS,
  CloudflareInventoryAdapter,
  normalizeDeploymentsFromApi,
  normalizeVersionsFromApi,
  type CloudflareHttpFetch,
  type CloudflareInventoryAdapterOptions,
  type CloudflareInventoryReadMethod,
} from './inventory-adapter.js';

export {
  CloudflareWriteDeniedError,
  listAdapterAllowedMethods,
  denyCloudflareWriteAction,
  isCloudflareWriteAction,
  assertCloudflareWriteDenied,
  findForbiddenMethodsOnAdapter,
  listDeniedWriteActions,
} from './write-guard.js';

export {
  CLOUDFLARE_DEEP_LINK_RESOURCE_KINDS,
  type CloudflareFreshness,
  type CloudflareUnknownReason,
  type CloudflareFieldEnvelope,
  type CloudflareResourceMapping,
  type CloudflareDeploymentSnapshot,
  type CloudflareVersionSnapshot,
  type CloudflareResourceKind,
  type CloudflareResourceReadiness,
  type CloudflareResourceInventoryItem,
  type CloudflareInventorySnapshot,
  type CloudflareConfigRisk,
  type CloudflareSelfProbeKind,
  type CloudflareSelfProbeStatus,
  type CloudflareSelfProbeResult,
  type CloudflareDeepLinkResourceKind,
  type CloudflareDeepLinkEnvelope,
  type CloudflareDeepLinkResolution,
} from './types.js';
