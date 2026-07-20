/**
 * Cloudflare read-only projection contracts (D-052 / D-053 / D-080 C3).
 *
 * Three truth layers:
 * 1. Native deep diagnostics stay on CF Dashboard / Wrangler (deep-links).
 * 2. Product admin projects read-only status only.
 * 3. Product-side probes + safe actions never mutate CF control plane.
 *
 * GraphQL analytics trend broker is DEFERRED — not part of this module.
 */

/** Evidence freshness for any CF-sourced projection. */
export type CloudflareFreshness =
  | 'fresh'
  | 'stale'
  | 'unknown'
  | 'not_verified'
  | 'unavailable';

/** Why a field is not a live value. */
export type CloudflareUnknownReason =
  | 'read_failed'
  | 'rate_limited'
  | 'retention_window_exceeded'
  | 'sampled_incomplete'
  | 'mapping_not_verified'
  | 'token_missing'
  | 'not_configured'
  | 'cache_miss'
  | 'resource_not_enabled'
  | 'config_risk'
  | 'placeholder_id';

/** Honest envelope — never invent zero/green when unknown. */
export type CloudflareFieldEnvelope<T> =
  | {
      status: 'known';
      value: T;
      freshness: Extract<CloudflareFreshness, 'fresh' | 'stale'>;
      observedAt: string;
      source: 'cloudflare_rest' | 'self_probe' | 'local_config';
    }
  | {
      status: 'unknown';
      reason: CloudflareUnknownReason;
      freshness: CloudflareFreshness;
      observedAt?: string;
      detail?: string;
    };

/** Production resource mapping (must be verified before live REST). */
export interface CloudflareResourceMapping {
  /** Internal product ref — never expose raw account id to browser as truth. */
  internalRef: string;
  accountId?: string;
  scriptName?: string;
  zoneId?: string;
  r2BucketName?: string;
  hyperdriveConfigId?: string;
  /** True only after an operator-verified production mapping. */
  verified: boolean;
}

/** Workers deployment projection (REST list deployments). */
export interface CloudflareDeploymentSnapshot {
  deploymentId: string;
  versionId?: string;
  createdOn?: string;
  source?: string;
  authorEmail?: string;
  /** Percentage of traffic if multi-version (0–100). */
  trafficPercent?: number;
  /** Explicit: deployment is not a data rollback. */
  notDataRollback: true;
}

/** Workers version projection (REST list versions). */
export interface CloudflareVersionSnapshot {
  versionId: string;
  createdOn?: string;
  source?: string;
  annotations?: Record<string, string>;
}

/** Enabled resource inventory row. */
export type CloudflareResourceKind =
  | 'worker_script'
  | 'worker_deployment'
  | 'worker_version'
  | 'r2_bucket'
  | 'hyperdrive'
  | 'worker_secret_meta'
  | 'otel_destination';

export type CloudflareResourceReadiness =
  | 'configured'
  | 'verified'
  | 'config_risk'
  | 'not_ready'
  | 'not_enabled'
  | 'unknown';

export interface CloudflareResourceInventoryItem {
  kind: CloudflareResourceKind;
  /** Internal or public-safe name (no secret values). */
  name: string;
  readiness: CloudflareResourceReadiness;
  /** Business-impact note, not raw Dashboard metric. */
  businessImpact: string;
  detail?: string;
  observedAt?: string;
}

export interface CloudflareInventorySnapshot {
  mappingRef: string;
  capturedAt: string;
  freshness: CloudflareFreshness;
  deployments: CloudflareFieldEnvelope<CloudflareDeploymentSnapshot[]>;
  versions: CloudflareFieldEnvelope<CloudflareVersionSnapshot[]>;
  resources: CloudflareResourceInventoryItem[];
  /** Explicit: Cloudflare Queues are not used — never invent them. */
  cloudflareQueuesEnabled: false;
  /** GraphQL analytics deferred (D-080 C3). */
  graphqlAnalyticsDeferred: true;
  cache: {
    hit: boolean;
    ttlMs: number;
    ageMs: number | null;
  };
}

/** Config-risk flags from local wrangler/config inspection. */
export interface CloudflareConfigRisk {
  id: string;
  severity: 'config_risk' | 'not_ready';
  title: string;
  businessImpact: string;
  evidence: string;
}

/** Self health probe result (our side, not CF control plane). */
export type CloudflareSelfProbeKind =
  | 'shell_http'
  | 'database_connectivity'
  | 'object_storage_binding'
  | 'mapping_readiness';

export type CloudflareSelfProbeStatus =
  | 'ok'
  | 'degraded'
  | 'failed'
  | 'unknown'
  | 'not_ready';

export interface CloudflareSelfProbeResult {
  kind: CloudflareSelfProbeKind;
  status: CloudflareSelfProbeStatus;
  businessImpact: string;
  observedAt: string;
  detail?: string;
  /** Never a CF write — probes are product-side only. */
  mutatesCloudflare: false;
}

/** Allowed deep-link resource kinds (allowlist). */
export const CLOUDFLARE_DEEP_LINK_RESOURCE_KINDS = [
  'worker_observability',
  'worker_deployments',
  'worker_versions',
  'worker_logs',
  'worker_traces',
  'r2_bucket',
  'hyperdrive',
  'zone_dns',
  'security_events',
  'billing',
] as const;

export type CloudflareDeepLinkResourceKind =
  (typeof CLOUDFLARE_DEEP_LINK_RESOURCE_KINDS)[number];

/**
 * Redacted handoff envelope (D-052).
 * No API token, secret, IP, UA, prompt, user content, full path/query, log body.
 */
export interface CloudflareDeepLinkEnvelope {
  provider: 'cloudflare';
  resourceKind: CloudflareDeepLinkResourceKind;
  /** Internal mapped ref — server resolves account/script/zone. */
  resourceRef: string;
  /** Redacted ISO time window (no user content). */
  from?: string;
  to?: string;
  signal?: string;
  incidentRef?: string;
  snapshotAt: string;
  /** Product capability context (id / label only). */
  capabilityContext?: {
    capabilityId?: string;
    capabilityLabel?: string;
  };
  /** Script / deployment correlation (ids only, no payloads). */
  scriptDeployment?: {
    scriptRef?: string;
    deploymentRef?: string;
    versionRef?: string;
  };
  correlation?: {
    correlationId?: string;
    traceHint?: string;
  };
  returnTo?: string;
}

export interface CloudflareDeepLinkResolution {
  envelope: CloudflareDeepLinkEnvelope;
  /** Official Dashboard URL built server-side. */
  dashboardUrl: string;
  /** Suggested TTL for handoff_id (ms). */
  ttlMs: number;
  singleUse: true;
}
